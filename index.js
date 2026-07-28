import "dotenv/config";

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { createBareServer } from "@nebula-services/bare-server-node";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { logging as wispLogging, server as wispServer } from "@mercuryworkshop/wisp-js/server";
import { createClient } from "@supabase/supabase-js";
import chalk from "chalk";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import mime from "mime";
import fetch from "node-fetch";
import OpenAI from "openai";

import { supabaseAdmin } from "./lib/supabaseAdmin.js";

console.log(chalk.yellow("🚀 Starting server..."));

const __dirname = process.cwd();
const app = express();
const server = http.createServer();

app.set("trust proxy", 1);

const PORT = Number(process.env.PORT) || 8080;
const bareServer = createBareServer("/ca/");

/* Scramjet uses Wisp + CurlTransport while Ultraviolet keeps the existing Bare route. */
wispLogging.set_level(wispLogging.NONE);
Object.assign(wispServer.options, {
  allow_udp_streams: false,
});

const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const cache = new Map();

const FUZZ_RELEASE = Object.freeze({
  version: "5.3.0",
  releasedAt: "2026-07-24T00:00:00.000Z",
  summary:
    "A major browsing, reliability, customization, and diagnostics update.",
  items: [
    "Redesigned proxy selection on Home and New Tab.",
    "Synced bookmarks with browser-storage fallback.",
    "Recently visited and recently closed tab recovery.",
    "System Status page and owner health dashboard.",
    "Client error IDs with searchable activity logs.",
    "First-run onboarding and expanded appearance controls.",
    "Update notices, changelog, and safer response headers.",
    "Improved proxy errors with one-click engine fallback.",
  ],
});

const ADMIN_DASHBOARD_CACHE_TTL = 5 * 1000;
let adminDashboardCache = {
  expiresAt: 0,
  value: null,
};

function invalidateAdminCache() {
  adminDashboardCache = {
    expiresAt: 0,
    value: null,
  };
}

/* =======================================================
   ENVIRONMENT
======================================================= */

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_ANON_KEY.",
  );
}

if (!openaiApiKey) {
  throw new Error("Missing OPENAI_API_KEY.");
}

/* =======================================================
   CLIENTS
======================================================= */

const supabasePublic = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  },
);

const openai = new OpenAI({
  apiKey: openaiApiKey,
});

/* =======================================================
   GENERAL MIDDLEWARE
======================================================= */

app.use(cookieParser());

app.use(
  express.json({
    limit: "15mb",
  }),
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "15mb",
  }),
);

/*
 * Do not enable COOP/COEP on the proxy browser pages.
 *
 * The tabs and standalone proxy pages embed rewritten websites in frames.
 * Cross-origin isolation can block those frames before Ultraviolet or
 * Scramjet gets a chance to render them.
 */
app.use((req, res, next) => {
  const proxyBrowserPage = new Set([
    "/d",
    "/p",
    "/tabs.html",
    "/proxy.html",
  ]);

  if (proxyBrowserPage.has(req.path)) {
    res.removeHeader(
      "Cross-Origin-Opener-Policy",
    );
    res.removeHeader(
      "Cross-Origin-Embedder-Policy",
    );
  }

  next();
});

/*
 * Normal application pages get defensive browser headers. Proxy runtime
 * paths are intentionally excluded because rewritten sites, workers, and
 * embedded frames need a less restrictive environment.
 */
const PROXY_RUNTIME_PREFIXES = [
  "/a/",
  "/scram/",
  "/baremux/",
  "/libcurl/",
  "/ca/",
  "/wisp/",
];

const PROXY_BROWSER_PATHS = new Set([
  "/d",
  "/p",
  "/tabs.html",
  "/proxy.html",
  "/scramjet-sw.js",
  "/sw.js",
]);

const APPLICATION_PAGE_PATHS = new Set([
  "/",
  "/b",
  "/a",
  "/c",
  "/ai",
  "/account",
  "/admin",
  "/status",
  "/login",
  "/signup",
  "/verified",
  "/suspended",
  "/maintenance",
  "/feature-unavailable",
  "/index.html",
  "/apps.html",
  "/games.html",
  "/settings.html",
  "/ai.html",
  "/account.html",
  "/admin.html",
  "/status.html",
  "/login.html",
  "/signup.html",
]);

function isProxyRuntimeRequest(reqPath = "") {
  return (
    PROXY_BROWSER_PATHS.has(reqPath) ||
    PROXY_RUNTIME_PREFIXES.some((prefix) =>
      reqPath.startsWith(prefix),
    )
  );
}

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");

  if (!isProxyRuntimeRequest(req.path)) {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://www.googletagmanager.com",
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
        "font-src 'self' data: https://cdnjs.cloudflare.com",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' https: wss:",
        "worker-src 'self' blob:",
        "frame-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
      ].join("; "),
    );
  }

  next();
});

/*
 * The Bare server is handled before Express at the bottom of
 * this file. This CORS middleware is only a fallback.
 */
app.use(
  "/ca",
  cors({
    origin: true,
    credentials: true,
  }),
);

/* =======================================================
   HEALTH CHECK
======================================================= */

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    service: "FuzzTheHuzz",
    version: FUZZ_RELEASE.version,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/release", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.json(FUZZ_RELEASE);
});

/* =======================================================
   AUTH COOKIE HELPERS
======================================================= */

const ACCESS_COOKIE = "fuzz_access_token";
const REFRESH_COOKIE = "fuzz_refresh_token";

function isSecureRequest(req) {
  const forwardedProtocol =
    req.get("x-forwarded-proto") || "";

  return (
    req.secure ||
    forwardedProtocol.split(",")[0].trim() === "https" ||
    req.hostname.endsWith(".app.github.dev")
  );
}

function getCookieOptions(req) {
  return {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}

function getClearCookieOptions(req) {
  return {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: "lax",
    path: "/",
  };
}

function clearAuthCookies(req, res) {
  const options = getClearCookieOptions(req);

  res.clearCookie(ACCESS_COOKIE, options);
  res.clearCookie(REFRESH_COOKIE, options);
  res.clearCookie("fuzz_security_session", options);
}

/* =======================================================
   AUTH LOOKUP
======================================================= */

async function getAuthenticatedUser(req, res) {
  let accessToken =
    req.cookies?.[ACCESS_COOKIE] || "";

  const refreshToken =
    req.cookies?.[REFRESH_COOKIE] || "";

  if (!accessToken) {
    return null;
  }

  let {
    data: { user },
    error: userError,
  } = await supabasePublic.auth.getUser(accessToken);

  /*
   * Refresh an expired access token.
   */
  if ((!user || userError) && refreshToken) {
    const {
      data: refreshedData,
      error: refreshError,
    } = await supabasePublic.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (!refreshError && refreshedData.session) {
      accessToken =
        refreshedData.session.access_token;

      const cookieOptions =
        getCookieOptions(req);

      res.cookie(
        ACCESS_COOKIE,
        refreshedData.session.access_token,
        cookieOptions,
      );

      res.cookie(
        REFRESH_COOKIE,
        refreshedData.session.refresh_token,
        cookieOptions,
      );

      user = refreshedData.user;
      userError = null;
    }
  }

  if (!user || userError) {
    clearAuthCookies(req, res);
    return null;
  }

  const {
    data: profile,
    error: profileError,
  } = await supabaseAdmin
    .from("profiles")
    .select(
      "username, role, banned, suspended_until, suspension_reason, suspended_at, suspended_by, suspension_source",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (
    profileError ||
    !profile ||
    profile.banned === true
  ) {
    clearAuthCookies(req, res);
    return null;
  }

  const suspension =
    await resolveProfileSuspension(
      user.id,
      profile,
    );

  const securitySessionValid =
    await validateSecuritySession(
      req,
      res,
      user.id,
    );

  if (!securitySessionValid) {
    clearAuthCookies(req, res);
    return null;
  }

  return {
    user,
    profile,
    accessToken,
    suspension,
  };
}

async function requirePageAuth(req, res, next) {
  try {
    const auth =
      await getAuthenticatedUser(req, res);

    if (!auth) {
      const nextPath =
        encodeURIComponent(req.originalUrl);

      return res.redirect(
        `/login?next=${nextPath}`,
      );
    }

    if (auth.suspension?.active) {
      return res.redirect("/suspended");
    }

    req.auth = auth;
    return next();
  } catch (error) {
    console.error(
      "Page authentication failed:",
      error,
    );

    clearAuthCookies(req, res);

    return res.redirect("/login");
  }
}

async function requireApiAuth(req, res, next) {
  try {
    const auth =
      await getAuthenticatedUser(req, res);

    if (!auth) {
      return res.status(401).json({
        error:
          "You must be signed in to use this feature.",
      });
    }

    if (auth.suspension?.active) {
      return sendSuspensionResponse(
        res,
        auth.suspension,
      );
    }

    req.auth = auth;
    return next();
  } catch (error) {
    console.error(
      "API authentication failed:",
      error,
    );

    clearAuthCookies(req, res);

    return res.status(401).json({
      error:
        "Your login session is no longer valid.",
    });
  }
}

const ROLE_LEVELS = {
  user: 1,
  moderator: 2,
  admin: 3,
  owner: 4,
};

function hasRole(profile, minimumRole) {
  return (
    ROLE_LEVELS[profile?.role] >=
    ROLE_LEVELS[minimumRole]
  );
}

function requireRole(minimumRole) {
  return async (req, res, next) => {
    try {
      const auth =
        await getAuthenticatedUser(req, res);

      if (!auth) {
        return res.status(401).json({
          error: "You must be signed in.",
        });
      }

      if (auth.suspension?.active) {
        return sendSuspensionResponse(
          res,
          auth.suspension,
        );
      }

      if (!hasRole(auth.profile, minimumRole)) {
        return res.status(403).json({
          error:
            "You do not have permission.",
        });
      }

      req.auth = auth;
      return next();
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error:
          "Permission verification failed.",
      });
    }
  };
}

function getRequestHeader(req, name) {
  if (typeof req?.get === "function") {
    return req.get(name) || "";
  }

  const headerName = String(name || "").toLowerCase();
  const value = req?.headers?.[headerName];

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return value ? String(value) : "";
}

function getClientIp(req) {
  const forwardedFor = getRequestHeader(req, "x-forwarded-for");
  const firstForwardedIp = forwardedFor.split(",")[0].trim();

  return (
    firstForwardedIp ||
    req?.ip ||
    req?.socket?.remoteAddress ||
    null
  );
}

function getClientInfo(req) {
  const userAgent = String(
    getRequestHeader(req, "user-agent"),
  ).slice(0, 1000);

  let browser = "Unknown";
  let operatingSystem = "Unknown";
  let deviceType = "desktop";

  if (/edg/i.test(userAgent)) {
    browser = "Edge";
  } else if (/chrome|crios/i.test(userAgent)) {
    browser = "Chrome";
  } else if (/firefox|fxios/i.test(userAgent)) {
    browser = "Firefox";
  } else if (/safari/i.test(userAgent)) {
    browser = "Safari";
  }

  if (/windows/i.test(userAgent)) {
    operatingSystem = "Windows";
  } else if (/android/i.test(userAgent)) {
    operatingSystem = "Android";
  } else if (/iphone|ipad|ios/i.test(userAgent)) {
    operatingSystem = "iOS";
  } else if (/mac os|macintosh/i.test(userAgent)) {
    operatingSystem = "macOS";
  } else if (/linux/i.test(userAgent)) {
    operatingSystem = "Linux";
  }

  if (/ipad|tablet/i.test(userAgent)) {
    deviceType = "tablet";
  } else if (/mobile|iphone|android/i.test(userAgent)) {
    deviceType = "mobile";
  }

  return {
    ipAddress: getClientIp(req),
    userAgent,
    browser,
    operatingSystem,
    deviceType,
  };
}

async function writeActivityLog({
  req,
  userId = null,
  actorUserId = null,
  targetUserId = null,
  category,
  action,
  status = "success",
  description = null,
  resourceType = null,
  resourceId = null,
  responseStatus = null,
  durationMs = null,
  proxyQuery = null,
  proxyTargetUrl = null,
  proxyTargetDomain = null,
  proxyEngine = null,
  chatId = null,
  messageId = null,
  aiModel = null,
  messageRole = null,
  messageLength = null,
  promptPreview = null,
  hadImage = null,
  imageName = null,
  outputLength = null,
  inputTokens = null,
  outputTokens = null,
  totalTokens = null,
  oldValues = null,
  newValues = null,
  metadata = {},
}) {
  try {
    const client =
      req
        ? getClientInfo(req)
        : {
            ipAddress: null,
            userAgent: null,
            browser: null,
            operatingSystem: null,
            deviceType: null,
          };

    const { error } = await supabaseAdmin
      .from("activity_logs")
      .insert({
        user_id: userId,
        actor_user_id: actorUserId,
        target_user_id: targetUserId,
        category,
        action,
        status,
        description,
        resource_type: resourceType,
        resource_id: resourceId,
        request_method: req?.method || null,
        request_path: req?.originalUrl || req?.url || null,
        response_status: responseStatus,
        duration_ms: durationMs,
        ip_address: client.ipAddress,
        user_agent: client.userAgent,
        browser: client.browser,
        operating_system: client.operatingSystem,
        device_type: client.deviceType,
        proxy_query: proxyQuery,
        proxy_target_url: proxyTargetUrl,
        proxy_target_domain: proxyTargetDomain,
        proxy_engine: proxyEngine,
        chat_id: chatId,
        message_id: messageId,
        ai_model: aiModel,
        message_role: messageRole,
        message_length: messageLength,
        prompt_preview:
          promptPreview
            ? String(promptPreview).slice(0, 250)
            : null,
        had_image: hadImage,
        image_name: imageName,
        output_length: outputLength,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        old_values: oldValues,
        new_values: newValues,
        metadata,
      });

    if (error) {
      console.error(
        "Activity log insert failed:",
        error,
      );
    } else {
      invalidateAdminCache();
    }
  } catch (error) {
    console.error(
      "Activity logger crashed:",
      error,
    );
  }
}

function requireOwnerPage(req, res, next) {
  return getAuthenticatedUser(req, res)
    .then((auth) => {
      if (!auth) {
        return res.redirect("/login");
      }

      if (auth.profile.role !== "owner") {
        return res
          .status(404)
          .sendFile(
            path.join(
              __dirname,
              "static",
              "404.html",
            ),
          );
      }

      req.auth = auth;
      return next();
    })
    .catch((error) => {
      console.error(
        "Owner page authorization failed:",
        error,
      );

      return res
        .status(404)
        .sendFile(
          path.join(
            __dirname,
            "static",
            "404.html",
          ),
        );
    });
}

/* =======================================================
   ADMIN + ANALYTICS HELPERS
======================================================= */

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(
    Math.max(parsed, minimum),
    maximum,
  );
}

const INVITE_CHARACTERS =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createInvitePart(length = 4) {
  let part = "";

  for (
    let index = 0;
    index < length;
    index += 1
  ) {
    part +=
      INVITE_CHARACTERS[
        crypto.randomInt(
          0,
          INVITE_CHARACTERS.length,
        )
      ];
  }

  return part;
}

function createInviteCode() {
  return `FUZZ-${createInvitePart()}-${createInvitePart()}`;
}

function startOfUtcDay(value = new Date()) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function getDateKey(value) {
  return new Date(value)
    .toISOString()
    .slice(0, 10);
}

function createDailySeries(days) {
  const today = startOfUtcDay();
  const series = [];

  for (
    let offset = days - 1;
    offset >= 0;
    offset -= 1
  ) {
    const date = new Date(today);
    date.setUTCDate(
      date.getUTCDate() - offset,
    );

    series.push({
      date: getDateKey(date),
      value: 0,
    });
  }

  return series;
}

function fillDailySeries(
  series,
  rows,
  dateField = "created_at",
) {
  const entries = new Map(
    series.map((entry) => [
      entry.date,
      entry,
    ]),
  );

  for (const row of rows || []) {
    if (!row?.[dateField]) {
      continue;
    }

    const entry = entries.get(
      getDateKey(row[dateField]),
    );

    if (entry) {
      entry.value += 1;
    }
  }

  return series;
}

async function getAllAuthUsers() {
  const users = [];
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } =
      await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      });

    if (error) {
      throw error;
    }

    const batch = data?.users || [];
    users.push(...batch);

    if (batch.length < perPage) {
      break;
    }

    page += 1;
  }

  return users;
}

async function getProfilesByIds(userIds) {
  const uniqueIds = [
    ...new Set(
      (userIds || []).filter(Boolean),
    ),
  ];

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, username, role, banned")
    .in("id", uniqueIds);

  if (error) {
    throw error;
  }

  return new Map(
    (data || []).map((profile) => [
      profile.id,
      profile,
    ]),
  );
}

/* =======================================================
   ANNOUNCEMENTS, MAINTENANCE + FEATURE CONTROLS
======================================================= */

const PLATFORM_SETTINGS_CACHE_TTL = 5 * 1000;

const DEFAULT_PLATFORM_SETTINGS = Object.freeze({
  id: 1,
  maintenance_enabled: false,
  maintenance_message:
    "Fuzz is temporarily undergoing maintenance. Please check back soon.",
  maintenance_end_at: null,
  allow_admin_bypass: true,
  ai_enabled: true,
  proxy_enabled: true,
  apps_enabled: true,
  games_enabled: true,
  registrations_enabled: true,
  image_uploads_enabled: true,
  updated_by: null,
  updated_at: null,
});

let platformSettingsCache = {
  expiresAt: 0,
  value: { ...DEFAULT_PLATFORM_SETTINGS },
};

function normalizePlatformSettings(row = {}) {
  return {
    ...DEFAULT_PLATFORM_SETTINGS,
    ...row,
    id: 1,
    maintenance_enabled:
      row.maintenance_enabled === true,
    allow_admin_bypass:
      row.allow_admin_bypass !== false,
    ai_enabled: row.ai_enabled !== false,
    proxy_enabled:
      row.proxy_enabled !== false,
    apps_enabled: row.apps_enabled !== false,
    games_enabled:
      row.games_enabled !== false,
    registrations_enabled:
      row.registrations_enabled !== false,
    image_uploads_enabled:
      row.image_uploads_enabled !== false,
  };
}

function setPlatformSettingsCache(value) {
  platformSettingsCache = {
    expiresAt:
      Date.now() +
      PLATFORM_SETTINGS_CACHE_TTL,
    value: normalizePlatformSettings(value),
  };

  return platformSettingsCache.value;
}

async function getPlatformSettings(
  forceRefresh = false,
) {
  if (
    !forceRefresh &&
    platformSettingsCache.value &&
    Date.now() <
      platformSettingsCache.expiresAt
  ) {
    return platformSettingsCache.value;
  }

  try {
    const { data, error } =
      await supabaseAdmin
        .from("platform_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

    if (error) {
      throw error;
    }

    return setPlatformSettingsCache(
      data || DEFAULT_PLATFORM_SETTINGS,
    );
  } catch (error) {
    console.error(
      "Platform settings load failed:",
      error,
    );

    platformSettingsCache.expiresAt =
      Date.now() +
      PLATFORM_SETTINGS_CACHE_TTL;

    return platformSettingsCache.value;
  }
}

function isMaintenanceActive(settings) {
  if (!settings?.maintenance_enabled) {
    return false;
  }

  if (!settings.maintenance_end_at) {
    return true;
  }

  const endTime = new Date(
    settings.maintenance_end_at,
  ).getTime();

  return (
    !Number.isFinite(endTime) ||
    endTime > Date.now()
  );
}

function serializePlatformSettings(
  settings,
  options = {},
) {
  return {
    maintenanceEnabled:
      settings.maintenance_enabled,
    maintenanceActive:
      isMaintenanceActive(settings),
    maintenanceMessage:
      settings.maintenance_message,
    maintenanceEndAt:
      settings.maintenance_end_at,
    allowAdminBypass:
      settings.allow_admin_bypass,
    aiEnabled: settings.ai_enabled,
    proxyEnabled:
      settings.proxy_enabled,
    appsEnabled: settings.apps_enabled,
    gamesEnabled:
      settings.games_enabled,
    registrationsEnabled:
      settings.registrations_enabled,
    imageUploadsEnabled:
      settings.image_uploads_enabled,
    updatedBy: settings.updated_by,
    updatedByUsername:
      options.updatedByUsername || null,
    updatedAt: settings.updated_at,
  };
}

function getAnnouncementStatus(
  announcement,
  now = Date.now(),
) {
  if (!announcement.active) {
    return "inactive";
  }

  const startsAt = new Date(
    announcement.starts_at,
  ).getTime();

  if (
    Number.isFinite(startsAt) &&
    startsAt > now
  ) {
    return "scheduled";
  }

  if (announcement.expires_at) {
    const expiresAt = new Date(
      announcement.expires_at,
    ).getTime();

    if (
      Number.isFinite(expiresAt) &&
      expiresAt <= now
    ) {
      return "expired";
    }
  }

  return "active";
}

function serializeAnnouncement(
  announcement,
) {
  return {
    id: announcement.id,
    title: announcement.title,
    message: announcement.message,
    style: announcement.style,
    audience: announcement.audience,
    startsAt: announcement.starts_at,
    expiresAt: announcement.expires_at,
    dismissible:
      announcement.dismissible !== false,
    active: announcement.active === true,
    status:
      getAnnouncementStatus(
        announcement,
      ),
    createdBy:
      announcement.created_by,
    createdAt:
      announcement.created_at,
    updatedAt:
      announcement.updated_at,
  };
}

function announcementMatchesAudience(
  audience,
  profile,
) {
  const role = profile?.role || null;

  if (audience === "all") {
    return true;
  }

  if (!role) {
    return false;
  }

  if (audience === "users") {
    return hasRole(profile, "user");
  }

  if (audience === "moderators") {
    return hasRole(profile, "moderator");
  }

  if (audience === "admins") {
    return hasRole(profile, "admin");
  }

  if (audience === "owners") {
    return role === "owner";
  }

  return false;
}

function requestContainsImage(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return (
      value.startsWith("data:image/") ||
      value.includes('"image_url"')
    );
  }

  if (Array.isArray(value)) {
    return value.some(requestContainsImage);
  }

  if (typeof value === "object") {
    if (
      value.hasImage === true ||
      value.has_image === true ||
      value.type === "input_image" ||
      value.type === "image_url" ||
      value.image_url ||
      value.imageUrl
    ) {
      return true;
    }

    return Object.values(value).some(
      requestContainsImage,
    );
  }

  return false;
}

function featureUnavailableResponse(
  res,
  feature,
) {
  return res.status(503).json({
    error:
      `${feature} is temporarily disabled by an administrator.`,
    featureDisabled: true,
    feature,
  });
}

app.get(
  "/api/platform/config",
  async (req, res) => {
    const settings =
      await getPlatformSettings();

    let auth = null;

    try {
      auth = await getAuthenticatedUser(
        req,
        res,
      );
    } catch {
      auth = null;
    }

    const maintenanceActive =
      isMaintenanceActive(settings);

    const bypass = Boolean(
      maintenanceActive &&
        settings.allow_admin_bypass &&
        hasRole(auth?.profile, "admin"),
    );

    res.setHeader(
      "Cache-Control",
      "no-store, max-age=0",
    );

    return res.json({
      maintenance: {
        enabled:
          settings.maintenance_enabled,
        active: maintenanceActive,
        message:
          settings.maintenance_message,
        endAt:
          settings.maintenance_end_at,
        bypass,
      },
      features: {
        ai: settings.ai_enabled,
        proxy: settings.proxy_enabled,
        apps: settings.apps_enabled,
        games: settings.games_enabled,
        registrations:
          settings.registrations_enabled,
        imageUploads:
          settings.image_uploads_enabled,
      },
      role: auth?.profile?.role || null,
      serverTime:
        new Date().toISOString(),
    });
  },
);

app.get(
  "/api/announcements/active",
  async (req, res) => {
    try {
      const now = new Date().toISOString();

      let auth = null;

      try {
        auth = await getAuthenticatedUser(
          req,
          res,
        );
      } catch {
        auth = null;
      }

      const { data, error } =
        await supabaseAdmin
          .from("announcements")
          .select("*")
          .eq("active", true)
          .lte("starts_at", now)
          .or(
            `expires_at.is.null,expires_at.gt.${now}`,
          )
          .order("created_at", {
            ascending: false,
          })
          .limit(20);

      if (error) {
        throw error;
      }

      const announcements = (
        data || []
      )
        .filter((announcement) =>
          announcementMatchesAudience(
            announcement.audience,
            auth?.profile,
          ),
        )
        .map(serializeAnnouncement);

      res.setHeader(
        "Cache-Control",
        "no-store, max-age=0",
      );

      return res.json({
        announcements,
      });
    } catch (error) {
      console.error(
        "Active announcements load failed:",
        error,
      );

      return res.json({
        announcements: [],
      });
    }
  },
);

const PLATFORM_MIDDLEWARE_EXEMPT_PATHS =
  new Set([
    "/health",
    "/maintenance",
    "/maintenance.html",
    "/feature-unavailable",
    "/feature-unavailable.html",
    "/login",
    "/login.html",
    "/verified",
    "/verified.html",
    "/suspended",
    "/suspended.html",
    "/api/auth/suspension",
    "/api/platform/config",
    "/api/announcements/active",
    "/api/release",
    "/api/status",
    "/status",
    "/status.html",
  ]);

app.use(async (req, res, next) => {
  try {
    const settings =
      await getPlatformSettings();

    if (
      req.method === "POST" &&
      req.path === "/api/auth/signup" &&
      !settings.registrations_enabled
    ) {
      return featureUnavailableResponse(
        res,
        "Account registration",
      );
    }

    if (
      req.path.startsWith("/api/ai/") &&
      !settings.ai_enabled
    ) {
      return featureUnavailableResponse(
        res,
        "Fuzz AI",
      );
    }

    if (
      req.method === "POST" &&
      req.path === "/api/proxy/log" &&
      !settings.proxy_enabled
    ) {
      return featureUnavailableResponse(
        res,
        "Proxy browsing",
      );
    }

    if (
      req.path.startsWith("/api/ai/") &&
      !settings.image_uploads_enabled &&
      requestContainsImage(req.body)
    ) {
      return featureUnavailableResponse(
        res,
        "AI image uploads",
      );
    }

    const disabledPage =
      (!settings.ai_enabled &&
        ["/ai", "/ai.html"].includes(
          req.path,
        ) &&
        "ai") ||
      (!settings.apps_enabled &&
        ["/b", "/apps.html"].includes(
          req.path,
        ) &&
        "apps") ||
      (!settings.games_enabled &&
        [
          "/a",
          "/games.html",
          "/play.html",
        ].includes(req.path) &&
        "games") ||
      (!settings.registrations_enabled &&
        [
          "/signup",
          "/signup.html",
        ].includes(req.path) &&
        "registrations");

    if (
      disabledPage &&
      ["GET", "HEAD"].includes(
        req.method,
      )
    ) {
      return res.redirect(
        `/feature-unavailable?feature=${encodeURIComponent(disabledPage)}`,
      );
    }

    if (!isMaintenanceActive(settings)) {
      return next();
    }

    if (
      PLATFORM_MIDDLEWARE_EXEMPT_PATHS.has(
        req.path,
      ) ||
      req.path.startsWith("/assets/") ||
      req.path.startsWith("/api/auth/") ||
      req.path.startsWith("/api/admin/") ||
      req.path === "/admin" ||
      req.path === "/admin.html"
    ) {
      return next();
    }

    let auth = null;

    if (settings.allow_admin_bypass) {
      try {
        auth = await getAuthenticatedUser(
          req,
          res,
        );
      } catch {
        auth = null;
      }
    }

    if (
      settings.allow_admin_bypass &&
      hasRole(auth?.profile, "admin")
    ) {
      return next();
    }

    if (req.path.startsWith("/api/")) {
      return res.status(503).json({
        error:
          settings.maintenance_message,
        maintenance: true,
        endAt:
          settings.maintenance_end_at,
      });
    }

    const acceptsHtml =
      req.accepts(["html", "json"]) ===
      "html";

    if (
      ["GET", "HEAD"].includes(
        req.method,
      ) &&
      acceptsHtml
    ) {
      return res.redirect("/maintenance");
    }

    return res.status(503).send(
      settings.maintenance_message,
    );
  } catch (error) {
    console.error(
      "Platform gate warning:",
      error,
    );

    return next();
  }
});

app.get(
  "/api/admin/platform/settings",
  requireRole("owner"),
  async (req, res) => {
    try {
      const settings =
        await getPlatformSettings(true);

      let updatedByUsername = null;

      if (settings.updated_by) {
        const profileMap =
          await getProfilesByIds([
            settings.updated_by,
          ]);

        updatedByUsername =
          profileMap.get(
            settings.updated_by,
          )?.username || null;
      }

      return res.json({
        settings:
          serializePlatformSettings(
            settings,
            { updatedByUsername },
          ),
      });
    } catch (error) {
      console.error(
        "Platform settings admin load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Platform settings could not be loaded. Run the included database SQL first.",
      });
    }
  },
);

app.patch(
  "/api/admin/platform/settings",
  requireRole("owner"),
  async (req, res) => {
    const current =
      await getPlatformSettings(true);

    const maintenanceMessage = String(
      req.body.maintenanceMessage ??
        current.maintenance_message,
    )
      .trim()
      .slice(0, 500);

    const maintenanceEndAtValue =
      req.body.maintenanceEndAt;

    let maintenanceEndAt =
      current.maintenance_end_at;

    if (
      maintenanceEndAtValue === null ||
      maintenanceEndAtValue === ""
    ) {
      maintenanceEndAt = null;
    } else if (
      maintenanceEndAtValue !== undefined
    ) {
      const parsed = new Date(
        maintenanceEndAtValue,
      );

      if (
        Number.isNaN(parsed.getTime())
      ) {
        return res.status(400).json({
          error:
            "The maintenance end time is invalid.",
        });
      }

      maintenanceEndAt =
        parsed.toISOString();
    }

    const nextSettings = {
      id: 1,
      maintenance_enabled:
        req.body.maintenanceEnabled ===
        undefined
          ? current.maintenance_enabled
          : req.body.maintenanceEnabled ===
            true,
      maintenance_message:
        maintenanceMessage ||
        DEFAULT_PLATFORM_SETTINGS.maintenance_message,
      maintenance_end_at:
        maintenanceEndAt,
      allow_admin_bypass:
        req.body.allowAdminBypass ===
        undefined
          ? current.allow_admin_bypass
          : req.body.allowAdminBypass !==
            false,
      ai_enabled:
        req.body.aiEnabled === undefined
          ? current.ai_enabled
          : req.body.aiEnabled === true,
      proxy_enabled:
        req.body.proxyEnabled ===
        undefined
          ? current.proxy_enabled
          : req.body.proxyEnabled === true,
      apps_enabled:
        req.body.appsEnabled ===
        undefined
          ? current.apps_enabled
          : req.body.appsEnabled === true,
      games_enabled:
        req.body.gamesEnabled ===
        undefined
          ? current.games_enabled
          : req.body.gamesEnabled === true,
      registrations_enabled:
        req.body.registrationsEnabled ===
        undefined
          ? current.registrations_enabled
          : req.body.registrationsEnabled ===
            true,
      image_uploads_enabled:
        req.body.imageUploadsEnabled ===
        undefined
          ? current.image_uploads_enabled
          : req.body.imageUploadsEnabled ===
            true,
      updated_by: req.auth.user.id,
      updated_at:
        new Date().toISOString(),
    };

    try {
      const { data, error } =
        await supabaseAdmin
          .from("platform_settings")
          .upsert(nextSettings, {
            onConflict: "id",
          })
          .select("*")
          .single();

      if (error) {
        throw error;
      }

      const saved =
        setPlatformSettingsCache(data);

      invalidateAdminCache();

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId:
          req.auth.user.id,
        category: "admin",
        action:
          "admin.platform_settings_updated",
        status: "success",
        description:
          `${req.auth.profile.username} updated platform settings.`,
        resourceType:
          "platform_settings",
        resourceId: "1",
        responseStatus: 200,
        oldValues:
          serializePlatformSettings(
            current,
          ),
        newValues:
          serializePlatformSettings(
            saved,
          ),
      });

      return res.json({
        success: true,
        settings:
          serializePlatformSettings(
            saved,
            {
              updatedByUsername:
                req.auth.profile.username,
            },
          ),
      });
    } catch (error) {
      console.error(
        "Platform settings update failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Platform settings could not be saved. Run the included database SQL first.",
      });
    }
  },
);

app.get(
  "/api/admin/announcements",
  requireRole("owner"),
  async (req, res) => {
    const requestedStatus = String(
      req.query.status || "all",
    )
      .trim()
      .toLowerCase();

    try {
      const { data, error } =
        await supabaseAdmin
          .from("announcements")
          .select("*")
          .order("created_at", {
            ascending: false,
          })
          .limit(500);

      if (error) {
        throw error;
      }

      const serialized = (
        data || []
      ).map(serializeAnnouncement);

      const counts = {
        all: serialized.length,
        active: 0,
        scheduled: 0,
        inactive: 0,
        expired: 0,
      };

      for (const announcement of serialized) {
        if (
          counts[announcement.status] !==
          undefined
        ) {
          counts[announcement.status] += 1;
        }
      }

      const announcements =
        requestedStatus === "all"
          ? serialized
          : serialized.filter(
              (announcement) =>
                announcement.status ===
                requestedStatus,
            );

      return res.json({
        announcements,
        counts,
      });
    } catch (error) {
      console.error(
        "Admin announcements load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Announcements could not be loaded. Run the included database SQL first.",
      });
    }
  },
);

app.post(
  "/api/admin/announcements",
  requireRole("owner"),
  async (req, res) => {
    const title = String(
      req.body.title || "",
    )
      .trim()
      .slice(0, 120);

    const message = String(
      req.body.message || "",
    )
      .trim()
      .slice(0, 1200);

    const style = String(
      req.body.style || "info",
    ).toLowerCase();

    const audience = String(
      req.body.audience || "all",
    ).toLowerCase();

    if (!title || !message) {
      return res.status(400).json({
        error:
          "Announcement title and message are required.",
      });
    }

    if (
      ![
        "info",
        "success",
        "warning",
        "critical",
      ].includes(style)
    ) {
      return res.status(400).json({
        error:
          "Choose a valid announcement style.",
      });
    }

    if (
      ![
        "all",
        "users",
        "moderators",
        "admins",
        "owners",
      ].includes(audience)
    ) {
      return res.status(400).json({
        error:
          "Choose a valid announcement audience.",
      });
    }

    const startsAt = req.body.startsAt
      ? new Date(req.body.startsAt)
      : new Date();

    const expiresAt =
      req.body.expiresAt
        ? new Date(req.body.expiresAt)
        : null;

    if (
      Number.isNaN(startsAt.getTime()) ||
      (expiresAt &&
        Number.isNaN(expiresAt.getTime()))
    ) {
      return res.status(400).json({
        error:
          "The announcement schedule is invalid.",
      });
    }

    if (
      expiresAt &&
      expiresAt <= startsAt
    ) {
      return res.status(400).json({
        error:
          "Expiration must be after the start time.",
      });
    }

    const insertValues = {
      title,
      message,
      style,
      audience,
      starts_at:
        startsAt.toISOString(),
      expires_at:
        expiresAt?.toISOString() || null,
      dismissible:
        req.body.dismissible !== false,
      active: req.body.active !== false,
      created_by: req.auth.user.id,
      updated_at:
        new Date().toISOString(),
    };

    try {
      const { data, error } =
        await supabaseAdmin
          .from("announcements")
          .insert(insertValues)
          .select("*")
          .single();

      if (error) {
        throw error;
      }

      invalidateAdminCache();

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId:
          req.auth.user.id,
        category: "admin",
        action:
          "admin.announcement_created",
        status: "success",
        description:
          `${req.auth.profile.username} created an announcement.`,
        resourceType: "announcement",
        resourceId: data.id,
        responseStatus: 201,
        newValues:
          serializeAnnouncement(data),
      });

      return res.status(201).json({
        announcement:
          serializeAnnouncement(data),
      });
    } catch (error) {
      console.error(
        "Announcement creation failed:",
        error,
      );

      return res.status(500).json({
        error:
          "The announcement could not be created.",
      });
    }
  },
);

app.patch(
  "/api/admin/announcements/:announcementId",
  requireRole("owner"),
  async (req, res) => {
    const announcementId = String(
      req.params.announcementId || "",
    );

    try {
      const {
        data: current,
        error: currentError,
      } = await supabaseAdmin
        .from("announcements")
        .select("*")
        .eq("id", announcementId)
        .maybeSingle();

      if (currentError) {
        throw currentError;
      }

      if (!current) {
        return res.status(404).json({
          error:
            "That announcement was not found.",
        });
      }

      const title = String(
        req.body.title ?? current.title,
      )
        .trim()
        .slice(0, 120);

      const message = String(
        req.body.message ?? current.message,
      )
        .trim()
        .slice(0, 1200);

      const style = String(
        req.body.style ?? current.style,
      ).toLowerCase();

      const audience = String(
        req.body.audience ??
          current.audience,
      ).toLowerCase();

      if (!title || !message) {
        return res.status(400).json({
          error:
            "Announcement title and message are required.",
        });
      }

      if (
        ![
          "info",
          "success",
          "warning",
          "critical",
        ].includes(style) ||
        ![
          "all",
          "users",
          "moderators",
          "admins",
          "owners",
        ].includes(audience)
      ) {
        return res.status(400).json({
          error:
            "The announcement style or audience is invalid.",
        });
      }

      const startsAtValue =
        req.body.startsAt === undefined
          ? current.starts_at
          : req.body.startsAt;

      const expiresAtValue =
        req.body.expiresAt === undefined
          ? current.expires_at
          : req.body.expiresAt;

      const startsAt = startsAtValue
        ? new Date(startsAtValue)
        : new Date();

      const expiresAt = expiresAtValue
        ? new Date(expiresAtValue)
        : null;

      if (
        Number.isNaN(startsAt.getTime()) ||
        (expiresAt &&
          Number.isNaN(expiresAt.getTime()))
      ) {
        return res.status(400).json({
          error:
            "The announcement schedule is invalid.",
        });
      }

      if (
        expiresAt &&
        expiresAt <= startsAt
      ) {
        return res.status(400).json({
          error:
            "Expiration must be after the start time.",
        });
      }

      const updates = {
        title,
        message,
        style,
        audience,
        starts_at:
          startsAt.toISOString(),
        expires_at:
          expiresAt?.toISOString() || null,
        dismissible:
          req.body.dismissible ===
          undefined
            ? current.dismissible
            : req.body.dismissible !== false,
        active:
          req.body.active === undefined
            ? current.active
            : req.body.active === true,
        updated_at:
          new Date().toISOString(),
      };

      const { data, error } =
        await supabaseAdmin
          .from("announcements")
          .update(updates)
          .eq("id", announcementId)
          .select("*")
          .single();

      if (error) {
        throw error;
      }

      invalidateAdminCache();

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId:
          req.auth.user.id,
        category: "admin",
        action:
          "admin.announcement_updated",
        status: "success",
        description:
          `${req.auth.profile.username} updated an announcement.`,
        resourceType: "announcement",
        resourceId: announcementId,
        responseStatus: 200,
        oldValues:
          serializeAnnouncement(current),
        newValues:
          serializeAnnouncement(data),
      });

      return res.json({
        announcement:
          serializeAnnouncement(data),
      });
    } catch (error) {
      console.error(
        "Announcement update failed:",
        error,
      );

      return res.status(500).json({
        error:
          "The announcement could not be updated.",
      });
    }
  },
);

app.delete(
  "/api/admin/announcements/:announcementId",
  requireRole("owner"),
  async (req, res) => {
    const announcementId = String(
      req.params.announcementId || "",
    );

    try {
      const { data, error } =
        await supabaseAdmin
          .from("announcements")
          .delete()
          .eq("id", announcementId)
          .select("*")
          .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return res.status(404).json({
          error:
            "That announcement was not found.",
        });
      }

      invalidateAdminCache();

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId:
          req.auth.user.id,
        category: "admin",
        action:
          "admin.announcement_deleted",
        status: "success",
        description:
          `${req.auth.profile.username} deleted an announcement.`,
        resourceType: "announcement",
        resourceId: announcementId,
        responseStatus: 200,
        oldValues:
          serializeAnnouncement(data),
      });

      return res.json({
        success: true,
      });
    } catch (error) {
      console.error(
        "Announcement deletion failed:",
        error,
      );

      return res.status(500).json({
        error:
          "The announcement could not be deleted.",
      });
    }
  },
);

/* =======================================================
   FUZZ SUSPENSIONS + USAGE LIMITS HELPERS
======================================================= */

const USAGE_POLICY_ROLES = [
  "user",
  "moderator",
  "admin",
  "owner",
];

const USAGE_LIMIT_FIELDS = [
  "ai_messages_daily",
  "ai_images_daily",
  "proxy_requests_minute",
  "proxy_requests_daily",
  "auto_suspend_after_violations",
  "auto_suspend_minutes",
];

function getSuspensionState(profile) {
  const suspendedUntil = profile?.suspended_until
    ? new Date(profile.suspended_until)
    : null;

  const suspendedUntilMs =
    suspendedUntil?.getTime();

  const active =
    Number.isFinite(suspendedUntilMs) &&
    suspendedUntilMs > Date.now();

  return {
    active,
    suspendedUntil:
      profile?.suspended_until || null,
    reason:
      profile?.suspension_reason || null,
    suspendedAt:
      profile?.suspended_at || null,
    suspendedBy:
      profile?.suspended_by || null,
    source:
      profile?.suspension_source || null,
  };
}

async function resolveProfileSuspension(
  userId,
  profile,
) {
  const state = getSuspensionState(profile);

  if (
    !state.active &&
    profile?.suspended_until
  ) {
    const previous = {
      suspendedUntil:
        profile.suspended_until,
      reason:
        profile.suspension_reason,
      source:
        profile.suspension_source,
    };

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        suspended_until: null,
        suspension_reason: null,
        suspended_at: null,
        suspended_by: null,
        suspension_source: null,
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", userId)
      .lte(
        "suspended_until",
        new Date().toISOString(),
      );

    if (error) {
      console.error(
        "Expired suspension cleanup failed:",
        error,
      );
    } else {
      profile.suspended_until = null;
      profile.suspension_reason = null;
      profile.suspended_at = null;
      profile.suspended_by = null;
      profile.suspension_source = null;

      void writeActivityLog({
        userId,
        targetUserId: userId,
        category: "security",
        action:
          "account.suspension_expired",
        status: "success",
        description:
          "A temporary account suspension expired automatically.",
        resourceType: "user",
        resourceId: userId,
        responseStatus: 200,
        oldValues: previous,
        newValues: {
          suspendedUntil: null,
        },
      });
    }
  }

  return getSuspensionState(profile);
}

function sendSuspensionResponse(
  res,
  suspension,
) {
  return res.status(423).json({
    error:
      suspension?.reason ||
      "This account is temporarily suspended.",
    suspended: true,
    suspendedUntil:
      suspension?.suspendedUntil || null,
    reason:
      suspension?.reason || null,
    source:
      suspension?.source || null,
  });
}

function usageLimitMessage(blockedType) {
  const labels = {
    ai_messages_daily:
      "You have reached your daily Fuzz AI message limit.",
    ai_images_daily:
      "You have reached your daily AI image-upload limit.",
    proxy_requests_minute:
      "You are using the proxy too quickly. Wait a moment and try again.",
    proxy_requests_daily:
      "You have reached your daily proxy request limit.",
  };

  return (
    labels[blockedType] ||
    "You have reached an account usage limit."
  );
}

async function consumeUsageBundle({
  userId,
  role,
  aiMessages = 0,
  aiImages = 0,
  proxyRequests = 0,
}) {
  const { data, error } =
    await supabaseAdmin.rpc(
      "fuzz_consume_usage",
      {
        p_user_id: userId,
        p_role: role || "user",
        p_ai_messages:
          Math.max(0, aiMessages),
        p_ai_images:
          Math.max(0, aiImages),
        p_proxy_requests:
          Math.max(0, proxyRequests),
      },
    );

  if (error) {
    throw error;
  }

  return data || {
    allowed: true,
  };
}

async function enforceUsageLimit(
  req,
  res,
  bundle,
) {
  let decision;

  try {
    decision = await consumeUsageBundle({
      userId: req.auth.user.id,
      role: req.auth.profile.role,
      ...bundle,
    });
  } catch (error) {
    console.error(
      "Usage-limit check failed:",
      error,
    );

    return res.status(503).json({
      error:
        "The usage-limit service is temporarily unavailable.",
    });
  }

  if (decision.allowed !== false) {
    req.usageDecision = decision;
    return true;
  }

  const message = usageLimitMessage(
    decision.blockedType,
  );

  const autoSuspended =
    decision.autoSuspended === true;

  void writeActivityLog({
    req,
    userId: req.auth.user.id,
    targetUserId: req.auth.user.id,
    category: "security",
    action: autoSuspended
      ? "account.auto_suspended"
      : "usage.limit_blocked",
    status: autoSuspended
      ? "failure"
      : "warning",
    description: autoSuspended
      ? `${req.auth.profile.username} was automatically suspended after repeated usage-limit violations.`
      : `${req.auth.profile.username} was blocked by ${decision.blockedType || "a usage limit"}.`,
    resourceType: "user",
    resourceId: req.auth.user.id,
    responseStatus: autoSuspended
      ? 423
      : 429,
    metadata: {
      ...decision,
      username:
        req.auth.profile.username,
    },
  });

  void createOrBumpAdminNotification({
    notificationType: autoSuspended
      ? "account.automatic_suspension"
      : "usage.limit_violation",
    severity: autoSuspended
      ? "critical"
      : "warning",
    title: autoSuspended
      ? "Account automatically suspended"
      : "Usage limit triggered",
    message: autoSuspended
      ? `${req.auth.profile.username} was suspended until ${decision.suspendedUntil || "the configured expiration time"} after repeated limit violations.`
      : `${req.auth.profile.username} triggered ${decision.blockedType || "an account usage limit"}.`,
    targetUserId: req.auth.user.id,
    resourceType: "user",
    resourceId: req.auth.user.id,
    dedupeKey: autoSuspended
      ? `auto-suspension:${req.auth.user.id}`
      : `usage-violation:${req.auth.user.id}:${decision.blockedType || "unknown"}`,
    metadata: decision,
    cooldownMs: autoSuspended
      ? 60 * 60 * 1000
      : 15 * 60 * 1000,
  });

  if (decision.retryAfterSeconds) {
    res.setHeader(
      "Retry-After",
      String(decision.retryAfterSeconds),
    );
  }

  if (autoSuspended) {
    return sendSuspensionResponse(res, {
      active: true,
      suspendedUntil:
        decision.suspendedUntil,
      reason:
        "Automatically suspended after repeated usage-limit violations.",
      source:
        "automatic_usage_limit",
    });
  }

  return res.status(429).json({
    error: message,
    usageLimited: true,
    blockedType:
      decision.blockedType || null,
    limit: decision.limit ?? null,
    used: decision.used ?? null,
    remaining:
      decision.remaining ?? 0,
    retryAfterSeconds:
      decision.retryAfterSeconds || null,
    violationCount:
      decision.violationCount || 0,
  });
}

function serializeUsagePolicy(row) {
  return {
    role: row.role,
    aiMessagesDaily:
      row.ai_messages_daily,
    aiImagesDaily:
      row.ai_images_daily,
    proxyRequestsMinute:
      row.proxy_requests_minute,
    proxyRequestsDaily:
      row.proxy_requests_daily,
    violationWindowMinutes:
      row.violation_window_minutes,
    autoSuspendAfterViolations:
      row.auto_suspend_after_violations,
    autoSuspendMinutes:
      row.auto_suspend_minutes,
    updatedAt: row.updated_at,
  };
}

function serializeUsageOverride(row) {
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    aiMessagesDaily:
      row.ai_messages_daily,
    aiImagesDaily:
      row.ai_images_daily,
    proxyRequestsMinute:
      row.proxy_requests_minute,
    proxyRequestsDaily:
      row.proxy_requests_daily,
    autoSuspendAfterViolations:
      row.auto_suspend_after_violations,
    autoSuspendMinutes:
      row.auto_suspend_minutes,
    updatedAt: row.updated_at,
  };
}

function mergeUsagePolicy(
  policy,
  override,
) {
  const getValue = (field) =>
    override?.[field] ?? policy?.[field] ?? 0;

  return {
    role:
      policy?.role || "user",
    aiMessagesDaily:
      getValue("ai_messages_daily"),
    aiImagesDaily:
      getValue("ai_images_daily"),
    proxyRequestsMinute:
      getValue("proxy_requests_minute"),
    proxyRequestsDaily:
      getValue("proxy_requests_daily"),
    violationWindowMinutes:
      policy?.violation_window_minutes || 60,
    autoSuspendAfterViolations:
      getValue(
        "auto_suspend_after_violations",
      ),
    autoSuspendMinutes:
      getValue("auto_suspend_minutes") || 60,
  };
}

async function getEffectiveUsagePolicy(
  userId,
  role,
) {
  const [policyResult, overrideResult] =
    await Promise.all([
      supabaseAdmin
        .from("usage_policies")
        .select("*")
        .eq(
          "role",
          USAGE_POLICY_ROLES.includes(role)
            ? role
            : "user",
        )
        .maybeSingle(),
      supabaseAdmin
        .from("user_usage_overrides")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

  if (policyResult.error) {
    throw policyResult.error;
  }

  if (overrideResult.error) {
    throw overrideResult.error;
  }

  return {
    policy: policyResult.data,
    override: overrideResult.data,
    effective: mergeUsagePolicy(
      policyResult.data,
      overrideResult.data,
    ),
  };
}

async function getUserUsageSnapshot(
  userId,
) {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);

  const minuteStart = new Date(
    now.getTime() - 60 * 1000,
  );

  const [todayResult, minuteResult, violationsResult] =
    await Promise.all([
      supabaseAdmin
        .from("usage_events")
        .select("usage_type, amount")
        .eq("user_id", userId)
        .gte(
          "created_at",
          dayStart.toISOString(),
        )
        .in("usage_type", [
          "ai_message",
          "ai_image",
          "proxy_request",
        ]),
      supabaseAdmin
        .from("usage_events")
        .select("amount")
        .eq("user_id", userId)
        .eq(
          "usage_type",
          "proxy_request",
        )
        .gte(
          "created_at",
          minuteStart.toISOString(),
        ),
      supabaseAdmin
        .from("usage_events")
        .select(
          "id, created_at, metadata",
        )
        .eq("user_id", userId)
        .eq(
          "usage_type",
          "limit_violation",
        )
        .order("created_at", {
          ascending: false,
        })
        .limit(25),
    ]);

  const error =
    todayResult.error ||
    minuteResult.error ||
    violationsResult.error;

  if (error) {
    throw error;
  }

  const totals = {
    aiMessagesToday: 0,
    aiImagesToday: 0,
    proxyRequestsToday: 0,
    proxyRequestsMinute: 0,
  };

  for (const event of todayResult.data || []) {
    const amount = Number(event.amount || 0);

    if (event.usage_type === "ai_message") {
      totals.aiMessagesToday += amount;
    } else if (
      event.usage_type === "ai_image"
    ) {
      totals.aiImagesToday += amount;
    } else if (
      event.usage_type === "proxy_request"
    ) {
      totals.proxyRequestsToday += amount;
    }
  }

  totals.proxyRequestsMinute = (
    minuteResult.data || []
  ).reduce(
    (sum, event) =>
      sum + Number(event.amount || 0),
    0,
  );

  return {
    totals,
    recentViolations:
      violationsResult.data || [],
    dayStartedAt:
      dayStart.toISOString(),
  };
}

function parseOptionalUsageLimit(
  value,
  options = {},
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number.parseInt(
    String(value),
    10,
  );

  if (!Number.isFinite(parsed)) {
    throw new Error(
      "Usage limits must be whole numbers.",
    );
  }

  const minimum = options.minimum ?? 0;
  const maximum =
    options.maximum ?? 1000000;

  if (
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(
      `Usage limits must be between ${minimum} and ${maximum}.`,
    );
  }

  return parsed;
}

/* =======================================================
   FUZZ SECURITY CENTER HELPERS
======================================================= */

const SECURITY_SESSION_COOKIE = "fuzz_security_session";
const SECURITY_ACTIVE_WINDOW_MS = 15 * 60 * 1000;
const SECURITY_RAPID_IP_WINDOW_MS = 10 * 60 * 1000;
const SECURITY_NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;
const SECURITY_NOTIFICATION_BUMP_MS = 5 * 60 * 1000;

function hashSecurityValue(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function getSecurityCookieOptions(req) {
  return {
    ...getCookieOptions(req),
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}

function clearSecurityCookie(req, res) {
  res.clearCookie(
    SECURITY_SESSION_COOKIE,
    getClearCookieOptions(req),
  );
}

function getSecuritySessionHash(req) {
  const token = String(
    req.cookies?.[SECURITY_SESSION_COOKIE] || "",
  );

  return token ? hashSecurityValue(token) : null;
}

function securitySeverityRank(value) {
  return {
    info: 1,
    warning: 2,
    critical: 3,
  }[value] || 1;
}

async function createOrBumpAdminNotification({
  notificationType,
  severity = "info",
  title,
  message,
  targetUserId = null,
  resourceType = null,
  resourceId = null,
  dedupeKey = null,
  metadata = {},
  cooldownMs = SECURITY_NOTIFICATION_COOLDOWN_MS,
}) {
  const now = new Date();
  const cooldownAfter = new Date(
    now.getTime() - cooldownMs,
  ).toISOString();

  try {
    let existing = null;

    if (dedupeKey) {
      const { data, error } = await supabaseAdmin
        .from("admin_notifications")
        .select("*")
        .eq("dedupe_key", dedupeKey)
        .is("resolved_at", null)
        .gte("last_occurred_at", cooldownAfter)
        .order("last_occurred_at", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }

      existing = data;
    }

    if (existing) {
      const lastOccurred = new Date(
        existing.last_occurred_at,
      ).getTime();

      if (
        Number.isFinite(lastOccurred) &&
        now.getTime() - lastOccurred <
          SECURITY_NOTIFICATION_BUMP_MS
      ) {
        return {
          notification: existing,
          changed: false,
        };
      }

      const nextSeverity =
        securitySeverityRank(severity) >
        securitySeverityRank(existing.severity)
          ? severity
          : existing.severity;

      const { data, error } = await supabaseAdmin
        .from("admin_notifications")
        .update({
          severity: nextSeverity,
          title,
          message,
          occurrence_count:
            Number(existing.occurrence_count || 1) + 1,
          metadata,
          last_occurred_at: now.toISOString(),
        })
        .eq("id", existing.id)
        .select("*")
        .single();

      if (error) {
        throw error;
      }

      return {
        notification: data,
        changed: true,
      };
    }

    const { data, error } = await supabaseAdmin
      .from("admin_notifications")
      .insert({
        notification_type: notificationType,
        severity,
        title,
        message,
        target_user_id: targetUserId,
        resource_type: resourceType,
        resource_id: resourceId,
        dedupe_key: dedupeKey,
        occurrence_count: 1,
        metadata,
        created_at: now.toISOString(),
        last_occurred_at: now.toISOString(),
      })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    invalidateAdminCache();

    return {
      notification: data,
      changed: true,
    };
  } catch (error) {
    console.error(
      "Admin notification creation failed:",
      error,
    );

    return {
      notification: null,
      changed: false,
    };
  }
}

function serializeSecuritySession(row, options = {}) {
  const now = Date.now();
  const lastSeen = new Date(
    row.last_seen_at,
  ).getTime();
  const expiresAt = new Date(
    row.expires_at,
  ).getTime();

  const active =
    !row.revoked_at &&
    Number.isFinite(lastSeen) &&
    now - lastSeen <= SECURITY_ACTIVE_WINDOW_MS &&
    (!Number.isFinite(expiresAt) || expiresAt > now);

  return {
    id: row.id,
    userId: row.user_id,
    username:
      options.username || "Unknown",
    deviceHash: row.device_hash,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    browser: row.browser,
    operatingSystem:
      row.operating_system,
    deviceType: row.device_type,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
    active,
    expired:
      Number.isFinite(expiresAt) &&
      expiresAt <= now,
    current:
      options.currentSessionHash ===
      row.session_token_hash,
    multipleDeviceActive:
      options.multipleDeviceActive === true,
  };
}

async function getRecentSecuritySessions(userId) {
  const activeAfter = new Date(
    Date.now() - SECURITY_ACTIVE_WINDOW_MS,
  ).toISOString();

  const { data, error } = await supabaseAdmin
    .from("user_security_sessions")
    .select("*")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .gte("last_seen_at", activeAfter)
    .gt("expires_at", new Date().toISOString())
    .order("last_seen_at", {
      ascending: false,
    })
    .limit(50);

  if (error) {
    throw error;
  }

  return data || [];
}

async function evaluateMultipleLoginSecurity({
  req,
  userId,
  username,
  currentSession = null,
}) {
  try {
    const sessions =
      await getRecentSecuritySessions(userId);

    const deviceHashes = new Set(
      sessions
        .map((session) => session.device_hash)
        .filter(Boolean),
    );

    const ipAddresses = new Set(
      sessions
        .map((session) => session.ip_address)
        .filter(Boolean),
    );

    if (deviceHashes.size < 2) {
      return;
    }

    const severity =
      deviceHashes.size >= 3
        ? "critical"
        : "warning";

    const deviceSummary = sessions
      .slice(0, 4)
      .map(
        (session) =>
          `${session.browser || "Unknown browser"}/${session.operating_system || "Unknown OS"}`,
      )
      .filter(
        (value, index, values) =>
          values.indexOf(value) === index,
      )
      .join(", ");

    const result =
      await createOrBumpAdminNotification({
        notificationType:
          "account.multiple_sessions_detected",
        severity,
        title:
          "Multiple active logins detected",
        message:
          `${username} has ${deviceHashes.size} different devices active within 15 minutes${ipAddresses.size > 1 ? ` across ${ipAddresses.size} IP addresses` : ""}. ${deviceSummary}`,
        targetUserId: userId,
        resourceType: "user",
        resourceId: userId,
        dedupeKey:
          `multiple-logins:${userId}`,
        metadata: {
          activeSessions: sessions.length,
          distinctDevices:
            deviceHashes.size,
          distinctIps:
            ipAddresses.size,
          devices: sessions.map(
            (session) => ({
              sessionId: session.id,
              browser: session.browser,
              operatingSystem:
                session.operating_system,
              deviceType:
                session.device_type,
              ipAddress:
                session.ip_address,
              lastSeenAt:
                session.last_seen_at,
            }),
          ),
          currentSessionId:
            currentSession?.id || null,
        },
      });

    if (result.changed) {
      void writeActivityLog({
        req,
        userId,
        targetUserId: userId,
        category: "security",
        action:
          "account.multiple_sessions_detected",
        status: "warning",
        description:
          `${username} had ${deviceHashes.size} different devices active within 15 minutes.`,
        resourceType: "user",
        resourceId: userId,
        responseStatus: 200,
        metadata: {
          activeSessions: sessions.length,
          distinctDevices:
            deviceHashes.size,
          distinctIps:
            ipAddresses.size,
        },
      });
    }
  } catch (error) {
    console.error(
      "Multiple-login evaluation failed:",
      error,
    );
  }
}

async function registerSecuritySession(
  req,
  res,
  user,
  profile,
) {
  const now = new Date();
  const client = getClientInfo(req);
  const rawSessionToken = crypto
    .randomBytes(32)
    .toString("base64url");
  const sessionTokenHash =
    hashSecurityValue(rawSessionToken);
  const deviceHash = hashSecurityValue(
    [
      client.userAgent,
      client.browser,
      client.operatingSystem,
      client.deviceType,
    ].join("|"),
  );

  try {
    const { data: previousSessions, error } =
      await supabaseAdmin
        .from("user_security_sessions")
        .select("*")
        .eq("user_id", user.id)
        .order("last_seen_at", {
          ascending: false,
        })
        .limit(100);

    if (error) {
      throw error;
    }

    const previous = previousSessions || [];
    const knownDevice = previous.some(
      (session) =>
        session.device_hash === deviceHash,
    );

    const mostRecentSameDevice =
      previous.find(
        (session) =>
          session.device_hash === deviceHash,
      ) || null;

    const { data: session, error: insertError } =
      await supabaseAdmin
        .from("user_security_sessions")
        .insert({
          user_id: user.id,
          session_token_hash:
            sessionTokenHash,
          device_hash: deviceHash,
          ip_address: client.ipAddress,
          user_agent: client.userAgent,
          browser: client.browser,
          operating_system:
            client.operatingSystem,
          device_type: client.deviceType,
          first_seen_at: now.toISOString(),
          last_seen_at: now.toISOString(),
          expires_at: new Date(
            now.getTime() +
              30 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          metadata: {
            loginPath:
              req.originalUrl || req.url,
          },
        })
        .select("*")
        .single();

    if (insertError) {
      throw insertError;
    }

    res.cookie(
      SECURITY_SESSION_COOKIE,
      rawSessionToken,
      getSecurityCookieOptions(req),
    );

    if (!knownDevice && previous.length > 0) {
      const result =
        await createOrBumpAdminNotification({
          notificationType:
            "account.new_device_login",
          severity: "info",
          title: "New device login",
          message:
            `${profile.username} signed in from ${client.browser}/${client.operatingSystem} on a ${client.deviceType}.`,
          targetUserId: user.id,
          resourceType: "security_session",
          resourceId: session.id,
          dedupeKey:
            `new-device:${user.id}:${deviceHash}`,
          cooldownMs:
            7 * 24 * 60 * 60 * 1000,
          metadata: {
            sessionId: session.id,
            browser: client.browser,
            operatingSystem:
              client.operatingSystem,
            deviceType:
              client.deviceType,
            ipAddress:
              client.ipAddress,
          },
        });

      if (result.changed) {
        void writeActivityLog({
          req,
          userId: user.id,
          targetUserId: user.id,
          category: "security",
          action:
            "account.new_device_login",
          status: "informational",
          description:
            `${profile.username} signed in from a new device.`,
          resourceType:
            "security_session",
          resourceId: session.id,
          responseStatus: 200,
          metadata: {
            browser: client.browser,
            operatingSystem:
              client.operatingSystem,
            deviceType:
              client.deviceType,
            ipAddress:
              client.ipAddress,
          },
        });
      }
    }

    if (
      mostRecentSameDevice?.ip_address &&
      client.ipAddress &&
      mostRecentSameDevice.ip_address !==
        client.ipAddress
    ) {
      const previousSeenAt = new Date(
        mostRecentSameDevice.last_seen_at,
      ).getTime();

      if (
        Number.isFinite(previousSeenAt) &&
        now.getTime() - previousSeenAt <=
          SECURITY_RAPID_IP_WINDOW_MS
      ) {
        await createOrBumpAdminNotification({
          notificationType:
            "account.rapid_ip_change",
          severity: "info",
          title: "Rapid IP change detected",
          message:
            `${profile.username}'s ${client.browser}/${client.operatingSystem} login changed IP addresses within 10 minutes. This can happen with VPNs or mobile networks.`,
          targetUserId: user.id,
          resourceType:
            "security_session",
          resourceId: session.id,
          dedupeKey:
            `rapid-ip:${user.id}:${deviceHash}`,
          metadata: {
            oldIp:
              mostRecentSameDevice.ip_address,
            newIp: client.ipAddress,
            previousSessionId:
              mostRecentSameDevice.id,
            sessionId: session.id,
          },
        });
      }
    }

    await evaluateMultipleLoginSecurity({
      req,
      userId: user.id,
      username: profile.username,
      currentSession: session,
    });

    return session;
  } catch (error) {
    console.error(
      "Security session registration failed:",
      error,
    );

    return null;
  }
}

async function ensureSecuritySession(
  req,
  res,
  user,
  profile,
) {
  const currentHash =
    getSecuritySessionHash(req);

  if (!currentHash) {
    return registerSecuritySession(
      req,
      res,
      user,
      profile,
    );
  }

  const { data, error } = await supabaseAdmin
    .from("user_security_sessions")
    .select("*")
    .eq("session_token_hash", currentHash)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    clearSecurityCookie(req, res);
    return registerSecuritySession(
      req,
      res,
      user,
      profile,
    );
  }

  return data;
}

async function touchSecuritySession(
  req,
  res,
  user,
  profile,
) {
  const session =
    await ensureSecuritySession(
      req,
      res,
      user,
      profile,
    );

  if (!session) {
    return null;
  }

  if (session.revoked_at) {
    return null;
  }

  const client = getClientInfo(req);
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("user_security_sessions")
    .update({
      last_seen_at: now,
      ip_address: client.ipAddress,
      user_agent: client.userAgent,
      browser: client.browser,
      operating_system:
        client.operatingSystem,
      device_type: client.deviceType,
    })
    .eq("id", session.id)
    .is("revoked_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  await evaluateMultipleLoginSecurity({
    req,
    userId: user.id,
    username: profile.username,
    currentSession: data,
  });

  return data;
}

async function validateSecuritySession(
  req,
  _res,
  userId,
) {
  const sessionHash =
    getSecuritySessionHash(req);

  // Existing logins from before this patch receive a security session
  // on their first heartbeat.
  if (!sessionHash) {
    return true;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("user_security_sessions")
      .select(
        "user_id, revoked_at, expires_at",
      )
      .eq("session_token_hash", sessionHash)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return true;
    }

    if (data.user_id !== userId) {
      return false;
    }

    if (data.revoked_at) {
      return false;
    }

    const expiresAt = new Date(
      data.expires_at,
    ).getTime();

    return (
      !Number.isFinite(expiresAt) ||
      expiresAt > Date.now()
    );
  } catch (error) {
    console.error(
      "Security session validation failed:",
      error,
    );

    // Fail open during a temporary database outage so normal auth still works.
    return true;
  }
}

async function revokeCurrentSecuritySession(
  req,
  userId,
  reason = "logout",
) {
  const sessionHash =
    getSecuritySessionHash(req);

  if (!sessionHash) {
    return;
  }

  try {
    await supabaseAdmin
      .from("user_security_sessions")
      .update({
        revoked_at:
          new Date().toISOString(),
        revoke_reason: reason,
      })
      .eq("session_token_hash", sessionHash)
      .eq("user_id", userId);
  } catch (error) {
    console.error(
      "Security session logout update failed:",
      error,
    );
  }
}

/* =======================================================
   USER ACCOUNT CENTER HELPERS
======================================================= */

const ACCOUNT_CENTER_DEFAULTS = Object.freeze({
  announcementsEnabled: true,
  retainProxyHistory: true,
  defaultProxyEngine: "duckduckgo",
  proxyTechnology: "scramjet",
  aiBehavior: "balanced",
  reducedMotion: false,
  appearance: "space",
});

const ACCOUNT_CENTER_PROXY_ENGINES = Object.freeze({
  duckduckgo: {
    name: "DuckDuckGo",
    url: "https://duckduckgo.com/?q=",
  },
  google: {
    name: "Google",
    url: "https://www.google.com/search?q=",
  },
  bing: {
    name: "Bing",
    url: "https://www.bing.com/search?q=",
  },
  startpage: {
    name: "Startpage",
    url: "https://www.startpage.com/search?q=",
  },
  qwant: {
    name: "Qwant",
    url: "https://www.qwant.com/?q=",
  },
});

const ACCOUNT_CENTER_PROXY_TECHNOLOGIES = new Set([
  "scramjet",
  "ultraviolet",
]);

const ACCOUNT_CENTER_AI_BEHAVIORS = new Set([
  "balanced",
  "concise",
  "detailed",
  "creative",
]);

const ACCOUNT_CENTER_APPEARANCES = new Set([
  "space",
  "midnight",
  "dim",
]);

function serializeAccountCenterPreferences(row) {
  return {
    announcementsEnabled:
      row?.announcements_enabled ??
      ACCOUNT_CENTER_DEFAULTS.announcementsEnabled,
    retainProxyHistory:
      row?.retain_proxy_history ??
      ACCOUNT_CENTER_DEFAULTS.retainProxyHistory,
    defaultProxyEngine:
      ACCOUNT_CENTER_PROXY_ENGINES[
        row?.default_proxy_engine
      ]
        ? row.default_proxy_engine
        : ACCOUNT_CENTER_DEFAULTS.defaultProxyEngine,
    proxyTechnology:
      ACCOUNT_CENTER_PROXY_TECHNOLOGIES.has(
        row?.proxy_technology,
      )
        ? row.proxy_technology
        : ACCOUNT_CENTER_DEFAULTS.proxyTechnology,
    aiBehavior:
      ACCOUNT_CENTER_AI_BEHAVIORS.has(
        row?.ai_behavior,
      )
        ? row.ai_behavior
        : ACCOUNT_CENTER_DEFAULTS.aiBehavior,
    reducedMotion:
      row?.reduced_motion ??
      ACCOUNT_CENTER_DEFAULTS.reducedMotion,
    appearance:
      ACCOUNT_CENTER_APPEARANCES.has(
        row?.appearance,
      )
        ? row.appearance
        : ACCOUNT_CENTER_DEFAULTS.appearance,
    updatedAt: row?.updated_at || null,
  };
}

async function getAccountCenterPreferences(userId) {
  const { data, error } = await supabaseAdmin
    .from("account_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return serializeAccountCenterPreferences(data);
}

function parseAccountCenterPreferences(body = {}) {
  const defaultProxyEngine = String(
    body.defaultProxyEngine ||
      ACCOUNT_CENTER_DEFAULTS.defaultProxyEngine,
  )
    .trim()
    .toLowerCase();

  const proxyTechnology = String(
    body.proxyTechnology ||
      ACCOUNT_CENTER_DEFAULTS.proxyTechnology,
  )
    .trim()
    .toLowerCase();

  const aiBehavior = String(
    body.aiBehavior ||
      ACCOUNT_CENTER_DEFAULTS.aiBehavior,
  )
    .trim()
    .toLowerCase();

  const appearance = String(
    body.appearance ||
      ACCOUNT_CENTER_DEFAULTS.appearance,
  )
    .trim()
    .toLowerCase();

  if (
    !ACCOUNT_CENTER_PROXY_ENGINES[
      defaultProxyEngine
    ]
  ) {
    throw new Error(
      "That default search engine is not supported.",
    );
  }

  if (
    !ACCOUNT_CENTER_PROXY_TECHNOLOGIES.has(
      proxyTechnology,
    )
  ) {
    throw new Error(
      "That proxy technology is not supported.",
    );
  }

  if (
    !ACCOUNT_CENTER_AI_BEHAVIORS.has(
      aiBehavior,
    )
  ) {
    throw new Error(
      "That Fuzz AI response style is not supported.",
    );
  }

  if (
    !ACCOUNT_CENTER_APPEARANCES.has(
      appearance,
    )
  ) {
    throw new Error(
      "That appearance option is not supported.",
    );
  }

  return {
    announcements_enabled:
      body.announcementsEnabled !== false,
    retain_proxy_history:
      body.retainProxyHistory !== false,
    default_proxy_engine:
      defaultProxyEngine,
    proxy_technology:
      proxyTechnology,
    ai_behavior: aiBehavior,
    reduced_motion:
      body.reducedMotion === true,
    appearance,
  };
}

function accountCenterAiInstruction(behavior) {
  const instructions = {
    concise:
      "Prefer direct, compact answers. Include only the detail needed to solve the request.",
    detailed:
      "Give thorough explanations, useful context, and clear step-by-step guidance when appropriate.",
    creative:
      "Be imaginative and expressive while remaining accurate, safe, and useful.",
    balanced:
      "Balance clarity and detail. Be concise for simple questions and more thorough for complex ones.",
  };

  return (
    instructions[behavior] ||
    instructions.balanced
  );
}

function accountCenterCsvSafeFilename(value) {
  return String(value || "fuzz-account")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "fuzz-account";
}

/* =======================================================
   AUTH ROUTES
======================================================= */

app.get("/api/setup-test", async (_req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .limit(1);

    if (error) {
      throw error;
    }

    return res.json({
      connected: true,
      message:
        "FuzzTheHuzz is connected to Supabase.",
    });
  } catch (error) {
    console.error(
      "Supabase setup test failed:",
      error,
    );

    return res.status(500).json({
      connected: false,
      error:
        error.message ||
        "Supabase connection failed.",
    });
  }
});

app.post("/api/auth/session", async (req, res) => {
  const accessToken = String(
    req.body.accessToken || "",
  );

  const refreshToken = String(
    req.body.refreshToken || "",
  );

  if (!accessToken || !refreshToken) {
    return res.status(400).json({
      error: "Missing login session.",
    });
  }

  try {
    const {
      data: { user },
      error: userError,
    } = await supabasePublic.auth.getUser(
      accessToken,
    );

    if (userError || !user) {
  clearAuthCookies(req, res);

  void writeActivityLog({
    req,
    category: "auth",
    action: "auth.login_failure",
    status: "failure",
    description:
      "An invalid login session was submitted.",
    responseStatus: 401,
    metadata: {
      reason:
        userError?.message ||
        "User could not be verified.",
    },
  });

  return res.status(401).json({
    error: "Invalid login session.",
  });
}

    const {
      data: profile,
      error: profileError,
    } = await supabaseAdmin
      .from("profiles")
      .select("username, role, banned")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return res.status(403).json({
        error:
          "Your account profile could not be found.",
      });
    }

    if (profile.banned === true) {
      return res.status(403).json({
        error:
          "This account has been disabled.",
      });
    }

    const cookieOptions =
      getCookieOptions(req);

    res.cookie(
      ACCESS_COOKIE,
      accessToken,
      cookieOptions,
    );

    res.cookie(
      REFRESH_COOKIE,
      refreshToken,
      cookieOptions,
    );

    void writeActivityLog({
  req,
  userId: user.id,
  category: "auth",
  action: "auth.login_success",
  status: "success",
  description:
    `${profile.username} signed in successfully.`,
  responseStatus: 200,
  metadata: {
    username: profile.username,
    role: profile.role,
    emailVerified:
      Boolean(user.email_confirmed_at),
    authProvider:
      user.app_metadata?.provider || null,
  },
});

    await registerSecuritySession(
      req,
      res,
      user,
      profile,
    );

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: profile.username,
        role: profile.role,
      },
    });
  } catch (error) {
    console.error(
      "Session creation failed:",
      error,
    );

    clearAuthCookies(req, res);

    return res.status(500).json({
      error:
        "The secure login session could not be created.",
    });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  const accessToken =
    req.cookies?.[ACCESS_COOKIE];

    let loggingUserId = null;

if (accessToken) {
  try {
    const {
      data: { user },
    } = await supabasePublic.auth.getUser(
      accessToken,
    );

    loggingUserId = user?.id || null;
  } catch (error) {
    console.error(
      "Could not identify logout user:",
      error,
    );
  }
}

  try {
    if (accessToken) {
      await supabaseAdmin.auth.admin.signOut(
        accessToken,
        "local",
      );
    }
  } catch (error) {
    console.error(
      "Logout warning:",
      error,
    );
  }

  await revokeCurrentSecuritySession(
    req,
    loggingUserId,
    "logout",
  );
  clearSecurityCookie(req, res);

  clearAuthCookies(req, res);

  void writeActivityLog({
  req,
  userId: loggingUserId,
  category: "auth",
  action: "auth.logout",
  status: "success",
  description:
    "A user signed out of FuzzTheHuzz.",
  responseStatus: 200,
});

  return res.json({
    success: true,
  });
});

app.post("/api/auth/signup", async (req, res) => {
  const email = String(req.body.email || "")
    .trim()
    .toLowerCase();

  const password = String(
    req.body.password || "",
  );

  const username = String(
    req.body.username || "",
  ).trim();

  const inviteCode = String(
    req.body.inviteCode || "",
  )
    .trim()
    .toUpperCase();

  const usernamePattern =
    /^[A-Za-z0-9_]{3,20}$/;

  if (
    !email ||
    !password ||
    !username ||
    !inviteCode
  ) {
    return res.status(400).json({
      error: "Please complete every field.",
    });
  }

  if (!usernamePattern.test(username)) {
    return res.status(400).json({
      error:
        "Username must be 3–20 characters and may only contain letters, numbers, and underscores.",
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      error:
        "Password must be at least 8 characters.",
    });
  }

  let createdUserId = null;
  let claimedInviteId = null;

  try {
    const {
      data: existingUsername,
      error: usernameError,
    } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("username", username)
      .maybeSingle();

    if (usernameError) {
      throw usernameError;
    }

    if (existingUsername) {
      return res.status(409).json({
        error:
          "That username is already taken.",
      });
    }

    const {
      data: availableInvite,
      error: inviteLookupError,
    } = await supabaseAdmin
      .from("invite_codes")
      .select("id")
      .eq("code", inviteCode)
      .eq("used", false)
      .maybeSingle();

    if (inviteLookupError) {
      throw inviteLookupError;
    }

    if (!availableInvite) {
      return res.status(400).json({
        error:
          "That invite code is invalid or has already been used.",
      });
    }

    const {
      data: signupData,
      error: signupError,
    } = await supabasePublic.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
        },
        emailRedirectTo:
          `${req.protocol}://${req.get("host")}/verified`,
      },
    });

    if (signupError) {
      return res.status(400).json({
        error: signupError.message,
      });
    }

    if (
      Array.isArray(
        signupData.user?.identities,
      ) &&
      signupData.user.identities.length === 0
    ) {
      return res.status(409).json({
        error:
          "An account with that email already exists.",
      });
    }

    createdUserId =
      signupData.user?.id || null;

    if (!createdUserId) {
      throw new Error(
        "Supabase did not return a user ID.",
      );
    }

    const {
      data: claimedCodes,
      error: inviteClaimError,
    } = await supabaseAdmin
      .from("invite_codes")
      .update({
        used: true,
        used_by: createdUserId,
      })
      .eq("id", availableInvite.id)
      .eq("used", false)
      .select("id");

    if (inviteClaimError) {
      throw inviteClaimError;
    }

    if (
      !claimedCodes ||
      claimedCodes.length !== 1
    ) {
      await supabaseAdmin.auth.admin.deleteUser(
        createdUserId,
      );

      createdUserId = null;

      return res.status(409).json({
        error:
          "That invite code was used by someone else.",
      });
    }

    claimedInviteId =
      claimedCodes[0].id;

    const { error: profileError } =
      await supabaseAdmin
        .from("profiles")
        .insert({
          id: createdUserId,
          username,
          role: "user",
          banned: false,
        });

    if (profileError) {
      throw profileError;
    }

    void writeActivityLog({
  req,
  userId: createdUserId,
  targetUserId: createdUserId,
  category: "auth",
  action: "auth.signup_success",
  status: "success",
  description:
    `${username} created a FuzzTheHuzz account.`,
  resourceType: "user",
  resourceId: createdUserId,
  responseStatus: 201,
  metadata: {
    username,
    inviteCode,
    emailDomain:
      email.includes("@")
        ? email.split("@")[1]
        : null,
  },
});

    return res.status(201).json({
      success: true,
      message:
        "Account created successfully. Check your email to verify your account.",
    });
  } catch (error) {
    console.error("Signup error:", error);

    if (createdUserId) {
      const { error: deleteError } =
        await supabaseAdmin.auth.admin.deleteUser(
          createdUserId,
        );

      if (deleteError) {
        console.error(
          "Could not remove partial user:",
          deleteError,
        );
      }
    }

    if (claimedInviteId) {
      const { error: restoreError } =
        await supabaseAdmin
          .from("invite_codes")
          .update({
            used: false,
            used_by: null,
          })
          .eq("id", claimedInviteId);

      if (restoreError) {
        console.error(
          "Could not restore invite:",
          restoreError,
        );
      }
    }

    void writeActivityLog({
  req,
  userId: createdUserId,
  targetUserId: createdUserId,
  category: "auth",
  action: "auth.signup_failure",
  status: "failure",
  description:
    "An account signup failed.",
  responseStatus: 500,
  metadata: {
    username,
    error:
      error?.message ||
      "Unknown signup failure",
  },
});

    return res.status(500).json({
      error:
        "Account creation failed. Please try again.",
    });
  }
});

app.get(
  "/api/account/me",
  requireApiAuth,
  async (req, res) => {
    try {
      return res.json({
        id: req.auth.user.id,
        email: req.auth.user.email,
        emailVerified:
          Boolean(
            req.auth.user.email_confirmed_at,
          ),
        username:
          req.auth.profile.username,
        role: req.auth.profile.role,
        banned:
          req.auth.profile.banned,
        createdAt:
          req.auth.user.created_at,
        lastSignInAt:
          req.auth.user.last_sign_in_at,
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error:
          "Could not load account.",
      });
    }
  },
);

/* =======================================================
   USER ACCOUNT CENTER ROUTES
======================================================= */

app.get(
  "/api/account/overview",
  requireApiAuth,
  async (req, res) => {
    const userId = req.auth.user.id;

    try {
      const [
        preferences,
        usagePolicy,
        usageSnapshot,
        aiChatsResult,
        aiMessagesResult,
        proxyResult,
        inviteResult,
        sessions,
        deletionResult,
      ] = await Promise.all([
        getAccountCenterPreferences(userId),
        getEffectiveUsagePolicy(
          userId,
          req.auth.profile.role,
        ),
        getUserUsageSnapshot(userId),
        supabaseAdmin
          .from("ai_chats")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("user_id", userId),
        supabaseAdmin
          .from("ai_messages")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("user_id", userId),
        supabaseAdmin
          .from("activity_logs")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("user_id", userId)
          .eq("category", "proxy"),
        supabaseAdmin
          .from("invite_codes")
          .select("code")
          .eq("used_by", userId)
          .order("created_at", {
            ascending: false,
          })
          .limit(1)
          .maybeSingle(),
        getRecentSecuritySessions(userId),
        supabaseAdmin
          .from("account_deletion_requests")
          .select("*")
          .eq("user_id", userId)
          .eq("status", "pending")
          .order("requested_at", {
            ascending: false,
          })
          .limit(1)
          .maybeSingle(),
      ]);

      const firstError =
        aiChatsResult.error ||
        aiMessagesResult.error ||
        proxyResult.error ||
        inviteResult.error ||
        deletionResult.error;

      if (firstError) {
        throw firstError;
      }

      return res.json({
        account: {
          id: userId,
          email: req.auth.user.email,
          emailVerified: Boolean(
            req.auth.user.email_confirmed_at,
          ),
          username:
            req.auth.profile.username,
          role: req.auth.profile.role,
          banned:
            req.auth.profile.banned === true,
          createdAt:
            req.auth.user.created_at,
          lastSignInAt:
            req.auth.user.last_sign_in_at,
          suspension:
            req.auth.suspension || null,
        },
        stats: {
          aiChats:
            aiChatsResult.count || 0,
          aiMessages:
            aiMessagesResult.count || 0,
          proxyRequests:
            proxyResult.count || 0,
          activeSessions:
            sessions.length,
        },
        usage: {
          policy:
            usagePolicy.effective,
          totals:
            usageSnapshot.totals,
          dayStartedAt:
            usageSnapshot.dayStartedAt,
          recentViolations:
            usageSnapshot.recentViolations,
        },
        invite: inviteResult.data || null,
        preferences,
        deletionRequest:
          deletionResult.data || null,
      });
    } catch (error) {
      console.error(
        "Account overview load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Your account overview could not be loaded.",
      });
    }
  },
);

app.get(
  "/api/account/preferences",
  requireApiAuth,
  async (req, res) => {
    try {
      const preferences =
        await getAccountCenterPreferences(
          req.auth.user.id,
        );

      return res.json({
        preferences,
        proxyEngines:
          ACCOUNT_CENTER_PROXY_ENGINES,
        proxyTechnologies: {
          scramjet: {
            name: "Scramjet",
            description: "Recommended for modern websites.",
          },
          ultraviolet: {
            name: "Ultraviolet",
            description: "Legacy fallback for compatibility.",
          },
        },
        aiBehaviors: [
          "balanced",
          "concise",
          "detailed",
          "creative",
        ],
        appearances: [
          "space",
          "midnight",
          "dim",
        ],
      });
    } catch (error) {
      console.error(
        "Account preferences load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Your preferences could not be loaded.",
      });
    }
  },
);

app.put(
  "/api/account/preferences",
  requireApiAuth,
  async (req, res) => {
    try {
      const values =
        parseAccountCenterPreferences(
          req.body,
        );

      const { data, error } =
        await supabaseAdmin
          .from("account_preferences")
          .upsert(
            {
              user_id:
                req.auth.user.id,
              ...values,
              updated_at:
                new Date().toISOString(),
            },
            {
              onConflict: "user_id",
            },
          )
          .select("*")
          .single();

      if (error) {
        throw error;
      }

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        targetUserId:
          req.auth.user.id,
        category: "account",
        action:
          "account.preferences_updated",
        status: "success",
        description:
          `${req.auth.profile.username} updated their account preferences.`,
        resourceType: "user",
        resourceId:
          req.auth.user.id,
        responseStatus: 200,
        newValues:
          serializeAccountCenterPreferences(
            data,
          ),
      });

      return res.json({
        success: true,
        preferences:
          serializeAccountCenterPreferences(
            data,
          ),
      });
    } catch (error) {
      const message =
        error?.message ||
        "Your preferences could not be saved.";

      return res.status(400).json({
        error: message,
      });
    }
  },
);


app.patch(
  "/api/account/preferences/proxy-technology",
  requireApiAuth,
  async (req, res) => {
    const proxyTechnology = String(
      req.body.proxyTechnology || "",
    )
      .trim()
      .toLowerCase();

    if (
      !ACCOUNT_CENTER_PROXY_TECHNOLOGIES.has(
        proxyTechnology,
      )
    ) {
      return res.status(400).json({
        error:
          "Choose Scramjet or Ultraviolet.",
      });
    }

    try {
      const current =
        await getAccountCenterPreferences(
          req.auth.user.id,
        );

      const values =
        parseAccountCenterPreferences({
          ...current,
          proxyTechnology,
        });

      const { data, error } =
        await supabaseAdmin
          .from("account_preferences")
          .upsert(
            {
              user_id:
                req.auth.user.id,
              ...values,
              updated_at:
                new Date().toISOString(),
            },
            {
              onConflict: "user_id",
            },
          )
          .select("*")
          .single();

      if (error) {
        throw error;
      }

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        targetUserId:
          req.auth.user.id,
        category: "account",
        action:
          "account.proxy_technology_changed",
        status: "success",
        description:
          `${req.auth.profile.username} selected ${proxyTechnology} as their proxy technology.`,
        resourceType: "user",
        resourceId:
          req.auth.user.id,
        responseStatus: 200,
        newValues: {
          proxyTechnology,
        },
      });

      return res.json({
        success: true,
        preferences:
          serializeAccountCenterPreferences(
            data,
          ),
      });
    } catch (error) {
      console.error(
        "Proxy technology preference update failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Your proxy preference could not be saved.",
      });
    }
  },
);

app.get(
  "/api/account/security",
  requireApiAuth,
  async (req, res) => {
    const userId = req.auth.user.id;

    try {
      const [sessionsResult, activityResult] =
        await Promise.all([
          supabaseAdmin
            .from("user_security_sessions")
            .select("*")
            .eq("user_id", userId)
            .order("last_seen_at", {
              ascending: false,
            })
            .limit(100),
          supabaseAdmin
            .from("activity_logs")
            .select(
              "id, category, action, status, description, ip_address, browser, operating_system, device_type, created_at, metadata",
            )
            .eq("user_id", userId)
            .in("category", [
              "auth",
              "security",
            ])
            .order("created_at", {
              ascending: false,
            })
            .limit(40),
        ]);

      const error =
        sessionsResult.error ||
        activityResult.error;

      if (error) {
        throw error;
      }

      const rows =
        sessionsResult.data || [];
      const currentSessionHash =
        getSecuritySessionHash(req);
      const serialized = rows.map(
        (row) =>
          serializeSecuritySession(row, {
            username:
              req.auth.profile.username,
            currentSessionHash,
          }),
      );

      return res.json({
        sessions: serialized,
        summary: {
          activeSessions:
            serialized.filter(
              (session) => session.active,
            ).length,
          knownDevices:
            new Set(
              rows.map(
                (row) => row.device_hash,
              ),
            ).size,
          knownIps:
            new Set(
              rows
                .map(
                  (row) => row.ip_address,
                )
                .filter(Boolean),
            ).size,
        },
        activity:
          activityResult.data || [],
      });
    } catch (error) {
      console.error(
        "Account security load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Your security information could not be loaded.",
      });
    }
  },
);

app.post(
  "/api/account/security/sessions/:sessionId/revoke",
  requireApiAuth,
  async (req, res) => {
    const sessionId = String(
      req.params.sessionId || "",
    );

    try {
      const { data: existing, error } =
        await supabaseAdmin
          .from("user_security_sessions")
          .select("*")
          .eq("id", sessionId)
          .eq(
            "user_id",
            req.auth.user.id,
          )
          .maybeSingle();

      if (error) {
        throw error;
      }

      if (!existing) {
        return res.status(404).json({
          error:
            "That login session was not found.",
        });
      }

      if (
        existing.session_token_hash ===
        getSecuritySessionHash(req)
      ) {
        return res.status(400).json({
          error:
            "Use Sign Out to end your current session.",
        });
      }

      const { error: updateError } =
        await supabaseAdmin
          .from("user_security_sessions")
          .update({
            revoked_at:
              new Date().toISOString(),
            revoke_reason:
              "Revoked by account owner",
          })
          .eq("id", sessionId)
          .eq(
            "user_id",
            req.auth.user.id,
          );

      if (updateError) {
        throw updateError;
      }

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        targetUserId:
          req.auth.user.id,
        category: "security",
        action:
          "account.session_revoked_by_user",
        status: "success",
        description:
          `${req.auth.profile.username} revoked one of their login sessions.`,
        resourceType:
          "security_session",
        resourceId: sessionId,
        responseStatus: 200,
        metadata: {
          browser: existing.browser,
          operatingSystem:
            existing.operating_system,
          deviceType:
            existing.device_type,
        },
      });

      return res.json({
        success: true,
      });
    } catch (error) {
      return res.status(500).json({
        error:
          "That login session could not be revoked.",
      });
    }
  },
);

app.post(
  "/api/account/security/revoke-others",
  requireApiAuth,
  async (req, res) => {
    const currentHash =
      getSecuritySessionHash(req);

    try {
      let query = supabaseAdmin
        .from("user_security_sessions")
        .update({
          revoked_at:
            new Date().toISOString(),
          revoke_reason:
            "Signed out by account owner",
        })
        .eq("user_id", req.auth.user.id)
        .is("revoked_at", null);

      if (currentHash) {
        query = query.neq(
          "session_token_hash",
          currentHash,
        );
      }

      const { data, error } = await query
        .select("id");

      if (error) {
        throw error;
      }

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        targetUserId:
          req.auth.user.id,
        category: "security",
        action:
          "account.other_sessions_revoked",
        status: "success",
        description:
          `${req.auth.profile.username} signed out all other devices.`,
        resourceType: "user",
        resourceId:
          req.auth.user.id,
        responseStatus: 200,
        metadata: {
          revokedCount:
            data?.length || 0,
        },
      });

      return res.json({
        success: true,
        revokedCount:
          data?.length || 0,
      });
    } catch (error) {
      return res.status(500).json({
        error:
          "Your other sessions could not be signed out.",
      });
    }
  },
);

app.post(
  "/api/account/password",
  requireApiAuth,
  async (req, res) => {
    const currentPassword = String(
      req.body.currentPassword || "",
    );
    const newPassword = String(
      req.body.newPassword || "",
    );

    if (!currentPassword) {
      return res.status(400).json({
        error:
          "Enter your current password.",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        error:
          "Your new password must be at least 8 characters.",
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        error:
          "Choose a password different from your current password.",
      });
    }

    try {
      const verificationClient =
        createClient(
          supabaseUrl,
          supabaseAnonKey,
          {
            auth: {
              autoRefreshToken: false,
              persistSession: false,
              detectSessionInUrl: false,
            },
          },
        );

      const { error: verifyError } =
        await verificationClient.auth
          .signInWithPassword({
            email: req.auth.user.email,
            password: currentPassword,
          });

      if (verifyError) {
        return res.status(400).json({
          error:
            "Your current password is incorrect.",
        });
      }

      const { error: updateError } =
        await supabaseAdmin.auth.admin
          .updateUserById(
            req.auth.user.id,
            {
              password: newPassword,
            },
          );

      if (updateError) {
        throw updateError;
      }

      const currentHash =
        getSecuritySessionHash(req);
      let revokeQuery = supabaseAdmin
        .from("user_security_sessions")
        .update({
          revoked_at:
            new Date().toISOString(),
          revoke_reason:
            "Password changed",
        })
        .eq("user_id", req.auth.user.id)
        .is("revoked_at", null);

      if (currentHash) {
        revokeQuery = revokeQuery.neq(
          "session_token_hash",
          currentHash,
        );
      }

      await revokeQuery;

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        targetUserId:
          req.auth.user.id,
        category: "security",
        action:
          "account.password_changed",
        status: "success",
        description:
          `${req.auth.profile.username} changed their password.`,
        resourceType: "user",
        resourceId:
          req.auth.user.id,
        responseStatus: 200,
      });

      return res.json({
        success: true,
        message:
          "Password changed. Other tracked devices were signed out.",
      });
    } catch (error) {
      console.error(
        "Password change failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Your password could not be changed.",
      });
    }
  },
);

app.get(
  "/api/account/ai/chats",
  requireApiAuth,
  async (req, res) => {
    const page = clampInteger(
      req.query.page,
      1,
      1,
      100000,
    );
    const limit = clampInteger(
      req.query.limit,
      30,
      1,
      100,
    );
    const search = String(
      req.query.search || "",
    )
      .trim()
      .slice(0, 80);
    const offset = (page - 1) * limit;

    try {
      let query = supabaseAdmin
        .from("ai_chats")
        .select(
          "id, title, created_at, updated_at",
          { count: "exact" },
        )
        .eq(
          "user_id",
          req.auth.user.id,
        )
        .order("updated_at", {
          ascending: false,
        })
        .range(
          offset,
          offset + limit - 1,
        );

      if (search) {
        query = query.ilike(
          "title",
          `%${search.replaceAll("%", "")}%`,
        );
      }

      const {
        data: chats,
        count,
        error,
      } = await query;

      if (error) {
        throw error;
      }

      const rows = chats || [];
      const chatIds = rows.map(
        (chat) => chat.id,
      );
      let messages = [];

      if (chatIds.length > 0) {
        const { data, error: messageError } =
          await supabaseAdmin
            .from("ai_messages")
            .select(
              "chat_id, role, content, has_image, created_at",
            )
            .eq(
              "user_id",
              req.auth.user.id,
            )
            .in("chat_id", chatIds)
            .order("created_at", {
              ascending: true,
            });

        if (messageError) {
          throw messageError;
        }

        messages = data || [];
      }

      const byChat = new Map();

      for (const message of messages) {
        if (!byChat.has(message.chat_id)) {
          byChat.set(message.chat_id, []);
        }

        byChat.get(message.chat_id).push(
          message,
        );
      }

      return res.json({
        chats: rows.map((chat) => {
          const chatMessages =
            byChat.get(chat.id) || [];
          const lastMessage =
            chatMessages.at(-1);

          return {
            id: chat.id,
            title: chat.title,
            createdAt:
              chat.created_at,
            updatedAt:
              chat.updated_at,
            messageCount:
              chatMessages.length,
            hasImages:
              chatMessages.some(
                (message) =>
                  message.has_image === true,
              ),
            lastMessagePreview:
              lastMessage?.content
                ? String(
                    lastMessage.content,
                  )
                    .replace(/\s+/g, " ")
                    .slice(0, 180)
                : null,
          };
        }),
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.max(
            1,
            Math.ceil(
              (count || 0) / limit,
            ),
          ),
        },
      });
    } catch (error) {
      return res.status(500).json({
        error:
          "Your AI chats could not be loaded.",
      });
    }
  },
);

app.delete(
  "/api/account/ai/history",
  requireApiAuth,
  async (req, res) => {
    if (
      String(req.body.confirm || "") !==
      "DELETE"
    ) {
      return res.status(400).json({
        error:
          "Enter DELETE to confirm.",
      });
    }

    try {
      const userId = req.auth.user.id;

      const [messagesResult, chatsResult] =
        await Promise.all([
          supabaseAdmin
            .from("ai_messages")
            .select("id", {
              count: "exact",
              head: true,
            })
            .eq("user_id", userId),
          supabaseAdmin
            .from("ai_chats")
            .select("id", {
              count: "exact",
              head: true,
            })
            .eq("user_id", userId),
        ]);

      const countError =
        messagesResult.error ||
        chatsResult.error;

      if (countError) {
        throw countError;
      }

      const { error: messagesError } =
        await supabaseAdmin
          .from("ai_messages")
          .delete()
          .eq("user_id", userId);

      if (messagesError) {
        throw messagesError;
      }

      const { error: chatsError } =
        await supabaseAdmin
          .from("ai_chats")
          .delete()
          .eq("user_id", userId);

      if (chatsError) {
        throw chatsError;
      }

      invalidateAdminCache();

      void writeActivityLog({
        req,
        userId,
        targetUserId: userId,
        category: "privacy",
        action:
          "account.ai_history_cleared",
        status: "success",
        description:
          `${req.auth.profile.username} deleted all of their saved AI history.`,
        resourceType: "user",
        resourceId: userId,
        responseStatus: 200,
        metadata: {
          deletedChats:
            chatsResult.count || 0,
          deletedMessages:
            messagesResult.count || 0,
        },
      });

      return res.json({
        success: true,
        deletedChats:
          chatsResult.count || 0,
        deletedMessages:
          messagesResult.count || 0,
      });
    } catch (error) {
      console.error(
        "AI history clear failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Your saved AI history could not be deleted.",
      });
    }
  },
);

app.get(
  "/api/account/proxy-history",
  requireApiAuth,
  async (req, res) => {
    const page = clampInteger(
      req.query.page,
      1,
      1,
      100000,
    );
    const limit = clampInteger(
      req.query.limit,
      40,
      1,
      100,
    );
    const search = String(
      req.query.search || "",
    )
      .trim()
      .slice(0, 100);
    const offset = (page - 1) * limit;

    try {
      let query = supabaseAdmin
        .from("activity_logs")
        .select(
          "id, action, status, response_status, duration_ms, proxy_query, proxy_target_url, proxy_target_domain, proxy_engine, created_at",
          { count: "exact" },
        )
        .eq(
          "user_id",
          req.auth.user.id,
        )
        .eq("category", "proxy")
        .order("created_at", {
          ascending: false,
        })
        .range(
          offset,
          offset + limit - 1,
        );

      if (search) {
        const safeSearch = search
          .replace(/[%,()]/g, " ")
          .trim();

        query = query.or(
          [
            `proxy_query.ilike.%${safeSearch}%`,
            `proxy_target_url.ilike.%${safeSearch}%`,
            `proxy_target_domain.ilike.%${safeSearch}%`,
          ].join(","),
        );
      }

      const {
        data,
        count,
        error,
      } = await query;

      if (error) {
        throw error;
      }

      return res.json({
        history: (data || []).map(
          (row) => ({
            id: row.id,
            action: row.action,
            status: row.status,
            responseStatus:
              row.response_status,
            durationMs:
              row.duration_ms,
            query: row.proxy_query,
            targetUrl:
              row.proxy_target_url,
            targetDomain:
              row.proxy_target_domain,
            engine: row.proxy_engine,
            createdAt:
              row.created_at,
          }),
        ),
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.max(
            1,
            Math.ceil(
              (count || 0) / limit,
            ),
          ),
        },
      });
    } catch (error) {
      return res.status(500).json({
        error:
          "Your proxy history could not be loaded.",
      });
    }
  },
);

app.delete(
  "/api/account/proxy-history",
  requireApiAuth,
  async (req, res) => {
    if (
      String(req.body.confirm || "") !==
      "CLEAR"
    ) {
      return res.status(400).json({
        error:
          "Enter CLEAR to confirm.",
      });
    }

    try {
      const { data, error } =
        await supabaseAdmin
          .from("activity_logs")
          .delete()
          .eq(
            "user_id",
            req.auth.user.id,
          )
          .eq("category", "proxy")
          .select("id");

      if (error) {
        throw error;
      }

      invalidateAdminCache();

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        targetUserId:
          req.auth.user.id,
        category: "privacy",
        action:
          "account.proxy_history_cleared",
        status: "success",
        description:
          `${req.auth.profile.username} cleared their proxy history.`,
        resourceType: "user",
        resourceId:
          req.auth.user.id,
        responseStatus: 200,
        metadata: {
          deletedRows:
            data?.length || 0,
        },
      });

      return res.json({
        success: true,
        deletedRows:
          data?.length || 0,
      });
    } catch (error) {
      return res.status(500).json({
        error:
          "Your proxy history could not be cleared.",
      });
    }
  },
);

app.get(
  "/api/account/export",
  requireApiAuth,
  async (req, res) => {
    const userId = req.auth.user.id;

    try {
      const [
        preferences,
        profileResult,
        inviteResult,
        chatsResult,
        messagesResult,
        activityResult,
        usageResult,
        sessionsResult,
        appStateResult,
        deletionResult,
      ] = await Promise.all([
        getAccountCenterPreferences(userId),
        supabaseAdmin
          .from("profiles")
          .select(
            "id, username, role, banned, suspended_until, suspension_reason, created_at, updated_at",
          )
          .eq("id", userId)
          .maybeSingle(),
        supabaseAdmin
          .from("invite_codes")
          .select("code")
          .eq("used_by", userId),
        supabaseAdmin
          .from("ai_chats")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", {
            ascending: true,
          }),
        supabaseAdmin
          .from("ai_messages")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", {
            ascending: true,
          }),
        supabaseAdmin
          .from("activity_logs")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", {
            ascending: true,
          }),
        supabaseAdmin
          .from("usage_events")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", {
            ascending: true,
          }),
        supabaseAdmin
          .from("user_security_sessions")
          .select(
            "id, ip_address, user_agent, browser, operating_system, device_type, first_seen_at, last_seen_at, expires_at, revoked_at, revoke_reason, metadata",
          )
          .eq("user_id", userId)
          .order("first_seen_at", {
            ascending: true,
          }),
        supabaseAdmin
          .from("account_app_state")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle(),
        supabaseAdmin
          .from("account_deletion_requests")
          .select(
            "id, status, reason, requested_at, cancelled_at, reviewed_at",
          )
          .eq("user_id", userId)
          .order("requested_at", {
            ascending: true,
          }),
      ]);

      const results = [
        profileResult,
        inviteResult,
        chatsResult,
        messagesResult,
        activityResult,
        usageResult,
        sessionsResult,
        appStateResult,
        deletionResult,
      ];
      const error = results.find(
        (result) => result.error,
      )?.error;

      if (error) {
        throw error;
      }

      const exportPayload = {
        exportVersion: 1,
        generatedAt:
          new Date().toISOString(),
        account: {
          id: userId,
          email: req.auth.user.email,
          emailVerified: Boolean(
            req.auth.user.email_confirmed_at,
          ),
          createdAt:
            req.auth.user.created_at,
          lastSignInAt:
            req.auth.user.last_sign_in_at,
          profile: profileResult.data,
        },
        preferences,
        inviteCodes:
          inviteResult.data || [],
        aiChats:
          chatsResult.data || [],
        aiMessages:
          messagesResult.data || [],
        activity:
          activityResult.data || [],
        usageEvents:
          usageResult.data || [],
        securitySessions:
          sessionsResult.data || [],
        appLibrary:
          serializeAppsState(
            appStateResult.data,
          ),
        deletionRequests:
          deletionResult.data || [],
      };

      void writeActivityLog({
        req,
        userId,
        targetUserId: userId,
        category: "privacy",
        action:
          "account.personal_data_exported",
        status: "success",
        description:
          `${req.auth.profile.username} downloaded a copy of their personal data.`,
        resourceType: "user",
        resourceId: userId,
        responseStatus: 200,
      });

      const filename =
        `${accountCenterCsvSafeFilename(req.auth.profile.username)}-fuzz-data-${new Date().toISOString().slice(0, 10)}.json`;

      res.setHeader(
        "Content-Type",
        "application/json; charset=utf-8",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.setHeader(
        "Cache-Control",
        "no-store",
      );

      return res.send(
        JSON.stringify(
          exportPayload,
          null,
          2,
        ),
      );
    } catch (error) {
      console.error(
        "Personal data export failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Your data export could not be generated.",
      });
    }
  },
);

app.get(
  "/api/account/deletion-request",
  requireApiAuth,
  async (req, res) => {
    try {
      const { data, error } =
        await supabaseAdmin
          .from("account_deletion_requests")
          .select("*")
          .eq(
            "user_id",
            req.auth.user.id,
          )
          .eq("status", "pending")
          .order("requested_at", {
            ascending: false,
          })
          .limit(1)
          .maybeSingle();

      if (error) {
        throw error;
      }

      return res.json({
        request: data || null,
      });
    } catch (error) {
      return res.status(500).json({
        error:
          "Your deletion-request status could not be loaded.",
      });
    }
  },
);

app.post(
  "/api/account/deletion-request",
  requireApiAuth,
  async (req, res) => {
    const reason = String(
      req.body.reason || "",
    )
      .trim()
      .slice(0, 1000);

    if (
      String(req.body.confirm || "") !==
      "DELETE MY ACCOUNT"
    ) {
      return res.status(400).json({
        error:
          "Enter DELETE MY ACCOUNT to confirm the request.",
      });
    }

    try {
      const { data: existing, error } =
        await supabaseAdmin
          .from("account_deletion_requests")
          .select("*")
          .eq(
            "user_id",
            req.auth.user.id,
          )
          .eq("status", "pending")
          .maybeSingle();

      if (error) {
        throw error;
      }

      if (existing) {
        return res.status(409).json({
          error:
            "You already have a pending account-deletion request.",
        });
      }

      const { data, error: insertError } =
        await supabaseAdmin
          .from("account_deletion_requests")
          .insert({
            user_id:
              req.auth.user.id,
            reason: reason || null,
            status: "pending",
            requested_at:
              new Date().toISOString(),
          })
          .select("*")
          .single();

      if (insertError) {
        throw insertError;
      }

      void createOrBumpAdminNotification({
        notificationType:
          "account.deletion_requested",
        severity: "warning",
        title:
          "Account deletion requested",
        message:
          `${req.auth.profile.username} requested account deletion.`,
        targetUserId:
          req.auth.user.id,
        resourceType:
          "account_deletion_request",
        resourceId: data.id,
        dedupeKey:
          `deletion-request:${req.auth.user.id}`,
        metadata: {
          reason: reason || null,
          username:
            req.auth.profile.username,
        },
      });

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        targetUserId:
          req.auth.user.id,
        category: "privacy",
        action:
          "account.deletion_requested",
        status: "warning",
        description:
          `${req.auth.profile.username} requested account deletion.`,
        resourceType:
          "account_deletion_request",
        resourceId: data.id,
        responseStatus: 201,
        metadata: {
          reason: reason || null,
        },
      });

      return res.status(201).json({
        success: true,
        request: data,
      });
    } catch (error) {
      console.error(
        "Account deletion request failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Your account-deletion request could not be submitted.",
      });
    }
  },
);

app.delete(
  "/api/account/deletion-request",
  requireApiAuth,
  async (req, res) => {
    try {
      const { data, error } =
        await supabaseAdmin
          .from("account_deletion_requests")
          .update({
            status: "cancelled",
            cancelled_at:
              new Date().toISOString(),
          })
          .eq(
            "user_id",
            req.auth.user.id,
          )
          .eq("status", "pending")
          .select("id");

      if (error) {
        throw error;
      }

      if (!data?.length) {
        return res.status(404).json({
          error:
            "There is no pending deletion request to cancel.",
        });
      }

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        targetUserId:
          req.auth.user.id,
        category: "privacy",
        action:
          "account.deletion_request_cancelled",
        status: "success",
        description:
          `${req.auth.profile.username} cancelled their account-deletion request.`,
        resourceType:
          "account_deletion_request",
        resourceId: data[0].id,
        responseStatus: 200,
      });

      return res.json({
        success: true,
      });
    } catch (error) {
      return res.status(500).json({
        error:
          "Your deletion request could not be cancelled.",
      });
    }
  },
);

app.get(
  "/api/admin/users",
  requireRole("admin"),
  async (req, res) => {
    try {
      const users = await getAllAuthUsers();

      const {
        data: profiles,
        error: profilesError,
      } = await supabaseAdmin
        .from("profiles")
        .select("*");

      if (profilesError) {
        throw profilesError;
      }

      const profileMap = new Map(
        (profiles || []).map((p) => [
          p.id,
          p,
        ]),
      );

      const combinedUsers =
        users.map((user) => {
          const profile =
            profileMap.get(user.id);

          return {
            id: user.id,
            email: user.email,
            emailVerified:
              Boolean(
                user.email_confirmed_at,
              ),
            username:
              profile?.username ||
              null,
            role:
              profile?.role ||
              "user",
            banned:
              profile?.banned ||
              false,
            suspended:
              Boolean(
                profile?.suspended_until &&
                new Date(
                  profile.suspended_until,
                ).getTime() > Date.now(),
              ),
            suspendedUntil:
              profile?.suspended_until ||
              null,
            suspensionReason:
              profile?.suspension_reason ||
              null,
            suspensionSource:
              profile?.suspension_source ||
              null,
            createdAt:
              user.created_at,
            lastSignInAt:
              user.last_sign_in_at,
          };
        });

        void writeActivityLog({
  req,
  userId: req.auth.user.id,
  actorUserId: req.auth.user.id,
  category: "admin",
  action: "admin.user_list_viewed",
  status: "success",
  description:
    `${req.auth.profile.username} viewed the user directory.`,
  responseStatus: 200,
  metadata: {
    returnedUsers: combinedUsers.length,
    actorRole: req.auth.profile.role,
  },
});

      return res.json({
        users: combinedUsers,
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error:
          "Could not load users.",
      });
    }
  },
);

app.patch(
  "/api/admin/users/:userId/role",
  requireRole("admin"),
  async (req, res) => {
    const targetUserId = String(
      req.params.userId || "",
    );

    const requestedRole = String(
      req.body.role || "",
    )
      .trim()
      .toLowerCase();

    const allowedRoles = new Set([
      "user",
      "moderator",
      "admin",
      "owner",
    ]);

    if (!allowedRoles.has(requestedRole)) {
      return res.status(400).json({
        error: "That role is invalid.",
      });
    }

    try {
      const actor = req.auth;

      const {
        data: targetProfile,
        error: targetError,
      } = await supabaseAdmin
        .from("profiles")
        .select(
          "id, username, role, banned",
        )
        .eq("id", targetUserId)
        .maybeSingle();

      if (targetError) {
        throw targetError;
      }

      if (!targetProfile) {
        return res.status(404).json({
          error: "That user was not found.",
        });
      }

      if (targetUserId === actor.user.id) {
        return res.status(403).json({
          error:
            "You cannot change your own role.",
        });
      }

      if (actor.profile.role === "admin") {
        if (
          ["admin", "owner"].includes(
            targetProfile.role,
          )
        ) {
          return res.status(403).json({
            error:
              "Admins cannot modify admins or owners.",
          });
        }

        if (
          !["user", "moderator"].includes(
            requestedRole,
          )
        ) {
          return res.status(403).json({
            error:
              "Admins may only assign user or moderator.",
          });
        }
      }

      if (
        requestedRole === "owner" &&
        actor.profile.role !== "owner"
      ) {
        return res.status(403).json({
          error:
            "Only an owner can assign the owner role.",
        });
      }

      if (
        targetProfile.role === "owner" &&
        actor.profile.role !== "owner"
      ) {
        return res.status(403).json({
          error:
            "Only an owner can modify an owner.",
        });
      }

      if (
        targetProfile.role === "owner" &&
        requestedRole !== "owner"
      ) {
        const {
          count: ownerCount,
          error: ownerCountError,
        } = await supabaseAdmin
          .from("profiles")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("role", "owner");

        if (ownerCountError) {
          throw ownerCountError;
        }

        if ((ownerCount || 0) <= 1) {
          return res.status(400).json({
            error:
              "The final owner cannot be demoted.",
          });
        }
      }

      const {
        data: updatedProfile,
        error: updateError,
      } = await supabaseAdmin
        .from("profiles")
        .update({
          role: requestedRole,
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", targetUserId)
        .select(
          "id, username, role, banned, updated_at",
        )
        .single();

      if (updateError) {
        throw updateError;
      }

      invalidateAdminCache();

      void writeActivityLog({
        req,
        userId: actor.user.id,
        actorUserId: actor.user.id,
        targetUserId,
        category: "admin",
        action: "admin.role_changed",
        status: "success",
        description:
          `${actor.profile.username} changed ${targetProfile.username}'s role from ${targetProfile.role} to ${requestedRole}.`,
        resourceType: "user",
        resourceId: targetUserId,
        responseStatus: 200,
        oldValues: {
          role: targetProfile.role,
        },
        newValues: {
          role: requestedRole,
        },
        metadata: {
          actorUsername:
            actor.profile.username,
          targetUsername:
            targetProfile.username,
          actorRole:
            actor.profile.role,
        },
      });

      return res.json({
        success: true,
        profile: updatedProfile,
      });
    } catch (error) {
      console.error(
        "Role update failed:",
        error,
      );

      return res.status(500).json({
        error:
          "That role could not be updated.",
      });
    }
  },
);

app.patch(
  "/api/admin/users/:userId/ban",
  requireRole("admin"),
  async (req, res) => {
    const targetUserId = String(
      req.params.userId || "",
    );

    const banned = req.body.banned === true;

    try {
      const actor = req.auth;

      const {
        data: targetProfile,
        error: targetError,
      } = await supabaseAdmin
        .from("profiles")
        .select(
          "id, username, role, banned",
        )
        .eq("id", targetUserId)
        .maybeSingle();

      if (targetError) {
        throw targetError;
      }

      if (!targetProfile) {
        return res.status(404).json({
          error: "That user was not found.",
        });
      }

      if (targetUserId === actor.user.id) {
        return res.status(403).json({
          error:
            "You cannot ban your own account.",
        });
      }

      if (targetProfile.role === "owner") {
        return res.status(403).json({
          error:
            "Owner accounts cannot be banned here.",
        });
      }

      if (
        actor.profile.role === "admin" &&
        targetProfile.role === "admin"
      ) {
        return res.status(403).json({
          error:
            "Admins cannot ban other admins.",
        });
      }

      const {
        data: updatedProfile,
        error: updateError,
      } = await supabaseAdmin
        .from("profiles")
        .update({
          banned,
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", targetUserId)
        .select(
          "id, username, role, banned, updated_at",
        )
        .single();

      if (updateError) {
        throw updateError;
      }

      invalidateAdminCache();

      void writeActivityLog({
        req,
        userId: actor.user.id,
        actorUserId: actor.user.id,
        targetUserId,
        category: "admin",
        action: banned
          ? "admin.user_banned"
          : "admin.user_unbanned",
        status: "success",
        description: banned
          ? `${actor.profile.username} banned ${targetProfile.username}.`
          : `${actor.profile.username} unbanned ${targetProfile.username}.`,
        resourceType: "user",
        resourceId: targetUserId,
        responseStatus: 200,
        oldValues: {
          banned: targetProfile.banned,
        },
        newValues: {
          banned,
        },
        metadata: {
          actorUsername:
            actor.profile.username,
          targetUsername:
            targetProfile.username,
          targetRole:
            targetProfile.role,
        },
      });

      return res.json({
        success: true,
        profile: updatedProfile,
      });
    } catch (error) {
      console.error(
        "Ban update failed:",
        error,
      );

      return res.status(500).json({
        error:
          "That account status could not be updated.",
      });
    }
  },
);

/* =======================================================
   APPS LIBRARY STATE + ACTIVITY
======================================================= */

const APPS_STATE_MAX_FAVORITES = 250;
const APPS_STATE_MAX_RECENT = 20;
const APPS_STATE_MAX_CUSTOM = 50;
const APPS_STATE_MAX_OPEN_COUNT_KEYS = 300;

function cleanAppsStateId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 90);
}

function cleanAppsStateUrl(value) {
  const raw = String(value || "")
    .trim()
    .slice(0, 2000);

  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function cleanAppsStateImage(value) {
  const raw = String(value || "")
    .trim()
    .slice(0, 2000);

  if (raw.startsWith("/assets/")) {
    return raw;
  }

  return cleanAppsStateUrl(raw);
}

function cleanAppsStateCategories(value) {
  if (!Array.isArray(value)) {
    return ["all"];
  }

  const categories = [
    ...new Set(
      value
        .map((item) =>
          String(item || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "")
            .slice(0, 30),
        )
        .filter(Boolean),
    ),
  ].slice(0, 15);

  if (!categories.includes("all")) {
    categories.unshift("all");
  }

  return categories;
}

function cleanAppsStateRecent(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const result = [];

  for (const item of value) {
    const id = cleanAppsStateId(item?.id);

    if (!id || seen.has(id)) {
      continue;
    }

    const openedAt = Number.isFinite(
      Date.parse(item?.openedAt),
    )
      ? new Date(item.openedAt).toISOString()
      : new Date().toISOString();

    seen.add(id);
    result.push({ id, openedAt });

    if (result.length >= APPS_STATE_MAX_RECENT) {
      break;
    }
  }

  return result;
}

function cleanAppsStateOpenCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const output = {};

  for (const [rawId, rawCount] of Object.entries(value)) {
    const id = cleanAppsStateId(rawId);
    const count = Math.max(
      0,
      Math.min(
        1000000,
        Number.parseInt(rawCount, 10) || 0,
      ),
    );

    if (id) {
      output[id] = count;
    }

    if (Object.keys(output).length >= APPS_STATE_MAX_OPEN_COUNT_KEYS) {
      break;
    }
  }

  return output;
}

function cleanAppsStateCustomApps(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const result = [];
  const seen = new Set();

  for (const item of value) {
    const name = String(item?.name || "")
      .trim()
      .slice(0, 60);
    const link = cleanAppsStateUrl(item?.link);
    const image = cleanAppsStateImage(item?.image);
    const id = cleanAppsStateId(item?.id);

    if (!id || !name || !link || seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push({
      id,
      name,
      link,
      image,
      categories:
        cleanAppsStateCategories(
          item?.categories,
        ),
    });

    if (result.length >= APPS_STATE_MAX_CUSTOM) {
      break;
    }
  }

  return result;
}

function serializeAppsState(row) {
  return {
    favorites: Array.isArray(row?.favorites)
      ? row.favorites
          .map(cleanAppsStateId)
          .filter(Boolean)
          .slice(0, APPS_STATE_MAX_FAVORITES)
      : [],
    recent: cleanAppsStateRecent(row?.recent),
    openCounts:
      cleanAppsStateOpenCounts(
        row?.open_counts,
      ),
    customApps:
      cleanAppsStateCustomApps(
        row?.custom_apps,
      ),
    updatedAt: row?.updated_at || null,
  };
}

function parseAppsState(body = {}) {
  return {
    favorites: [
      ...new Set(
        (Array.isArray(body.favorites)
          ? body.favorites
          : []
        )
          .map(cleanAppsStateId)
          .filter(Boolean),
      ),
    ].slice(0, APPS_STATE_MAX_FAVORITES),
    recent: cleanAppsStateRecent(body.recent),
    open_counts:
      cleanAppsStateOpenCounts(
        body.openCounts,
      ),
    custom_apps:
      cleanAppsStateCustomApps(
        body.customApps,
      ),
  };
}

app.get(
  "/api/apps/state",
  requireApiAuth,
  async (req, res) => {
    try {
      const { data, error } =
        await supabaseAdmin
          .from("account_app_state")
          .select("*")
          .eq(
            "user_id",
            req.auth.user.id,
          )
          .maybeSingle();

      if (error) {
        throw error;
      }

      return res.json({
        state: serializeAppsState(data),
      });
    } catch (error) {
      console.error(
        "App state load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Your app favorites could not be loaded.",
      });
    }
  },
);

app.put(
  "/api/apps/state",
  requireApiAuth,
  async (req, res) => {
    try {
      const values = parseAppsState(
        req.body,
      );

      const { data, error } =
        await supabaseAdmin
          .from("account_app_state")
          .upsert(
            {
              user_id:
                req.auth.user.id,
              ...values,
              updated_at:
                new Date().toISOString(),
            },
            {
              onConflict: "user_id",
            },
          )
          .select("*")
          .single();

      if (error) {
        throw error;
      }

      return res.json({
        success: true,
        state: serializeAppsState(data),
      });
    } catch (error) {
      console.error(
        "App state save failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Your app favorites could not be saved.",
      });
    }
  },
);

app.post(
  "/api/apps/open",
  requireApiAuth,
  async (req, res) => {
    const appId = cleanAppsStateId(
      req.body.id,
    );
    const appName = String(
      req.body.name || "App",
    )
      .trim()
      .slice(0, 80);
    const appUrl = cleanAppsStateUrl(
      req.body.link,
    );
    const categories =
      cleanAppsStateCategories(
        req.body.categories,
      );

    if (!appId) {
      return res.status(400).json({
        error: "A valid app ID is required.",
      });
    }

    let domain = null;

    if (appUrl) {
      try {
        domain = new URL(appUrl).hostname;
      } catch {
        domain = null;
      }
    }

    void writeActivityLog({
      req,
      userId: req.auth.user.id,
      category: "apps",
      action: "apps.opened",
      status: "success",
      description:
        `${req.auth.profile.username} opened ${appName}.`,
      resourceType: "app",
      resourceId: appId,
      responseStatus: 202,
      metadata: {
        appId,
        appName,
        appDomain: domain,
        categories,
        source: "apps-library",
      },
    });

    return res.status(202).json({
      success: true,
    });
  },
);

/* =======================================================
   BOOKMARKS, CLIENT DIAGNOSTICS + SYSTEM STATUS
======================================================= */

function cleanBookmarkUrl(value) {
  const raw = String(value || "").trim().slice(0, 4000);

  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function cleanBookmarkTitle(value, url = "") {
  const title = String(value || "").trim().slice(0, 160);
  if (title) return title;

  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Saved page";
  }
}

function serializeBookmark(row) {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    engine:
      row.engine === "ultraviolet"
        ? "ultraviolet"
        : "scramjet",
    pinned: row.pinned === true,
    position: Number(row.position || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function bookmarkSetupError(res, error) {
  console.error("Bookmark storage failed:", error);
  return res.status(503).json({
    error:
      "Synced bookmarks are not configured yet. Fuzz will use this browser's local bookmark storage.",
    code: "BOOKMARKS_SETUP_REQUIRED",
  });
}

app.get(
  "/api/bookmarks",
  requireApiAuth,
  async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from("user_bookmarks")
      .select("id, title, url, engine, pinned, position, created_at, updated_at")
      .eq("user_id", req.auth.user.id)
      .order("pinned", { ascending: false })
      .order("position", { ascending: true })
      .order("updated_at", { ascending: false })
      .limit(250);

    if (error) return bookmarkSetupError(res, error);

    return res.json({
      bookmarks: (data || []).map(serializeBookmark),
    });
  },
);

app.post(
  "/api/bookmarks",
  requireApiAuth,
  async (req, res) => {
    const url = cleanBookmarkUrl(req.body.url);
    if (!url) {
      return res.status(400).json({
        error: "Enter a valid http:// or https:// address.",
      });
    }

    const values = {
      user_id: req.auth.user.id,
      title: cleanBookmarkTitle(req.body.title, url),
      url,
      engine:
        req.body.engine === "ultraviolet"
          ? "ultraviolet"
          : "scramjet",
      pinned: req.body.pinned === true,
      position: clampInteger(req.body.position, 0, 0, 100000),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("user_bookmarks")
      .upsert(values, {
        onConflict: "user_id,url",
      })
      .select("id, title, url, engine, pinned, position, created_at, updated_at")
      .single();

    if (error) return bookmarkSetupError(res, error);

    void writeActivityLog({
      req,
      userId: req.auth.user.id,
      category: "bookmarks",
      action: "bookmark.saved",
      status: "success",
      description: `Saved bookmark for ${new URL(url).hostname}.`,
      resourceType: "bookmark",
      resourceId: data.id,
      responseStatus: 201,
      metadata: { domain: new URL(url).hostname },
    });

    return res.status(201).json({
      bookmark: serializeBookmark(data),
    });
  },
);

app.patch(
  "/api/bookmarks/:bookmarkId",
  requireApiAuth,
  async (req, res) => {
    const updates = {
      updated_at: new Date().toISOString(),
    };

    if (Object.hasOwn(req.body, "title")) {
      updates.title = String(req.body.title || "Saved page").trim().slice(0, 160) || "Saved page";
    }
    if (Object.hasOwn(req.body, "url")) {
      const url = cleanBookmarkUrl(req.body.url);
      if (!url) return res.status(400).json({ error: "Enter a valid bookmark URL." });
      updates.url = url;
    }
    if (Object.hasOwn(req.body, "engine")) {
      updates.engine = req.body.engine === "ultraviolet" ? "ultraviolet" : "scramjet";
    }
    if (Object.hasOwn(req.body, "pinned")) {
      updates.pinned = req.body.pinned === true;
    }
    if (Object.hasOwn(req.body, "position")) {
      updates.position = clampInteger(req.body.position, 0, 0, 100000);
    }

    const { data, error } = await supabaseAdmin
      .from("user_bookmarks")
      .update(updates)
      .eq("id", req.params.bookmarkId)
      .eq("user_id", req.auth.user.id)
      .select("id, title, url, engine, pinned, position, created_at, updated_at")
      .maybeSingle();

    if (error) return bookmarkSetupError(res, error);
    if (!data) return res.status(404).json({ error: "Bookmark not found." });

    return res.json({ bookmark: serializeBookmark(data) });
  },
);

app.delete(
  "/api/bookmarks/:bookmarkId",
  requireApiAuth,
  async (req, res) => {
    const { error } = await supabaseAdmin
      .from("user_bookmarks")
      .delete()
      .eq("id", req.params.bookmarkId)
      .eq("user_id", req.auth.user.id);

    if (error) return bookmarkSetupError(res, error);
    return res.json({ success: true });
  },
);

app.post(
  "/api/client-errors",
  requireApiAuth,
  async (req, res) => {
    const providedId = String(req.body.errorId || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 80);
    const errorId = providedId || `FX-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const message = String(req.body.message || "Unknown client error").trim().slice(0, 1200);
    const stack = String(req.body.stack || "").trim().slice(0, 6000);
    const targetUrl = cleanBookmarkUrl(req.body.targetUrl);

    void writeActivityLog({
      req,
      userId: req.auth.user.id,
      category: "client_error",
      action: String(req.body.action || "client.error").trim().slice(0, 120),
      status: "failure",
      description: `${errorId}: ${message}`.slice(0, 1000),
      resourceType: "client_error",
      resourceId: errorId,
      responseStatus: 202,
      proxyTargetUrl: targetUrl || null,
      proxyTargetDomain: targetUrl ? new URL(targetUrl).hostname : null,
      proxyEngine: String(req.body.engine || "").trim().slice(0, 50) || null,
      metadata: {
        errorId,
        page: String(req.body.page || "").trim().slice(0, 1000),
        component: String(req.body.component || "browser").trim().slice(0, 120),
        stack,
        clientMetadata:
          req.body.metadata && typeof req.body.metadata === "object"
            ? req.body.metadata
            : {},
      },
    });

    return res.status(202).json({ success: true, errorId });
  },
);

async function runSystemHealthChecks() {
  const checks = {
    server: {
      status: "online",
      message: "The Express server is responding normally.",
      critical: true,
    },
    database: {
      status: "offline",
      message: "Supabase has not been checked yet.",
      critical: true,
    },
    openai: {
      status: openaiApiKey ? "configured" : "offline",
      message: openaiApiKey
        ? "The OpenAI API key is configured."
        : "The OpenAI API key is missing.",
      critical: false,
    },
    scramjet: {
      status: fs.existsSync(path.join(scramjetPath, "scramjet.all.js"))
        ? "online"
        : "offline",
      message: fs.existsSync(path.join(scramjetPath, "scramjet.all.js"))
        ? "Scramjet client files are installed."
        : "Scramjet client files are missing.",
      critical: true,
    },
    ultraviolet: {
      status: fs.existsSync(path.join(__dirname, "static", "assets", "mathematics", "bundle.js"))
        ? "online"
        : "offline",
      message: fs.existsSync(path.join(__dirname, "static", "assets", "mathematics", "bundle.js"))
        ? "Ultraviolet client files are installed."
        : "Ultraviolet client files are missing.",
      critical: false,
    },
    wisp: {
      status: "online",
      message: "The Wisp WebSocket route is registered.",
      critical: true,
    },
  };

  try {
    const databaseResult = await Promise.race([
      supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Supabase health check timed out.")), 4500),
      ),
    ]);

    if (databaseResult.error) throw databaseResult.error;
    checks.database = {
      status: "online",
      message: "Supabase responded to a protected database query.",
      critical: true,
    };
  } catch (error) {
    checks.database = {
      status: "offline",
      message: String(error?.message || "Supabase did not respond.").slice(0, 300),
      critical: true,
    };
  }

  let platform = null;
  try {
    platform = await getPlatformSettings();
  } catch {}

  const criticalOffline = Object.values(checks).some(
    (check) => check.critical && !["online", "configured"].includes(check.status),
  );

  return {
    overall: criticalOffline ? "degraded" : "online",
    version: FUZZ_RELEASE.version,
    checkedAt: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage().rss,
    cacheEntries: cache.size,
    platform: {
      maintenance: platform ? isMaintenanceActive(platform) : false,
      proxyEnabled: platform?.proxy_enabled !== false,
      aiEnabled: platform?.ai_enabled !== false,
    },
    checks,
  };
}

app.get(
  "/api/status",
  requireApiAuth,
  async (_req, res) => {
    const payload = await runSystemHealthChecks();
    res.setHeader("Cache-Control", "no-store");
    return res.json(payload);
  },
);

app.get(
  "/api/admin/system-health",
  requireRole("admin"),
  async (_req, res) => {
    const [health, recentErrorsResult] = await Promise.all([
      runSystemHealthChecks(),
      supabaseAdmin
        .from("activity_logs")
        .select("id, user_id, description, resource_id, browser, operating_system, created_at, metadata")
        .eq("category", "client_error")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    return res.json({
      ...health,
      recentErrors: recentErrorsResult.error
        ? []
        : recentErrorsResult.data || [],
    });
  },
);

/* =======================================================
   PROXY ACTIVITY
======================================================= */

app.post(
  "/api/proxy/log",
  requireApiAuth,
  async (req, res) => {
    const targetUrl = String(
      req.body.targetUrl || "",
    )
      .trim()
      .slice(0, 4000);

    const query = String(
      req.body.query || "",
    )
      .trim()
      .slice(0, 1000);

    const engine = String(
      req.body.engine || "bare",
    )
      .trim()
      .slice(0, 50);

    const status = String(
      req.body.status || "success",
    )
      .trim()
      .toLowerCase();

    const allowedStatuses = new Set([
      "success",
      "failure",
      "informational",
    ]);

    const usageAllowed =
      await enforceUsageLimit(
        req,
        res,
        {
          proxyRequests: 1,
        },
      );

    if (usageAllowed !== true) {
      return;
    }

    let targetDomain = null;

    if (targetUrl) {
      try {
        targetDomain = new URL(
          targetUrl,
        ).hostname;
      } catch {
        targetDomain = null;
      }
    }

    let retainDetailedProxyHistory = true;

    try {
      const preferences =
        await getAccountCenterPreferences(
          req.auth.user.id,
        );

      retainDetailedProxyHistory =
        preferences.retainProxyHistory;
    } catch (preferenceError) {
      console.error(
        "Proxy privacy preference lookup failed:",
        preferenceError,
      );
    }

    const loggedTargetDomain =
      retainDetailedProxyHistory
        ? targetDomain
        : null;
    const loggedTargetUrl =
      retainDetailedProxyHistory
        ? targetUrl
        : null;
    const loggedQuery =
      retainDetailedProxyHistory
        ? query
        : null;

    void writeActivityLog({
      req,
      userId: req.auth.user.id,
      category: "proxy",
      action:
        status === "failure"
          ? "proxy.navigation_failed"
          : "proxy.navigation",
      status: allowedStatuses.has(status)
        ? status
        : "success",
      description: loggedTargetDomain
        ? `Opened ${loggedTargetDomain} through the proxy.`
        : retainDetailedProxyHistory
          ? "A proxy navigation was started."
          : "A private proxy navigation was recorded without destination details.",
      resourceType: "proxy_navigation",
      responseStatus:
        Number.isFinite(
          Number(req.body.responseStatus),
        )
          ? Number(req.body.responseStatus)
          : null,
      durationMs:
        Number.isFinite(
          Number(req.body.durationMs),
        )
          ? Math.max(
              0,
              Number(req.body.durationMs),
            )
          : null,
      proxyQuery: loggedQuery || null,
      proxyTargetUrl:
        loggedTargetUrl || null,
      proxyTargetDomain:
        loggedTargetDomain,
      proxyEngine: engine || "bare",
      metadata: {
        source:
          String(
            req.body.source || "proxy-ui",
          )
            .trim()
            .slice(0, 100) ||
          "proxy-ui",
      },
    });

    return res.status(202).json({
      success: true,
    });
  },
);

/* =======================================================
   ADMIN DASHBOARD
======================================================= */

app.get(
  "/api/admin/dashboard",
  requireRole("admin"),
  async (req, res) => {
    const forceRefresh =
      req.query.refresh === "1";

    if (
      !forceRefresh &&
      adminDashboardCache.value &&
      adminDashboardCache.expiresAt >
        Date.now()
    ) {
      return res.json({
        ...adminDashboardCache.value,
        cached: true,
      });
    }

    try {
      const [
        users,
        profilesResult,
        aiChatsResult,
        aiMessagesResult,
        activityCountResult,
        proxyCountResult,
        recentActivityResult,
      ] = await Promise.all([
        getAllAuthUsers(),
        supabaseAdmin
          .from("profiles")
          .select(
            "id, username, role, banned",
          ),
        supabaseAdmin
          .from("ai_chats")
          .select("id", {
            count: "exact",
            head: true,
          }),
        supabaseAdmin
          .from("ai_messages")
          .select("id", {
            count: "exact",
            head: true,
          }),
        supabaseAdmin
          .from("activity_logs")
          .select("id", {
            count: "exact",
            head: true,
          }),
        supabaseAdmin
          .from("activity_logs")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("category", "proxy"),
        supabaseAdmin
          .from("activity_logs")
          .select(
            "id, user_id, actor_user_id, target_user_id, category, action, status, description, resource_type, resource_id, response_status, duration_ms, browser, operating_system, device_type, created_at, metadata",
          )
          .order("created_at", {
            ascending: false,
          })
          .limit(25),
      ]);

      const errors = [
        profilesResult.error,
        aiChatsResult.error,
        aiMessagesResult.error,
        activityCountResult.error,
        proxyCountResult.error,
        recentActivityResult.error,
      ].filter(Boolean);

      if (errors.length > 0) {
        throw errors[0];
      }

      const profiles =
        profilesResult.data || [];

      const payload = {
        stats: {
          totalUsers: users.length,
          verifiedUsers: users.filter(
            (user) =>
              Boolean(
                user.email_confirmed_at,
              ),
          ).length,
          owners: profiles.filter(
            (profile) =>
              profile.role === "owner",
          ).length,
          admins: profiles.filter(
            (profile) =>
              profile.role === "admin",
          ).length,
          moderators: profiles.filter(
            (profile) =>
              profile.role === "moderator",
          ).length,
          bannedUsers: profiles.filter(
            (profile) =>
              profile.banned === true,
          ).length,
          aiChats:
            aiChatsResult.count || 0,
          aiMessages:
            aiMessagesResult.count || 0,
          proxyRequests:
            proxyCountResult.count || 0,
          activityLogs:
            activityCountResult.count || 0,
        },
        recentActivity:
          recentActivityResult.data || [],
        system: {
          server: true,
          supabase: true,
          openai:
            Boolean(openaiApiKey),
          proxy: true,
          authentication: true,
          uptime: process.uptime(),
          memory:
            process.memoryUsage().rss,
          cacheEntries: cache.size,
          timestamp:
            new Date().toISOString(),
        },
        cached: false,
      };

      adminDashboardCache = {
        value: payload,
        expiresAt:
          Date.now() +
          ADMIN_DASHBOARD_CACHE_TTL,
      };

      return res.json(payload);
    } catch (error) {
      console.error(
        "Dashboard load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "The dashboard could not be loaded.",
      });
    }
  },
);

app.get(
  "/api/admin/stats",
  requireRole("admin"),
  async (req, res) => {
    const days = clampInteger(
      req.query.days,
      30,
      7,
      90,
    );

    try {
      const since = startOfUtcDay();
      since.setUTCDate(
        since.getUTCDate() - (days - 1),
      );

      const sinceIso =
        since.toISOString();

      const [
        users,
        profilesResult,
        chatsResult,
        messagesResult,
        activityResult,
        totalActivityResult,
        totalChatsResult,
        totalMessagesResult,
        totalProxyResult,
      ] = await Promise.all([
        getAllAuthUsers(),
        supabaseAdmin
          .from("profiles")
          .select("id, role, banned"),
        supabaseAdmin
          .from("ai_chats")
          .select("id, created_at")
          .gte("created_at", sinceIso)
          .limit(10000),
        supabaseAdmin
          .from("ai_messages")
          .select("id, created_at")
          .gte("created_at", sinceIso)
          .limit(10000),
        supabaseAdmin
          .from("activity_logs")
          .select(
            "id, category, action, created_at",
          )
          .gte("created_at", sinceIso)
          .order("created_at", {
            ascending: true,
          })
          .limit(10000),
        supabaseAdmin
          .from("activity_logs")
          .select("id", {
            count: "exact",
            head: true,
          }),
        supabaseAdmin
          .from("ai_chats")
          .select("id", {
            count: "exact",
            head: true,
          }),
        supabaseAdmin
          .from("ai_messages")
          .select("id", {
            count: "exact",
            head: true,
          }),
        supabaseAdmin
          .from("activity_logs")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("category", "proxy"),
      ]);

      const errors = [
        profilesResult.error,
        chatsResult.error,
        messagesResult.error,
        activityResult.error,
        totalActivityResult.error,
        totalChatsResult.error,
        totalMessagesResult.error,
        totalProxyResult.error,
      ].filter(Boolean);

      if (errors.length > 0) {
        throw errors[0];
      }

      const profiles =
        profilesResult.data || [];

      const recentUsers = users.filter(
        (user) =>
          new Date(
            user.created_at,
          ).getTime() >= since.getTime(),
      );

      const userSeries = fillDailySeries(
        createDailySeries(days),
        recentUsers.map((user) => ({
          created_at: user.created_at,
        })),
      );

      const chatSeries = fillDailySeries(
        createDailySeries(days),
        chatsResult.data || [],
      );

      const messageSeries = fillDailySeries(
        createDailySeries(days),
        messagesResult.data || [],
      );

      const activitySeries =
        fillDailySeries(
          createDailySeries(days),
          activityResult.data || [],
        );

      const proxySeries = fillDailySeries(
        createDailySeries(days),
        (activityResult.data || []).filter(
          (row) =>
            row.category === "proxy",
        ),
      );

      return res.json({
        period: {
          days,
          since: sinceIso,
          until:
            new Date().toISOString(),
        },
        totals: {
          users: users.length,
          verifiedUsers: users.filter(
            (user) =>
              Boolean(
                user.email_confirmed_at,
              ),
          ).length,
          owners: profiles.filter(
            (profile) =>
              profile.role === "owner",
          ).length,
          admins: profiles.filter(
            (profile) =>
              profile.role === "admin",
          ).length,
          moderators: profiles.filter(
            (profile) =>
              profile.role === "moderator",
          ).length,
          bannedUsers: profiles.filter(
            (profile) =>
              profile.banned === true,
          ).length,
          aiChats:
            totalChatsResult.count || 0,
          aiMessages:
            totalMessagesResult.count ||
            0,
          proxyRequests:
            totalProxyResult.count || 0,
          activityLogs:
            totalActivityResult.count ||
            0,
        },
        charts: {
          users: userSeries,
          aiChats: chatSeries,
          aiMessages: messageSeries,
          proxyRequests: proxySeries,
          activityLogs: activitySeries,
        },
        limits: {
          chartRowsPerSource: 10000,
        },
      });
    } catch (error) {
      console.error(
        "Admin stats failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Dashboard statistics could not be loaded.",
      });
    }
  },
);

app.get(
  "/api/admin/activity",
  requireRole("admin"),
  async (req, res) => {
    const page = clampInteger(
      req.query.page,
      1,
      1,
      100000,
    );

    const limit = clampInteger(
      req.query.limit,
      50,
      1,
      200,
    );

    const offset = (page - 1) * limit;

    const category = String(
      req.query.category || "",
    ).trim();

    const status = String(
      req.query.status || "",
    ).trim();

    const action = String(
      req.query.action || "",
    ).trim();

    const search = String(
      req.query.search || "",
    )
      .trim()
      .slice(0, 100);

    const after = String(
      req.query.after || "",
    ).trim();

    const before = String(
      req.query.before || "",
    ).trim();

    try {
      let query = supabaseAdmin
        .from("activity_logs")
        .select("*", {
          count: "exact",
        })
        .order("created_at", {
          ascending: false,
        })
        .range(
          offset,
          offset + limit - 1,
        );

      if (category) {
        query = query.eq(
          "category",
          category,
        );
      }

      if (status) {
        query = query.eq(
          "status",
          status,
        );
      }

      if (action) {
        query = query.eq(
          "action",
          action,
        );
      }

      if (
        after &&
        !Number.isNaN(
          new Date(after).getTime(),
        )
      ) {
        query = query.gt(
          "created_at",
          new Date(after).toISOString(),
        );
      }

      if (
        before &&
        !Number.isNaN(
          new Date(before).getTime(),
        )
      ) {
        query = query.lt(
          "created_at",
          new Date(before).toISOString(),
        );
      }

      if (search) {
        const safeSearch = search
          .replaceAll(",", " ")
          .replaceAll("%", "");

        query = query.or(
          `description.ilike.%${safeSearch}%,action.ilike.%${safeSearch}%`,
        );
      }

      const {
        data,
        count,
        error,
      } = await query;

      if (error) {
        throw error;
      }

      return res.json({
        logs: data || [],
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.max(
            1,
            Math.ceil(
              (count || 0) / limit,
            ),
          ),
        },
        serverTime:
          new Date().toISOString(),
      });
    } catch (error) {
      console.error(
        "Activity load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Activity logs could not be loaded.",
      });
    }
  },
);

app.get(
  "/api/admin/system",
  requireRole("admin"),
  async (_req, res) => {
    const checkedAt =
      new Date().toISOString();

    try {
      const startedAt = Date.now();

      const { error: supabaseError } =
        await supabaseAdmin
          .from("profiles")
          .select("id")
          .limit(1);

      const supabaseLatencyMs =
        Date.now() - startedAt;

      return res.json({
        checkedAt,
        services: {
          server: {
            online: true,
            uptimeSeconds:
              process.uptime(),
          },
          supabase: {
            online: !supabaseError,
            latencyMs:
              supabaseLatencyMs,
            error:
              supabaseError?.message ||
              null,
          },
          openai: {
            configured:
              Boolean(openaiApiKey),
            online:
              Boolean(openaiApiKey),
          },
          bareServer: {
            online: true,
            path: "/ca/",
          },
          authentication: {
            online: Boolean(
              supabaseUrl &&
                supabaseAnonKey,
            ),
          },
        },
        process: {
          nodeVersion: process.version,
          platform: process.platform,
          pid: process.pid,
          memory:
            process.memoryUsage(),
        },
        cache: {
          entries: cache.size,
          ttlMs: CACHE_TTL,
          dashboardTtlMs:
            ADMIN_DASHBOARD_CACHE_TTL,
        },
      });
    } catch (error) {
      console.error(
        "System status failed:",
        error,
      );

      return res.status(500).json({
        error:
          "System status could not be checked.",
      });
    }
  },
);

app.post(
  "/api/admin/cache/clear",
  requireRole("owner"),
  async (req, res) => {
    const previousEntries = cache.size;
    cache.clear();
    invalidateAdminCache();

    void writeActivityLog({
      req,
      userId: req.auth.user.id,
      actorUserId: req.auth.user.id,
      category: "admin",
      action: "admin.cache_cleared",
      status: "success",
      description:
        `${req.auth.profile.username} cleared the remote asset cache.`,
      responseStatus: 200,
      oldValues: {
        entries: previousEntries,
      },
      newValues: {
        entries: 0,
      },
    });

    return res.json({
      success: true,
      clearedEntries:
        previousEntries,
    });
  },
);

/* =======================================================
   ADMIN INVITE CODES
======================================================= */

app.get(
  "/api/admin/invites",
  requireRole("admin"),
  async (_req, res) => {
    try {
      const { data: invites, error } =
        await supabaseAdmin
          .from("invite_codes")
          .select(
            "id, code, used, used_by",
          )
          .order("id", {
            ascending: false,
          });

      if (error) {
        throw error;
      }

      const profileMap =
        await getProfilesByIds(
          (invites || []).map(
            (invite) => invite.used_by,
          ),
        );

      return res.json({
        invites: (invites || []).map(
          (invite) => ({
            ...invite,
            usedByProfile:
              invite.used_by
                ? profileMap.get(
                    invite.used_by,
                  ) || null
                : null,
          }),
        ),
      });
    } catch (error) {
      console.error(
        "Invite load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Invite codes could not be loaded.",
      });
    }
  },
);

app.post(
  "/api/admin/invites",
  requireRole("admin"),
  async (req, res) => {
    const requestedCode = String(
      req.body.code || "",
    )
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "")
      .slice(0, 32);

    const amount = clampInteger(
      req.body.amount,
      1,
      1,
      25,
    );

    if (
      requestedCode &&
      requestedCode.length < 4
    ) {
      return res.status(400).json({
        error:
          "Custom invite codes must be at least 4 characters.",
      });
    }

    try {
      const rows = [];
      const generated = new Set();

      for (
        let index = 0;
        index < amount;
        index += 1
      ) {
        let code =
          requestedCode && amount === 1
            ? requestedCode
            : createInviteCode();

        while (generated.has(code)) {
          code = createInviteCode();
        }

        generated.add(code);

        rows.push({
          code,
          used: false,
          used_by: null,
        });
      }

      const { data: invites, error } =
        await supabaseAdmin
          .from("invite_codes")
          .insert(rows)
          .select(
            "id, code, used, used_by",
          );

      if (error) {
        if (error.code === "23505") {
          return res.status(409).json({
            error:
              "One of those invite codes already exists.",
          });
        }

        throw error;
      }

      invalidateAdminCache();

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId:
          req.auth.user.id,
        category: "admin",
        action:
          "admin.invites_created",
        status: "success",
        description:
          `${req.auth.profile.username} generated ${invites?.length || 0} invite ${invites?.length === 1 ? "code" : "codes"}.`,
        resourceType: "invite_code",
        responseStatus: 201,
        newValues: {
          codes: (invites || []).map(
            (invite) => invite.code,
          ),
        },
      });

      return res.status(201).json({
        invites: invites || [],
      });
    } catch (error) {
      console.error(
        "Invite creation failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Invite codes could not be created.",
      });
    }
  },
);

app.delete(
  "/api/admin/invites/:inviteId",
  requireRole("admin"),
  async (req, res) => {
    const inviteId = String(
      req.params.inviteId || "",
    );

    try {
      const {
        data: invite,
        error: lookupError,
      } = await supabaseAdmin
        .from("invite_codes")
        .select(
          "id, code, used, used_by",
        )
        .eq("id", inviteId)
        .maybeSingle();

      if (lookupError) {
        throw lookupError;
      }

      if (!invite) {
        return res.status(404).json({
          error:
            "That invite code was not found.",
        });
      }

      if (invite.used) {
        return res.status(409).json({
          error:
            "Used invite codes are kept for account history.",
        });
      }

      const { error: deleteError } =
        await supabaseAdmin
          .from("invite_codes")
          .delete()
          .eq("id", inviteId)
          .eq("used", false);

      if (deleteError) {
        throw deleteError;
      }

      invalidateAdminCache();

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId:
          req.auth.user.id,
        category: "admin",
        action:
          "admin.invite_deleted",
        status: "success",
        description:
          `${req.auth.profile.username} deleted an unused invite code.`,
        resourceType: "invite_code",
        resourceId: inviteId,
        responseStatus: 200,
        oldValues: {
          code: invite.code,
          used: invite.used,
        },
      });

      return res.json({
        success: true,
      });
    } catch (error) {
      console.error(
        "Invite deletion failed:",
        error,
      );

      return res.status(500).json({
        error:
          "That invite code could not be deleted.",
      });
    }
  },
);

/* =======================================================
   ADMIN AI ANALYTICS
======================================================= */

app.get(
  "/api/admin/ai/analytics",
  requireRole("admin"),
  async (req, res) => {
    const days = clampInteger(
      req.query.days,
      30,
      7,
      90,
    );

    const since = startOfUtcDay();
    since.setUTCDate(
      since.getUTCDate() - (days - 1),
    );

    try {
      const [
        chatCountResult,
        messageCountResult,
        recentMessagesResult,
        recentResponsesResult,
      ] = await Promise.all([
        supabaseAdmin
          .from("ai_chats")
          .select("id", {
            count: "exact",
            head: true,
          }),
        supabaseAdmin
          .from("ai_messages")
          .select("id", {
            count: "exact",
            head: true,
          }),
        supabaseAdmin
          .from("ai_messages")
          .select(
            "id, user_id, role, has_image, created_at",
          )
          .gte(
            "created_at",
            since.toISOString(),
          )
          .order("created_at", {
            ascending: true,
          })
          .limit(10000),
        supabaseAdmin
          .from("activity_logs")
          .select(
            "user_id, ai_model, duration_ms, output_length, input_tokens, output_tokens, total_tokens, created_at",
          )
          .eq(
            "action",
            "ai.response_completed",
          )
          .gte(
            "created_at",
            since.toISOString(),
          )
          .limit(10000),
      ]);

      const errors = [
        chatCountResult.error,
        messageCountResult.error,
        recentMessagesResult.error,
        recentResponsesResult.error,
      ].filter(Boolean);

      if (errors.length > 0) {
        throw errors[0];
      }

      const messages =
        recentMessagesResult.data || [];

      const responses =
        recentResponsesResult.data || [];

      const activityByUser = new Map();

      for (const message of messages) {
        if (!message.user_id) {
          continue;
        }

        activityByUser.set(
          message.user_id,
          (activityByUser.get(
            message.user_id,
          ) || 0) + 1,
        );
      }

      const profileMap =
        await getProfilesByIds(
          [...activityByUser.keys()],
        );

      const topUsers = [
        ...activityByUser.entries(),
      ]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([userId, messagesSent]) => ({
          userId,
          username:
            profileMap.get(userId)
              ?.username || "Unknown",
          messages: messagesSent,
        }));

      const validDurations = responses
        .map((row) => row.duration_ms)
        .filter(
          (value) =>
            Number.isFinite(
              Number(value),
            ),
        )
        .map(Number);

      const sum = (values) =>
        values.reduce(
          (total, value) =>
            total + Number(value || 0),
          0,
        );

      return res.json({
        period: {
          days,
          since: since.toISOString(),
          until:
            new Date().toISOString(),
        },
        totals: {
          chats:
            chatCountResult.count || 0,
          messages:
            messageCountResult.count || 0,
          responses:
            responses.length,
          userMessages: messages.filter(
            (message) =>
              message.role === "user",
          ).length,
          assistantMessages:
            messages.filter(
              (message) =>
                message.role ===
                "assistant",
            ).length,
          imageMessages: messages.filter(
            (message) =>
              message.has_image === true,
          ).length,
          inputTokens: sum(
            responses.map(
              (row) => row.input_tokens,
            ),
          ),
          outputTokens: sum(
            responses.map(
              (row) => row.output_tokens,
            ),
          ),
          totalTokens: sum(
            responses.map(
              (row) => row.total_tokens,
            ),
          ),
        },
        performance: {
          averageDurationMs:
            validDurations.length > 0
              ? Math.round(
                  sum(validDurations) /
                    validDurations.length,
                )
              : null,
          averageOutputLength:
            responses.length > 0
              ? Math.round(
                  sum(
                    responses.map(
                      (row) =>
                        row.output_length,
                    ),
                  ) / responses.length,
                )
              : null,
        },
        charts: {
          messages: fillDailySeries(
            createDailySeries(days),
            messages,
          ),
          responses: fillDailySeries(
            createDailySeries(days),
            responses,
          ),
        },
        topUsers,
      });
    } catch (error) {
      console.error(
        "AI analytics failed:",
        error,
      );

      return res.status(500).json({
        error:
          "AI analytics could not be loaded.",
      });
    }
  },
);

/* =======================================================
   ADMIN PROXY ANALYTICS
======================================================= */

app.get(
  "/api/admin/proxy/analytics",
  requireRole("admin"),
  async (req, res) => {
    const days = clampInteger(
      req.query.days,
      30,
      7,
      90,
    );

    const since = startOfUtcDay();
    since.setUTCDate(
      since.getUTCDate() - (days - 1),
    );

    try {
      const [
        totalResult,
        recentResult,
      ] = await Promise.all([
        supabaseAdmin
          .from("activity_logs")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("category", "proxy"),
        supabaseAdmin
          .from("activity_logs")
          .select(
            "id, user_id, action, status, response_status, duration_ms, proxy_target_domain, proxy_engine, created_at",
          )
          .eq("category", "proxy")
          .gte(
            "created_at",
            since.toISOString(),
          )
          .order("created_at", {
            ascending: true,
          })
          .limit(10000),
      ]);

      if (totalResult.error) {
        throw totalResult.error;
      }

      if (recentResult.error) {
        throw recentResult.error;
      }

      const requests =
        recentResult.data || [];

      const domainCounts = new Map();
      const engineCounts = new Map();
      const userCounts = new Map();

      for (const request of requests) {
        const domain =
          request.proxy_target_domain ||
          "Unknown";

        const engine =
          request.proxy_engine || "bare";

        domainCounts.set(
          domain,
          (domainCounts.get(domain) || 0) +
            1,
        );

        engineCounts.set(
          engine,
          (engineCounts.get(engine) || 0) +
            1,
        );

        if (request.user_id) {
          userCounts.set(
            request.user_id,
            (userCounts.get(
              request.user_id,
            ) || 0) + 1,
          );
        }
      }

      const profileMap =
        await getProfilesByIds(
          [...userCounts.keys()],
        );

      const durations = requests
        .map((request) =>
          Number(request.duration_ms),
        )
        .filter(Number.isFinite);

      const averageDurationMs =
        durations.length > 0
          ? Math.round(
              durations.reduce(
                (total, value) =>
                  total + value,
                0,
              ) / durations.length,
            )
          : null;

      return res.json({
        period: {
          days,
          since: since.toISOString(),
          until:
            new Date().toISOString(),
        },
        totals: {
          allTime:
            totalResult.count || 0,
          inPeriod: requests.length,
          successful: requests.filter(
            (request) =>
              request.status === "success",
          ).length,
          failed: requests.filter(
            (request) =>
              request.status === "failure",
          ).length,
          uniqueDomains:
            domainCounts.size,
          activeUsers: userCounts.size,
        },
        performance: {
          averageDurationMs,
        },
        charts: {
          requests: fillDailySeries(
            createDailySeries(days),
            requests,
          ),
        },
        topDomains: [
          ...domainCounts.entries(),
        ]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([domain, count]) => ({
            domain,
            count,
          })),
        engines: [
          ...engineCounts.entries(),
        ]
          .sort((a, b) => b[1] - a[1])
          .map(([engine, count]) => ({
            engine,
            count,
          })),
        topUsers: [
          ...userCounts.entries(),
        ]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([userId, count]) => ({
            userId,
            username:
              profileMap.get(userId)
                ?.username || "Unknown",
            requests: count,
          })),
      });
    } catch (error) {
      console.error(
        "Proxy analytics failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Proxy analytics could not be loaded.",
      });
    }
  },
);

/* =======================================================
   OWNER AI CHAT HISTORY

   Paste this block immediately BEFORE the section:
   ADMIN COMMAND SEARCH
======================================================= */

app.get(
  "/api/admin/ai/history",
  requireRole("owner"),
  async (req, res) => {
    const page = clampInteger(req.query.page, 1, 1, 100000);
    const limit = clampInteger(req.query.limit, 30, 1, 100);
    const search = String(req.query.search || "").trim().slice(0, 80);
    const offset = (page - 1) * limit;

    try {
      let matchingProfileIds = [];

      if (search) {
        const safeSearch = search.replace(/[%,()]/g, " ").trim();

        const {
          data: matchingProfiles,
          error: matchingProfilesError,
        } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .ilike("username", `%${safeSearch}%`)
          .limit(100);

        if (matchingProfilesError) {
          throw matchingProfilesError;
        }

        matchingProfileIds = (matchingProfiles || []).map(
          (profile) => profile.id,
        );
      }

      let chatQuery = supabaseAdmin
        .from("ai_chats")
        .select("id, user_id, title, created_at, updated_at", {
          count: "exact",
        })
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (search) {
        const safeSearch = search.replace(/[%,()]/g, " ").trim();
        const filters = [`title.ilike.%${safeSearch}%`];

        if (matchingProfileIds.length > 0) {
          filters.push(`user_id.in.(${matchingProfileIds.join(",")})`);
        }

        chatQuery = chatQuery.or(filters.join(","));
      }

      const {
        data: chats,
        count,
        error: chatsError,
      } = await chatQuery;

      if (chatsError) {
        throw chatsError;
      }

      const chatRows = chats || [];
      const chatIds = chatRows.map((chat) => chat.id);
      let messages = [];

      if (chatIds.length > 0) {
        const {
          data: messageRows,
          error: messagesError,
        } = await supabaseAdmin
          .from("ai_messages")
          .select("id, chat_id, role, content, has_image, image_name, created_at")
          .in("chat_id", chatIds)
          .order("created_at", { ascending: true });

        if (messagesError) {
          throw messagesError;
        }

        messages = messageRows || [];
      }

      const profileMap = await getProfilesByIds(
        chatRows.map((chat) => chat.user_id),
      );

      const messagesByChat = new Map();

      for (const message of messages) {
        if (!messagesByChat.has(message.chat_id)) {
          messagesByChat.set(message.chat_id, []);
        }

        messagesByChat.get(message.chat_id).push(message);
      }

      const result = chatRows.map((chat) => {
        const chatMessages = messagesByChat.get(chat.id) || [];
        const lastMessage = chatMessages.at(-1) || null;

        return {
          id: chat.id,
          userId: chat.user_id,
          username: profileMap.get(chat.user_id)?.username || "Unknown",
          title: chat.title,
          createdAt: chat.created_at,
          updatedAt: chat.updated_at,
          messageCount: chatMessages.length,
          lastMessagePreview: lastMessage?.content
            ? String(lastMessage.content).replace(/\s+/g, " ").slice(0, 180)
            : null,
          lastMessageRole: lastMessage?.role || null,
          hadImage: chatMessages.some((message) => message.has_image === true),
        };
      });

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId: req.auth.user.id,
        category: "admin",
        action: "owner.ai_history_viewed",
        status: "informational",
        description: `${req.auth.profile.username} viewed AI chat history.`,
        responseStatus: 200,
        metadata: {
          page,
          limit,
          search: search || null,
          returnedChats: result.length,
        },
      });

      return res.json({
        chats: result,
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.max(1, Math.ceil((count || 0) / limit)),
        },
      });
    } catch (error) {
      console.error("AI history load failed:", error);

      return res.status(500).json({
        error: "AI chat history could not be loaded.",
      });
    }
  },
);

app.get(
  "/api/admin/ai/history/:chatId",
  requireRole("owner"),
  async (req, res) => {
    const chatId = String(req.params.chatId || "");

    try {
      const {
        data: chat,
        error: chatError,
      } = await supabaseAdmin
        .from("ai_chats")
        .select("id, user_id, title, created_at, updated_at")
        .eq("id", chatId)
        .maybeSingle();

      if (chatError) {
        throw chatError;
      }

      if (!chat) {
        return res.status(404).json({
          error: "That AI chat was not found.",
        });
      }

      const {
        data: messages,
        error: messagesError,
      } = await supabaseAdmin
        .from("ai_messages")
        .select("id, role, content, has_image, image_name, created_at")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

      if (messagesError) {
        throw messagesError;
      }

      const profileMap = await getProfilesByIds([chat.user_id]);
      const username = profileMap.get(chat.user_id)?.username || "Unknown";

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId: req.auth.user.id,
        targetUserId: chat.user_id,
        category: "admin",
        action: "owner.ai_chat_opened",
        status: "informational",
        description: `${req.auth.profile.username} opened ${username}'s AI chat.`,
        resourceType: "ai_chat",
        resourceId: chat.id,
        chatId: chat.id,
        responseStatus: 200,
        metadata: {
          targetUsername: username,
          title: chat.title,
          messageCount: messages?.length || 0,
        },
      });

      return res.json({
        chat: {
          id: chat.id,
          userId: chat.user_id,
          username,
          title: chat.title,
          createdAt: chat.created_at,
          updatedAt: chat.updated_at,
        },
        messages: (messages || []).map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          hasImage: message.has_image === true,
          imageName: message.image_name,
          createdAt: message.created_at,
        })),
      });
    } catch (error) {
      console.error("AI chat detail load failed:", error);

      return res.status(500).json({
        error: "That AI conversation could not be loaded.",
      });
    }
  },
);

/* =======================================================
   OWNER PROXY SEARCH HISTORY
======================================================= */

app.get(
  "/api/admin/proxy/history",
  requireRole("owner"),
  async (req, res) => {
    const page = clampInteger(req.query.page, 1, 1, 100000);
    const limit = clampInteger(req.query.limit, 50, 1, 200);
    const search = String(req.query.search || "").trim().slice(0, 100);
    const status = String(req.query.status || "").trim().toLowerCase();
    const offset = (page - 1) * limit;

    try {
      let matchingProfileIds = [];

      if (search) {
        const safeSearch = search.replace(/[%,()]/g, " ").trim();

        const {
          data: matchingProfiles,
          error: profileSearchError,
        } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .ilike("username", `%${safeSearch}%`)
          .limit(100);

        if (profileSearchError) {
          throw profileSearchError;
        }

        matchingProfileIds = (matchingProfiles || []).map(
          (profile) => profile.id,
        );
      }

      let query = supabaseAdmin
        .from("activity_logs")
        .select(
          "id, user_id, action, status, response_status, duration_ms, proxy_query, proxy_target_url, proxy_target_domain, proxy_engine, created_at",
          { count: "exact" },
        )
        .eq("category", "proxy")
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (["success", "failure"].includes(status)) {
        query = query.eq("status", status);
      }

      if (search) {
        const safeSearch = search.replace(/[%,()]/g, " ").trim();
        const filters = [
          `proxy_query.ilike.%${safeSearch}%`,
          `proxy_target_url.ilike.%${safeSearch}%`,
          `proxy_target_domain.ilike.%${safeSearch}%`,
          `proxy_engine.ilike.%${safeSearch}%`,
        ];

        if (matchingProfileIds.length > 0) {
          filters.push(`user_id.in.(${matchingProfileIds.join(",")})`);
        }

        query = query.or(filters.join(","));
      }

      const {
        data: logs,
        count,
        error,
      } = await query;

      if (error) {
        throw error;
      }

      const rows = logs || [];
      const profileMap = await getProfilesByIds(
        rows.map((row) => row.user_id),
      );

      const result = rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        username: profileMap.get(row.user_id)?.username || "Unknown",
        action: row.action,
        status: row.status,
        responseStatus: row.response_status,
        durationMs: row.duration_ms,
        proxyQuery: row.proxy_query,
        proxyTargetUrl: row.proxy_target_url,
        proxyTargetDomain: row.proxy_target_domain,
        proxyEngine: row.proxy_engine,
        createdAt: row.created_at,
      }));

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId: req.auth.user.id,
        category: "admin",
        action: "owner.proxy_history_viewed",
        status: "informational",
        description: `${req.auth.profile.username} viewed proxy search history.`,
        responseStatus: 200,
        metadata: {
          page,
          limit,
          search: search || null,
          status: status || null,
          returnedLogs: result.length,
        },
      });

      return res.json({
        logs: result,
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.max(1, Math.ceil((count || 0) / limit)),
        },
      });
    } catch (error) {
      console.error("Proxy history load failed:", error);

      return res.status(500).json({
        error: "Proxy search history could not be loaded.",
      });
    }
  },
);

/* =======================================================
   OWNER USER PROFILES

   Paste this block immediately before:
   ADMIN COMMAND SEARCH
======================================================= */

app.get(
  "/api/admin/users/:userId/profile",
  requireRole("owner"),
  async (req, res) => {
    const targetUserId = String(
      req.params.userId || "",
    );

    try {
      const [
        authResult,
        profileResult,
        aiChatsResult,
        aiMessagesResult,
        proxyResult,
        activityResult,
        inviteResult,
        recentClientResult,
        recentActivityResult,
      ] = await Promise.all([
        supabaseAdmin.auth.admin.getUserById(
          targetUserId,
        ),
        supabaseAdmin
          .from("profiles")
          .select(
            "id, username, role, banned, suspended_until, suspension_reason, suspended_at, suspended_by, suspension_source",
          )
          .eq("id", targetUserId)
          .maybeSingle(),
        supabaseAdmin
          .from("ai_chats")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("user_id", targetUserId),
        supabaseAdmin
          .from("ai_messages")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("user_id", targetUserId),
        supabaseAdmin
          .from("activity_logs")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("user_id", targetUserId)
          .eq("category", "proxy"),
        supabaseAdmin
          .from("activity_logs")
          .select("id", {
            count: "exact",
            head: true,
          })
          .or(
            `user_id.eq.${targetUserId},actor_user_id.eq.${targetUserId},target_user_id.eq.${targetUserId}`,
          ),
        supabaseAdmin
          .from("invite_codes")
          .select("id, code, used")
          .eq("used_by", targetUserId)
          .limit(1),
        supabaseAdmin
          .from("activity_logs")
          .select(
            "browser, operating_system, device_type, ip_address, created_at",
          )
          .or(
            `user_id.eq.${targetUserId},actor_user_id.eq.${targetUserId}`,
          )
          .order("created_at", {
            ascending: false,
          })
          .limit(1),
        supabaseAdmin
          .from("activity_logs")
          .select(
            "id, category, action, status, description, created_at",
          )
          .or(
            `user_id.eq.${targetUserId},actor_user_id.eq.${targetUserId},target_user_id.eq.${targetUserId}`,
          )
          .order("created_at", {
            ascending: false,
          })
          .limit(12),
      ]);

      const errors = [
        authResult.error,
        profileResult.error,
        aiChatsResult.error,
        aiMessagesResult.error,
        proxyResult.error,
        activityResult.error,
        inviteResult.error,
        recentClientResult.error,
        recentActivityResult.error,
      ].filter(Boolean);

      if (errors.length > 0) {
        throw errors[0];
      }

      const authUser =
        authResult.data?.user;
      const profile = profileResult.data;

      if (!authUser || !profile) {
        return res.status(404).json({
          error: "That user was not found.",
        });
      }

      const recentClient =
        recentClientResult.data?.[0] ||
        null;

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId: req.auth.user.id,
        targetUserId,
        category: "admin",
        action:
          "owner.user_profile_viewed",
        status: "informational",
        description:
          `${req.auth.profile.username} viewed ${profile.username}'s user profile.`,
        resourceType: "user",
        resourceId: targetUserId,
        responseStatus: 200,
        metadata: {
          targetUsername:
            profile.username,
        },
      });

      return res.json({
        user: {
          id: authUser.id,
          email: authUser.email,
          emailVerified: Boolean(
            authUser.email_confirmed_at,
          ),
          username: profile.username,
          role: profile.role,
          banned:
            profile.banned === true,
          suspended:
            getSuspensionState(profile)
              .active,
          suspendedUntil:
            profile.suspended_until,
          suspensionReason:
            profile.suspension_reason,
          suspensionSource:
            profile.suspension_source,
          suspendedAt:
            profile.suspended_at,
          createdAt:
            authUser.created_at,
          lastSignInAt:
            authUser.last_sign_in_at,
        },
        stats: {
          aiChats:
            aiChatsResult.count || 0,
          aiMessages:
            aiMessagesResult.count || 0,
          proxyRequests:
            proxyResult.count || 0,
          activityLogs:
            activityResult.count || 0,
        },
        invite:
          inviteResult.data?.[0] ||
          null,
        recentClient: recentClient
          ? {
              browser:
                recentClient.browser,
              operatingSystem:
                recentClient.operating_system,
              deviceType:
                recentClient.device_type,
              ipAddress:
                recentClient.ip_address,
              lastSeenAt:
                recentClient.created_at,
            }
          : null,
        recentActivity:
          recentActivityResult.data || [],
        permissions: {
          canChangeRole:
            targetUserId !==
            req.auth.user.id,
          canBan:
            targetUserId !==
              req.auth.user.id &&
            profile.role !== "owner",
          canSuspend:
            targetUserId !==
              req.auth.user.id &&
            profile.role !== "owner",
        },
      });
    } catch (error) {
      console.error(
        "User profile load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "That user profile could not be loaded.",
      });
    }
  },
);

app.get(
  "/api/admin/users/:userId/activity",
  requireRole("owner"),
  async (req, res) => {
    const targetUserId = String(
      req.params.userId || "",
    );

    const page = clampInteger(
      req.query.page,
      1,
      1,
      100000,
    );

    const limit = clampInteger(
      req.query.limit,
      50,
      1,
      200,
    );

    const category = String(
      req.query.category || "",
    ).trim();

    const status = String(
      req.query.status || "",
    ).trim();

    const offset = (page - 1) * limit;

    try {
      let query = supabaseAdmin
        .from("activity_logs")
        .select(
          "id, category, action, status, description, response_status, browser, operating_system, device_type, created_at",
          {
            count: "exact",
          },
        )
        .or(
          `user_id.eq.${targetUserId},actor_user_id.eq.${targetUserId},target_user_id.eq.${targetUserId}`,
        )
        .order("created_at", {
          ascending: false,
        })
        .range(
          offset,
          offset + limit - 1,
        );

      if (category) {
        query = query.eq(
          "category",
          category,
        );
      }

      if (status) {
        query = query.eq(
          "status",
          status,
        );
      }

      const {
        data,
        count,
        error,
      } = await query;

      if (error) {
        throw error;
      }

      return res.json({
        logs: (data || []).map(
          (log) => ({
            id: log.id,
            category: log.category,
            action: log.action,
            status: log.status,
            description:
              log.description,
            responseStatus:
              log.response_status,
            browser: log.browser,
            operatingSystem:
              log.operating_system,
            deviceType:
              log.device_type,
            createdAt:
              log.created_at,
          }),
        ),
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.max(
            1,
            Math.ceil(
              (count || 0) / limit,
            ),
          ),
        },
      });
    } catch (error) {
      console.error(
        "User activity load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "That user's activity could not be loaded.",
      });
    }
  },
);

app.get(
  "/api/admin/users/:userId/ai-chats",
  requireRole("owner"),
  async (req, res) => {
    const targetUserId = String(
      req.params.userId || "",
    );

    const page = clampInteger(
      req.query.page,
      1,
      1,
      100000,
    );

    const limit = clampInteger(
      req.query.limit,
      20,
      1,
      100,
    );

    const offset = (page - 1) * limit;

    try {
      const {
        data: chats,
        count,
        error: chatsError,
      } = await supabaseAdmin
        .from("ai_chats")
        .select(
          "id, title, created_at, updated_at",
          {
            count: "exact",
          },
        )
        .eq("user_id", targetUserId)
        .order("updated_at", {
          ascending: false,
        })
        .range(
          offset,
          offset + limit - 1,
        );

      if (chatsError) {
        throw chatsError;
      }

      const chatRows = chats || [];
      const chatIds = chatRows.map(
        (chat) => chat.id,
      );

      let messages = [];

      if (chatIds.length > 0) {
        const {
          data: messageRows,
          error: messagesError,
        } = await supabaseAdmin
          .from("ai_messages")
          .select(
            "id, chat_id, role, content, has_image, created_at",
          )
          .in("chat_id", chatIds)
          .order("created_at", {
            ascending: true,
          });

        if (messagesError) {
          throw messagesError;
        }

        messages = messageRows || [];
      }

      const messagesByChat = new Map();

      for (const message of messages) {
        if (
          !messagesByChat.has(
            message.chat_id,
          )
        ) {
          messagesByChat.set(
            message.chat_id,
            [],
          );
        }

        messagesByChat
          .get(message.chat_id)
          .push(message);
      }

      return res.json({
        chats: chatRows.map((chat) => {
          const chatMessages =
            messagesByChat.get(chat.id) ||
            [];
          const lastMessage =
            chatMessages.at(-1) || null;

          return {
            id: chat.id,
            title: chat.title,
            createdAt:
              chat.created_at,
            updatedAt:
              chat.updated_at,
            messageCount:
              chatMessages.length,
            lastMessagePreview:
              lastMessage?.content
                ? String(
                    lastMessage.content,
                  )
                    .replace(/\s+/g, " ")
                    .slice(0, 180)
                : null,
            hadImage:
              chatMessages.some(
                (message) =>
                  message.has_image ===
                  true,
              ),
          };
        }),
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.max(
            1,
            Math.ceil(
              (count || 0) / limit,
            ),
          ),
        },
      });
    } catch (error) {
      console.error(
        "User AI chats load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "That user's AI chats could not be loaded.",
      });
    }
  },
);

app.get(
  "/api/admin/users/:userId/proxy-history",
  requireRole("owner"),
  async (req, res) => {
    const targetUserId = String(
      req.params.userId || "",
    );

    const page = clampInteger(
      req.query.page,
      1,
      1,
      100000,
    );

    const limit = clampInteger(
      req.query.limit,
      50,
      1,
      200,
    );

    const search = String(
      req.query.search || "",
    )
      .trim()
      .slice(0, 100);

    const status = String(
      req.query.status || "",
    )
      .trim()
      .toLowerCase();

    const offset = (page - 1) * limit;

    try {
      let query = supabaseAdmin
        .from("activity_logs")
        .select(
          "id, action, status, response_status, duration_ms, proxy_query, proxy_target_url, proxy_target_domain, proxy_engine, created_at",
          {
            count: "exact",
          },
        )
        .eq("category", "proxy")
        .eq("user_id", targetUserId)
        .order("created_at", {
          ascending: false,
        })
        .range(
          offset,
          offset + limit - 1,
        );

      if (
        ["success", "failure"].includes(
          status,
        )
      ) {
        query = query.eq(
          "status",
          status,
        );
      }

      if (search) {
        const safeSearch = search
          .replace(/[%,()]/g, " ")
          .trim();

        query = query.or(
          `proxy_query.ilike.%${safeSearch}%,proxy_target_url.ilike.%${safeSearch}%,proxy_target_domain.ilike.%${safeSearch}%,proxy_engine.ilike.%${safeSearch}%`,
        );
      }

      const {
        data,
        count,
        error,
      } = await query;

      if (error) {
        throw error;
      }

      return res.json({
        logs: (data || []).map(
          (log) => ({
            id: log.id,
            action: log.action,
            status: log.status,
            responseStatus:
              log.response_status,
            durationMs:
              log.duration_ms,
            proxyQuery:
              log.proxy_query,
            proxyTargetUrl:
              log.proxy_target_url,
            proxyTargetDomain:
              log.proxy_target_domain,
            proxyEngine:
              log.proxy_engine,
            createdAt:
              log.created_at,
          }),
        ),
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.max(
            1,
            Math.ceil(
              (count || 0) / limit,
            ),
          ),
        },
      });
    } catch (error) {
      console.error(
        "User proxy history load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "That user's proxy history could not be loaded.",
      });
    }
  },
);

/* =======================================================
   ADMIN COMMAND SEARCH
======================================================= */

app.get(
  "/api/admin/search",
  requireRole("admin"),
  async (req, res) => {
    const query = String(
      req.query.q || "",
    )
      .trim()
      .slice(0, 80);

    const commands = [
      {
        id: "dashboard",
        title: "Open Dashboard",
        route: "dashboard",
        keywords:
          "home overview stats",
      },
      {
        id: "users",
        title: "Open Users",
        route: "users",
        keywords:
          "accounts roles bans",
      },
      {
        id: "activity",
        title: "Open Activity",
        route: "activity",
        keywords: "logs events audit",
      },
      {
        id: "limits",
        title: "Open Limits & Abuse",
        route: "limits",
        keywords:
          "usage rate limits suspension abuse cooldown",
      },
      {
        id: "invites",
        title: "Open Invite Codes",
        route: "invites",
        keywords:
          "signup codes generate",
      },
      {
        id: "announcements",
        title: "Open Announcements",
        route: "announcements",
        keywords:
          "notices banners messages scheduled",
      },
      {
        id: "ai",
        title: "Open AI Analytics",
        route: "ai",
        keywords:
          "messages chats tokens",
      },
      {
        id: "proxy",
        title: "Open Proxy Analytics",
        route: "proxy",
        keywords:
          "traffic domains bare",
      },
      {
        id: "analytics",
        title: "Open Analytics",
        route: "analytics",
        keywords:
          "charts growth trends",
      },
      {
        id: "exports",
        title: "Open Backups & Export",
        route: "exports",
        keywords:
          "backup download export csv json data",
      },
      {
        id: "settings",
        title: "Open Settings",
        route: "settings",
        keywords:
          "configuration maintenance",
      },
    ];

    if (!query) {
      return res.json({
        commands,
        users: [],
      });
    }

    try {
      const normalized =
        query.toLowerCase();

      const matchingCommands =
        commands.filter((command) =>
          `${command.title} ${command.keywords}`
            .toLowerCase()
            .includes(normalized),
        );

      const safeQuery = query
        .replaceAll("%", "")
        .replaceAll(",", " ");

      const { data: users, error } =
        await supabaseAdmin
          .from("profiles")
          .select(
            "id, username, role, banned",
          )
          .ilike(
            "username",
            `%${safeQuery}%`,
          )
          .limit(10);

      if (error) {
        throw error;
      }

      return res.json({
        commands: matchingCommands,
        users: users || [],
      });
    } catch (error) {
      console.error(
        "Admin search failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Control panel search failed.",
      });
    }
  },
);

/* =======================================================
   SAVED CHAT HELPERS
======================================================= */

async function getOwnedChat(chatId, userId) {
  const { data: chat, error } =
    await supabaseAdmin
      .from("ai_chats")
      .select(
        "id, user_id, title, created_at, updated_at",
      )
      .eq("id", chatId)
      .eq("user_id", userId)
      .maybeSingle();

  if (error) {
    throw error;
  }

  return chat;
}

/* =======================================================
   SAVED CHAT ROUTES
======================================================= */

app.get(
  "/api/ai/chats",
  requireApiAuth,
  async (req, res) => {
    try {
      const userId = req.auth.user.id;

      const { data: chats, error } =
        await supabaseAdmin
          .from("ai_chats")
          .select(
            "id, title, created_at, updated_at",
          )
          .eq("user_id", userId)
          .order("updated_at", {
            ascending: false,
          });

      if (error) {
        throw error;
      }

      return res.json({
        chats: chats || [],
      });
    } catch (error) {
      console.error(
        "Could not load AI chats:",
        error,
      );

      return res.status(500).json({
        error:
          "Your saved chats could not be loaded.",
      });
    }
  },
);

app.post(
  "/api/ai/chats",
  requireApiAuth,
  async (req, res) => {
    try {
      const userId = req.auth.user.id;

      const requestedTitle = String(
        req.body.title || "",
      )
        .trim()
        .slice(0, 80);

      const title =
        requestedTitle || "New chat";

      const { data: chat, error } =
        await supabaseAdmin
          .from("ai_chats")
          .insert({
            user_id: userId,
            title,
          })
          .select(
            "id, title, created_at, updated_at",
          )
          .single();

      if (error) {
        throw error;
      }

      invalidateAdminCache();

      void writeActivityLog({
        req,
        userId,
        category: "ai",
        action: "ai.chat_created",
        status: "success",
        description:
          "A new Fuzz AI chat was created.",
        resourceType: "ai_chat",
        resourceId: chat.id,
        chatId: chat.id,
        responseStatus: 201,
        newValues: {
          title: chat.title,
        },
      });

      return res.status(201).json({
        chat,
      });
    } catch (error) {
      console.error(
        "Could not create AI chat:",
        error,
      );

      return res.status(500).json({
        error:
          "A new chat could not be created.",
      });
    }
  },
);

app.get(
  "/api/ai/chats/:chatId",
  requireApiAuth,
  async (req, res) => {
    try {
      const userId = req.auth.user.id;
      const chatId = String(
        req.params.chatId || "",
      );

      const chat = await getOwnedChat(
        chatId,
        userId,
      );

      if (!chat) {
        return res.status(404).json({
          error:
            "That chat could not be found.",
        });
      }

      const {
        data: messages,
        error: messagesError,
      } = await supabaseAdmin
        .from("ai_messages")
        .select(
          "id, role, content, has_image, image_name, created_at",
        )
        .eq("chat_id", chatId)
        .eq("user_id", userId)
        .order("created_at", {
          ascending: true,
        });

      if (messagesError) {
        throw messagesError;
      }

      void writeActivityLog({
        req,
        userId,
        category: "ai",
        action: "ai.chat_opened",
        status: "informational",
        description:
          "A saved Fuzz AI chat was opened.",
        resourceType: "ai_chat",
        resourceId: chatId,
        chatId,
        responseStatus: 200,
        metadata: {
          title: chat.title,
          messageCount:
            messages?.length || 0,
        },
      });

      return res.json({
        chat,
        messages: messages || [],
      });
    } catch (error) {
      console.error(
        "Could not open AI chat:",
        error,
      );

      return res.status(500).json({
        error:
          "That conversation could not be loaded.",
      });
    }
  },
);

app.patch(
  "/api/ai/chats/:chatId",
  requireApiAuth,
  async (req, res) => {
    try {
      const userId = req.auth.user.id;
      const chatId = String(
        req.params.chatId || "",
      );

      const title = String(
        req.body.title || "",
      )
        .trim()
        .slice(0, 80);

      if (!title) {
        return res.status(400).json({
          error: "Enter a chat title.",
        });
      }

      const existingChat =
        await getOwnedChat(chatId, userId);

      if (!existingChat) {
        return res.status(404).json({
          error:
            "That chat could not be found.",
        });
      }

      const {
        data: updatedChat,
        error,
      } = await supabaseAdmin
        .from("ai_chats")
        .update({
          title,
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", chatId)
        .eq("user_id", userId)
        .select(
          "id, title, created_at, updated_at",
        )
        .single();

      if (error) {
        throw error;
      }

      invalidateAdminCache();

      void writeActivityLog({
        req,
        userId,
        category: "ai",
        action: "ai.chat_renamed",
        status: "success",
        description:
          "A Fuzz AI chat was renamed.",
        resourceType: "ai_chat",
        resourceId: chatId,
        chatId,
        responseStatus: 200,
        oldValues: {
          title: existingChat.title,
        },
        newValues: {
          title,
        },
      });

      return res.json({
        chat: updatedChat,
      });
    } catch (error) {
      console.error(
        "Could not rename AI chat:",
        error,
      );

      return res.status(500).json({
        error:
          "That chat could not be renamed.",
      });
    }
  },
);

app.delete(
  "/api/ai/chats/:chatId",
  requireApiAuth,
  async (req, res) => {
    try {
      const userId = req.auth.user.id;
      const chatId = String(
        req.params.chatId || "",
      );

      const existingChat =
        await getOwnedChat(chatId, userId);

      if (!existingChat) {
        return res.status(404).json({
          error:
            "That chat could not be found.",
        });
      }

      const deletedChatTitle =
        existingChat.title;

      const { error } = await supabaseAdmin
        .from("ai_chats")
        .delete()
        .eq("id", chatId)
        .eq("user_id", userId);

      if (error) {
        throw error;
      }

      invalidateAdminCache();

      void writeActivityLog({
        req,
        userId,
        category: "ai",
        action: "ai.chat_deleted",
        status: "success",
        description:
          "A Fuzz AI chat was deleted.",
        resourceType: "ai_chat",
        resourceId: chatId,
        responseStatus: 200,
        oldValues: {
          title: deletedChatTitle,
        },
      });

      return res.json({
        success: true,
      });
    } catch (error) {
      console.error(
        "Could not delete AI chat:",
        error,
      );

      return res.status(500).json({
        error:
          "That chat could not be deleted.",
      });
    }
  },
);

app.post(
  "/api/ai/chats/:chatId/messages",
  requireApiAuth,
  async (req, res) => {
    try {
      const userId = req.auth.user.id;
      const chatId = String(
        req.params.chatId || "",
      );

      const role = String(
        req.body.role || "",
      );

      const content = String(
        req.body.content || "",
      )
        .trim()
        .slice(0, 30000);

      const hasImage =
        req.body.hasImage === true;

      const imageName = hasImage
        ? String(
            req.body.imageName || "",
          )
            .trim()
            .slice(0, 255) || null
        : null;

      if (
        !["user", "assistant"].includes(
          role,
        )
      ) {
        return res.status(400).json({
          error: "Invalid message role.",
        });
      }

      if (!content) {
        return res.status(400).json({
          error:
            "The message cannot be empty.",
        });
      }

      const chat = await getOwnedChat(
        chatId,
        userId,
      );

      if (!chat) {
        return res.status(404).json({
          error:
            "That chat could not be found.",
        });
      }

      const {
        data: message,
        error: messageError,
      } = await supabaseAdmin
        .from("ai_messages")
        .insert({
          chat_id: chatId,
          user_id: userId,
          role,
          content,
          has_image: hasImage,
          image_name: imageName,
        })
        .select(
          "id, role, content, has_image, image_name, created_at",
        )
        .single();

      if (messageError) {
        throw messageError;
      }

      const { error: updateError } =
        await supabaseAdmin
          .from("ai_chats")
          .update({
            updated_at:
              new Date().toISOString(),
          })
          .eq("id", chatId)
          .eq("user_id", userId);

      if (updateError) {
        console.error(
          "Could not update chat timestamp:",
          updateError,
        );
      }

      invalidateAdminCache();

      void writeActivityLog({
        req,
        userId,
        category: "ai",
        action:
          role === "user"
            ? "ai.user_message_saved"
            : "ai.assistant_message_saved",
        status: "success",
        description:
          `${role} message saved in a Fuzz AI chat.`,
        resourceType: "ai_message",
        resourceId: String(message.id),
        chatId,
        messageId: message.id,
        messageRole: role,
        messageLength: content.length,
        promptPreview:
          role === "user"
            ? content
            : null,
        hadImage: hasImage,
        imageName,
        responseStatus: 201,
        metadata: {
          chatId,
        },
      });

      return res.status(201).json({
        message,
      });
    } catch (error) {
      console.error(
        "Could not save AI message:",
        error,
      );

      return res.status(500).json({
        error:
          "The message could not be saved.",
      });
    }
  },
);

/* =======================================================
   FUZZ AI STREAMING
======================================================= */

app.post(
  "/api/ai/chat",
  requireApiAuth,
  async (req, res) => {
    const aiRequestStartedAt = Date.now();

    const messages = Array.isArray(
      req.body.messages,
    )
      ? req.body.messages
      : [];

    if (messages.length === 0) {
      return res.status(400).json({
        error:
          "Send at least one message.",
      });
    }

    if (messages.length > 30) {
      return res.status(400).json({
        error:
          "This conversation is too long. Start a new chat.",
      });
    }

    const cleanedMessages = [];

    const requestingUserId =
      req.auth.user.id;

    const finalUserMessage =
      [...messages]
        .reverse()
        .find(
          (message) =>
            message?.role === "user",
        );

    const finalPromptPreview =
      typeof finalUserMessage?.content ===
      "string"
        ? finalUserMessage.content
        : "";

    const requestHadImage =
      Boolean(
        finalUserMessage?.image?.dataUrl,
      );

    const usageAllowed =
      await enforceUsageLimit(
        req,
        res,
        {
          aiMessages: 1,
          aiImages:
            requestHadImage ? 1 : 0,
        },
      );

    if (usageAllowed !== true) {
      return;
    }

    for (const message of messages) {
      if (
        !message ||
        !["user", "assistant"].includes(
          message.role,
        ) ||
        typeof message.content !== "string"
      ) {
        continue;
      }

      const text = message.content
        .trim()
        .slice(0, 12000);

      if (!text) {
        continue;
      }

      if (message.role === "assistant") {
        cleanedMessages.push({
          role: "assistant",
          content: text,
        });

        continue;
      }

      const content = [
        {
          type: "input_text",
          text,
        },
      ];

      if (message.image?.dataUrl) {
        const imageUrl = String(
          message.image.dataUrl,
        );

        if (
          imageUrl.length > 12_000_000 ||
          !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(
            imageUrl,
          )
        ) {
          return res.status(400).json({
            error:
              "The attached image is invalid or too large.",
          });
        }

        content.push({
          type: "input_image",
          image_url: imageUrl,
          detail: "auto",
        });
      }

      cleanedMessages.push({
        role: "user",
        content,
      });
    }

    if (cleanedMessages.length === 0) {
      return res.status(400).json({
        error:
          "No valid messages were provided.",
      });
    }

    res.status(200);

    res.setHeader(
      "Content-Type",
      "text/plain; charset=utf-8",
    );

    res.setHeader(
      "Cache-Control",
      "no-cache, no-transform",
    );

    res.setHeader(
      "X-Content-Type-Options",
      "nosniff",
    );

    try {
      let accountAiBehavior =
        ACCOUNT_CENTER_DEFAULTS.aiBehavior;

      try {
        const accountPreferences =
          await getAccountCenterPreferences(
            requestingUserId,
          );

        accountAiBehavior =
          accountPreferences.aiBehavior;
      } catch (preferenceError) {
        console.error(
          "AI preference lookup failed:",
          preferenceError,
        );
      }

      const stream =
        await openai.responses.create({
          model: "gpt-5-mini",
          instructions:
            `You are Fuzz AI, the helpful AI assistant built into FuzzTheHuzz. Give clear, accurate, natural answers. Analyze attached images when provided. Use markdown when helpful. ${accountCenterAiInstruction(accountAiBehavior)}`,
          input: cleanedMessages,
          max_output_tokens: 2000,
          store: false,
          stream: true,
        });

      void writeActivityLog({
        req,
        userId: requestingUserId,
        category: "ai",
        action: "ai.response_started",
        status: "informational",
        description:
          "Fuzz AI started generating a response.",
        aiModel: "gpt-5-mini",
        messageRole: "user",
        messageLength:
          finalPromptPreview.length,
        promptPreview:
          finalPromptPreview,
        hadImage:
          requestHadImage,
        responseStatus: 200,
      });

      let streamedOutputLength = 0;

      for await (const event of stream) {
        if (
          event.type ===
          "response.output_text.delta"
        ) {
          streamedOutputLength +=
            String(event.delta || "").length;

          res.write(event.delta);
        }

        if (
          event.type ===
          "response.failed"
        ) {
          console.error(
            "OpenAI response failed:",
            event.response?.error,
          );
        }
      }

      void writeActivityLog({
        req,
        userId: requestingUserId,
        category: "ai",
        action: "ai.response_completed",
        status: "success",
        description:
          "Fuzz AI completed a response.",
        aiModel: "gpt-5-mini",
        messageRole: "user",
        messageLength:
          finalPromptPreview.length,
        promptPreview:
          finalPromptPreview,
        hadImage:
          requestHadImage,
        outputLength:
          streamedOutputLength,
        durationMs:
          Date.now() - aiRequestStartedAt,
        responseStatus: 200,
      });

      return res.end();
    } catch (error) {
      void writeActivityLog({
        req,
        userId: requestingUserId,
        category: "ai",
        action: "ai.response_failed",
        status: "failure",
        description:
          "Fuzz AI failed to complete a response.",
        aiModel: "gpt-5-mini",
        messageLength:
          finalPromptPreview.length,
        promptPreview:
          finalPromptPreview,
        hadImage:
          requestHadImage,
        durationMs:
          Date.now() - aiRequestStartedAt,
        responseStatus: 500,
        metadata: {
          error:
            error?.message ||
            "Unknown AI error",
        },
      });

      console.error(
        "Fuzz AI request failed:",
        error,
      );

      if (!res.headersSent) {
        return res.status(500).json({
          error:
            "Fuzz AI could not generate a response.",
        });
      }

      res.write(
        "\n\nFuzz AI could not finish the response.",
      );

      return res.end();
    }
  },
);

/* =======================================================
   REMOTE ASSET CACHE
======================================================= */

app.get("/e/*", async (req, res, next) => {
  try {
    const existing = cache.get(req.path);

    if (existing) {
      if (
        Date.now() - existing.timestamp <=
        CACHE_TTL
      ) {
        res.writeHead(200, {
          "Content-Type":
            existing.contentType,
        });

        return res.end(existing.data);
      }

      cache.delete(req.path);
    }

    const baseUrls = {
      "/e/1/":
        "https://raw.githubusercontent.com/qrs/x/fixy/",
      "/e/2/":
        "https://raw.githubusercontent.com/3v1/V5-Assets/main/",
      "/e/3/":
        "https://raw.githubusercontent.com/3v1/V5-Retro/master/",
    };

    let reqTarget = null;

    for (const [prefix, baseUrl] of
      Object.entries(baseUrls)) {
      if (req.path.startsWith(prefix)) {
        reqTarget =
          baseUrl +
          req.path.slice(prefix.length);

        break;
      }
    }

    if (!reqTarget) {
      return next();
    }

    const asset = await fetch(reqTarget);

    if (!asset.ok) {
      return next();
    }

    const data = Buffer.from(
      await asset.arrayBuffer(),
    );

    const extension =
      path.extname(reqTarget);

    const contentType =
      extension === ".unityweb"
        ? "application/octet-stream"
        : mime.getType(extension) ||
          "application/octet-stream";

    cache.set(req.path, {
      data,
      contentType,
      timestamp: Date.now(),
    });

    res.writeHead(200, {
      "Content-Type": contentType,
    });

    return res.end(data);
  } catch (error) {
    console.error(
      "Remote asset error:",
      error,
    );

    return res
      .status(500)
      .send("Error fetching the asset.");
  }
});

/* =======================================================
   FUZZ SECURITY CENTER ROUTES
======================================================= */

app.post(
  "/api/auth/security/heartbeat",
  requireApiAuth,
  async (req, res) => {
    try {
      const session =
        await touchSecuritySession(
          req,
          res,
          req.auth.user,
          req.auth.profile,
        );

      if (!session) {
        clearAuthCookies(req, res);
        clearSecurityCookie(req, res);

        return res.status(401).json({
          error:
            "This login session has been revoked.",
        });
      }

      return res.json({
        success: true,
        session: serializeSecuritySession(
          session,
          {
            username:
              req.auth.profile.username,
            currentSessionHash:
              getSecuritySessionHash(req),
          },
        ),
      });
    } catch (error) {
      console.error(
        "Security heartbeat failed:",
        error,
      );

      return res.status(500).json({
        error:
          "The security heartbeat could not be recorded.",
      });
    }
  },
);

app.get(
  "/api/admin/notifications",
  requireRole("owner"),
  async (req, res) => {
    const page = clampInteger(
      req.query.page,
      1,
      1,
      100000,
    );
    const limit = clampInteger(
      req.query.limit,
      40,
      1,
      100,
    );
    const filter = String(
      req.query.filter || "open",
    ).toLowerCase();
    const severity = String(
      req.query.severity || "",
    ).toLowerCase();
    const offset = (page - 1) * limit;

    try {
      let query = supabaseAdmin
        .from("admin_notifications")
        .select("*", {
          count: "exact",
        })
        .order("last_occurred_at", {
          ascending: false,
        })
        .range(
          offset,
          offset + limit - 1,
        );

      if (filter !== "all") {
        query = query.is(
          "resolved_at",
          null,
        );
      }

      if (
        ["info", "warning", "critical"].includes(
          severity,
        )
      ) {
        query = query.eq(
          "severity",
          severity,
        );
      }

      const {
        data: notificationRows,
        count,
        error,
      } = await query;

      if (error) {
        throw error;
      }

      const notifications =
        notificationRows || [];
      const notificationIds =
        notifications.map(
          (item) => item.id,
        );

      let states = [];

      if (notificationIds.length > 0) {
        const { data, error: statesError } =
          await supabaseAdmin
            .from("admin_notification_states")
            .select("*")
            .eq(
              "admin_user_id",
              req.auth.user.id,
            )
            .in(
              "notification_id",
              notificationIds,
            );

        if (statesError) {
          throw statesError;
        }

        states = data || [];
      }

      const stateMap = new Map(
        states.map((state) => [
          state.notification_id,
          state,
        ]),
      );

      const targetProfileMap =
        await getProfilesByIds(
          notifications.map(
            (item) =>
              item.target_user_id,
          ),
        );

      let unreadQuery = supabaseAdmin
        .from("admin_notifications")
        .select("id")
        .is("resolved_at", null)
        .order("last_occurred_at", {
          ascending: false,
        })
        .limit(500);

      const {
        data: openNotifications,
        error: openError,
      } = await unreadQuery;

      if (openError) {
        throw openError;
      }

      const openIds = (
        openNotifications || []
      ).map((item) => item.id);
      let readOpenIds = new Set();

      if (openIds.length > 0) {
        const { data, error: readError } =
          await supabaseAdmin
            .from("admin_notification_states")
            .select("notification_id")
            .eq(
              "admin_user_id",
              req.auth.user.id,
            )
            .not("read_at", "is", null)
            .in(
              "notification_id",
              openIds,
            );

        if (readError) {
          throw readError;
        }

        readOpenIds = new Set(
          (data || []).map(
            (state) =>
              state.notification_id,
          ),
        );
      }

      let serialized = notifications
        .map((item) => {
          const state =
            stateMap.get(item.id) || {};

          return {
            id: item.id,
            notificationType:
              item.notification_type,
            severity: item.severity,
            title: item.title,
            message: item.message,
            targetUserId:
              item.target_user_id,
            targetUsername:
              targetProfileMap.get(
                item.target_user_id,
              )?.username || null,
            resourceType:
              item.resource_type,
            resourceId:
              item.resource_id,
            occurrenceCount:
              item.occurrence_count,
            metadata:
              item.metadata || {},
            readAt:
              state.read_at || null,
            dismissedAt:
              state.dismissed_at || null,
            createdAt:
              item.created_at,
            lastOccurredAt:
              item.last_occurred_at,
            resolvedAt:
              item.resolved_at,
          };
        })
        .filter(
          (item) => !item.dismissedAt,
        );

      if (filter === "unread") {
        serialized = serialized.filter(
          (item) => !item.readAt,
        );
      }

      return res.json({
        notifications: serialized,
        unreadCount:
          openIds.filter(
            (id) =>
              !readOpenIds.has(id),
          ).length,
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.max(
            1,
            Math.ceil(
              (count || 0) / limit,
            ),
          ),
        },
      });
    } catch (error) {
      console.error(
        "Notifications load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Notifications could not be loaded.",
      });
    }
  },
);

app.patch(
  "/api/admin/notifications/:notificationId/read",
  requireRole("owner"),
  async (req, res) => {
    const notificationId = String(
      req.params.notificationId || "",
    );

    try {
      const now = new Date().toISOString();
      const { error } = await supabaseAdmin
        .from("admin_notification_states")
        .upsert(
          {
            notification_id:
              notificationId,
            admin_user_id:
              req.auth.user.id,
            read_at: now,
            updated_at: now,
          },
          {
            onConflict:
              "notification_id,admin_user_id",
          },
        );

      if (error) {
        throw error;
      }

      return res.json({
        success: true,
      });
    } catch (error) {
      return res.status(500).json({
        error:
          "The notification could not be marked as read.",
      });
    }
  },
);

app.patch(
  "/api/admin/notifications/:notificationId/dismiss",
  requireRole("owner"),
  async (req, res) => {
    const notificationId = String(
      req.params.notificationId || "",
    );

    try {
      const now = new Date().toISOString();
      const { error } = await supabaseAdmin
        .from("admin_notification_states")
        .upsert(
          {
            notification_id:
              notificationId,
            admin_user_id:
              req.auth.user.id,
            read_at: now,
            dismissed_at: now,
            updated_at: now,
          },
          {
            onConflict:
              "notification_id,admin_user_id",
          },
        );

      if (error) {
        throw error;
      }

      return res.json({
        success: true,
      });
    } catch (error) {
      return res.status(500).json({
        error:
          "The notification could not be dismissed.",
      });
    }
  },
);

app.post(
  "/api/admin/notifications/read-all",
  requireRole("owner"),
  async (req, res) => {
    try {
      const { data, error } =
        await supabaseAdmin
          .from("admin_notifications")
          .select("id")
          .is("resolved_at", null)
          .limit(1000);

      if (error) {
        throw error;
      }

      const now = new Date().toISOString();
      const rows = (data || []).map(
        (item) => ({
          notification_id: item.id,
          admin_user_id:
            req.auth.user.id,
          read_at: now,
          updated_at: now,
        }),
      );

      if (rows.length > 0) {
        const { error: upsertError } =
          await supabaseAdmin
            .from("admin_notification_states")
            .upsert(rows, {
              onConflict:
                "notification_id,admin_user_id",
            });

        if (upsertError) {
          throw upsertError;
        }
      }

      return res.json({
        success: true,
        markedRead: rows.length,
      });
    } catch (error) {
      return res.status(500).json({
        error:
          "Notifications could not be marked as read.",
      });
    }
  },
);

app.get(
  "/api/admin/security/overview",
  requireRole("owner"),
  async (_req, res) => {
    try {
      const activeAfter = new Date(
        Date.now() -
          SECURITY_ACTIVE_WINDOW_MS,
      ).toISOString();
      const now = new Date().toISOString();
      const dayAgo = new Date(
        Date.now() -
          24 * 60 * 60 * 1000,
      ).toISOString();

      const [
        activeResult,
        revokedResult,
        newDeviceResult,
      ] = await Promise.all([
        supabaseAdmin
          .from("user_security_sessions")
          .select(
            "user_id, device_hash",
          )
          .is("revoked_at", null)
          .gte(
            "last_seen_at",
            activeAfter,
          )
          .gt("expires_at", now)
          .limit(10000),
        supabaseAdmin
          .from("user_security_sessions")
          .select("id", {
            count: "exact",
            head: true,
          })
          .not("revoked_at", "is", null),
        supabaseAdmin
          .from("user_security_sessions")
          .select("id", {
            count: "exact",
            head: true,
          })
          .gte("first_seen_at", dayAgo),
      ]);

      for (const result of [
        activeResult,
        revokedResult,
        newDeviceResult,
      ]) {
        if (result.error) {
          throw result.error;
        }
      }

      const activeRows =
        activeResult.data || [];
      const users = new Map();

      for (const row of activeRows) {
        if (!users.has(row.user_id)) {
          users.set(
            row.user_id,
            new Set(),
          );
        }

        users
          .get(row.user_id)
          .add(row.device_hash);
      }

      return res.json({
        activeSessions:
          activeRows.length,
        activeUsers: users.size,
        multipleDeviceAccounts:
          [...users.values()].filter(
            (devices) =>
              devices.size >= 2,
          ).length,
        revokedSessions:
          revokedResult.count || 0,
        newDevices24h:
          newDeviceResult.count || 0,
      });
    } catch (error) {
      console.error(
        "Security overview failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Security statistics could not be loaded.",
      });
    }
  },
);

app.get(
  "/api/admin/security/sessions",
  requireRole("owner"),
  async (req, res) => {
    const page = clampInteger(
      req.query.page,
      1,
      1,
      100000,
    );
    const limit = clampInteger(
      req.query.limit,
      50,
      1,
      200,
    );
    const search = String(
      req.query.search || "",
    )
      .trim()
      .slice(0, 100);
    const status = String(
      req.query.status || "active",
    ).toLowerCase();
    const offset = (page - 1) * limit;

    try {
      let profileIds = [];

      if (search) {
        const safeSearch = search
          .replace(/[%,()]/g, " ")
          .trim();
        const { data, error } =
          await supabaseAdmin
            .from("profiles")
            .select("id")
            .ilike(
              "username",
              `%${safeSearch}%`,
            )
            .limit(100);

        if (error) {
          throw error;
        }

        profileIds = (data || []).map(
          (profile) => profile.id,
        );
      }

      let query = supabaseAdmin
        .from("user_security_sessions")
        .select("*", {
          count: "exact",
        })
        .order("last_seen_at", {
          ascending: false,
        })
        .range(
          offset,
          offset + limit - 1,
        );

      const now = new Date();
      const activeAfter = new Date(
        now.getTime() -
          SECURITY_ACTIVE_WINDOW_MS,
      ).toISOString();

      if (status === "active") {
        query = query
          .is("revoked_at", null)
          .gte(
            "last_seen_at",
            activeAfter,
          )
          .gt(
            "expires_at",
            now.toISOString(),
          );
      } else if (status === "revoked") {
        query = query.not(
          "revoked_at",
          "is",
          null,
        );
      } else if (status === "expired") {
        query = query
          .is("revoked_at", null)
          .or(
            `last_seen_at.lt.${activeAfter},expires_at.lte.${now.toISOString()}`,
          );
      }

      if (search) {
        const safeSearch = search
          .replace(/[%,()]/g, " ")
          .trim();
        const filters = [
          `browser.ilike.%${safeSearch}%`,
          `operating_system.ilike.%${safeSearch}%`,
          `device_type.ilike.%${safeSearch}%`,
          `ip_address.ilike.%${safeSearch}%`,
        ];

        if (profileIds.length > 0) {
          filters.push(
            `user_id.in.(${profileIds.join(",")})`,
          );
        }

        query = query.or(
          filters.join(","),
        );
      }

      const {
        data,
        count,
        error,
      } = await query;

      if (error) {
        throw error;
      }

      const rows = data || [];
      const profileMap =
        await getProfilesByIds(
          rows.map((row) => row.user_id),
        );
      const activeRows =
        await getRecentSecuritySessionsForUsers(
          rows.map((row) => row.user_id),
        );
      const activeDeviceCounts =
        buildActiveDeviceCounts(
          activeRows,
        );

      return res.json({
        sessions: rows.map((row) =>
          serializeSecuritySession(row, {
            username:
              profileMap.get(row.user_id)
                ?.username || "Unknown",
            multipleDeviceActive:
              (activeDeviceCounts.get(
                row.user_id,
              ) || 0) >= 2,
          }),
        ),
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.max(
            1,
            Math.ceil(
              (count || 0) / limit,
            ),
          ),
        },
      });
    } catch (error) {
      console.error(
        "Security sessions load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Security sessions could not be loaded.",
      });
    }
  },
);

async function getRecentSecuritySessionsForUsers(
  userIds,
) {
  const ids = [
    ...new Set(
      (userIds || []).filter(Boolean),
    ),
  ];

  if (ids.length === 0) {
    return [];
  }

  const activeAfter = new Date(
    Date.now() -
      SECURITY_ACTIVE_WINDOW_MS,
  ).toISOString();

  const { data, error } = await supabaseAdmin
    .from("user_security_sessions")
    .select("user_id, device_hash")
    .in("user_id", ids)
    .is("revoked_at", null)
    .gte("last_seen_at", activeAfter)
    .gt(
      "expires_at",
      new Date().toISOString(),
    );

  if (error) {
    throw error;
  }

  return data || [];
}

function buildActiveDeviceCounts(rows) {
  const map = new Map();

  for (const row of rows || []) {
    if (!map.has(row.user_id)) {
      map.set(
        row.user_id,
        new Set(),
      );
    }

    map
      .get(row.user_id)
      .add(row.device_hash);
  }

  return new Map(
    [...map.entries()].map(
      ([userId, devices]) => [
        userId,
        devices.size,
      ],
    ),
  );
}

app.get(
  "/api/admin/security/users/:userId/sessions",
  requireRole("owner"),
  async (req, res) => {
    const userId = String(
      req.params.userId || "",
    );

    try {
      const { data, error } =
        await supabaseAdmin
          .from("user_security_sessions")
          .select("*")
          .eq("user_id", userId)
          .order("last_seen_at", {
            ascending: false,
          })
          .limit(200);

      if (error) {
        throw error;
      }

      const rows = data || [];
      const activeRows = rows.filter(
        (row) =>
          serializeSecuritySession(row)
            .active,
      );
      const activeDevices = new Set(
        activeRows.map(
          (row) => row.device_hash,
        ),
      );

      return res.json({
        sessions: rows.map((row) =>
          serializeSecuritySession(row, {
            currentSessionHash:
              getSecuritySessionHash(req),
            multipleDeviceActive:
              activeDevices.size >= 2,
          }),
        ),
        summary: {
          activeSessions:
            activeRows.length,
          knownDevices:
            new Set(
              rows.map(
                (row) => row.device_hash,
              ),
            ).size,
          knownIps:
            new Set(
              rows
                .map(
                  (row) => row.ip_address,
                )
                .filter(Boolean),
            ).size,
          revokedSessions:
            rows.filter(
              (row) => row.revoked_at,
            ).length,
        },
      });
    } catch (error) {
      return res.status(500).json({
        error:
          "This user's security sessions could not be loaded.",
      });
    }
  },
);

app.post(
  "/api/admin/security/sessions/:sessionId/revoke",
  requireRole("owner"),
  async (req, res) => {
    const sessionId = String(
      req.params.sessionId || "",
    );
    const reason = String(
      req.body.reason ||
        "Revoked by owner",
    )
      .trim()
      .slice(0, 200);

    try {
      const { data: existing, error } =
        await supabaseAdmin
          .from("user_security_sessions")
          .select("*")
          .eq("id", sessionId)
          .maybeSingle();

      if (error) {
        throw error;
      }

      if (!existing) {
        return res.status(404).json({
          error:
            "That security session was not found.",
        });
      }

      const { data, error: updateError } =
        await supabaseAdmin
          .from("user_security_sessions")
          .update({
            revoked_at:
              new Date().toISOString(),
            revoke_reason: reason,
          })
          .eq("id", sessionId)
          .select("*")
          .single();

      if (updateError) {
        throw updateError;
      }

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId:
          req.auth.user.id,
        targetUserId:
          existing.user_id,
        category: "security",
        action:
          "account.session_revoked",
        status: "success",
        description:
          `${req.auth.profile.username} revoked a login session.`,
        resourceType:
          "security_session",
        resourceId: sessionId,
        responseStatus: 200,
        metadata: {
          reason,
          browser:
            existing.browser,
          operatingSystem:
            existing.operating_system,
          ipAddress:
            existing.ip_address,
        },
      });

      return res.json({
        success: true,
        session:
          serializeSecuritySession(data),
      });
    } catch (error) {
      return res.status(500).json({
        error:
          "The security session could not be revoked.",
      });
    }
  },
);

app.post(
  "/api/admin/security/users/:userId/revoke-all",
  requireRole("owner"),
  async (req, res) => {
    const userId = String(
      req.params.userId || "",
    );
    const exceptCurrent =
      req.body.exceptCurrent === true;

    try {
      let query = supabaseAdmin
        .from("user_security_sessions")
        .update({
          revoked_at:
            new Date().toISOString(),
          revoke_reason:
            "All sessions revoked by owner",
        })
        .eq("user_id", userId)
        .is("revoked_at", null);

      const currentHash =
        getSecuritySessionHash(req);

      if (
        exceptCurrent &&
        currentHash
      ) {
        query = query.neq(
          "session_token_hash",
          currentHash,
        );
      }

      const { data, error } = await query
        .select("id");

      if (error) {
        throw error;
      }

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId:
          req.auth.user.id,
        targetUserId: userId,
        category: "security",
        action:
          "account.all_sessions_revoked",
        status: "success",
        description:
          `${req.auth.profile.username} revoked all tracked login sessions for an account.`,
        resourceType: "user",
        resourceId: userId,
        responseStatus: 200,
        metadata: {
          revokedCount:
            data?.length || 0,
          exceptCurrent,
        },
      });

      return res.json({
        success: true,
        revokedCount:
          data?.length || 0,
      });
    } catch (error) {
      return res.status(500).json({
        error:
          "The user's login sessions could not be revoked.",
      });
    }
  },
);

/* =======================================================
   FUZZ SUSPENSIONS + USAGE LIMITS ROUTES
======================================================= */

app.get(
  "/api/auth/suspension",
  async (req, res) => {
    try {
      const auth =
        await getAuthenticatedUser(req, res);

      if (!auth) {
        return res.status(401).json({
          error:
            "You must be signed in.",
        });
      }

      return res.json({
        suspended:
          auth.suspension?.active === true,
        suspension:
          auth.suspension || null,
        user: {
          id: auth.user.id,
          username:
            auth.profile.username,
        },
      });
    } catch (error) {
      console.error(
        "Suspension status load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Your account status could not be loaded.",
      });
    }
  },
);

app.patch(
  "/api/admin/users/:userId/suspension",
  requireRole("admin"),
  async (req, res) => {
    const targetUserId = String(
      req.params.userId || "",
    );

    const requestedUntil =
      req.body.suspendedUntil === null
        ? null
        : String(
            req.body.suspendedUntil || "",
          ).trim();

    const reason = String(
      req.body.reason || "",
    )
      .trim()
      .slice(0, 500);

    try {
      const actor = req.auth;

      const {
        data: targetProfile,
        error: targetError,
      } = await supabaseAdmin
        .from("profiles")
        .select(
          "id, username, role, banned, suspended_until, suspension_reason, suspension_source",
        )
        .eq("id", targetUserId)
        .maybeSingle();

      if (targetError) {
        throw targetError;
      }

      if (!targetProfile) {
        return res.status(404).json({
          error:
            "That account was not found.",
        });
      }

      if (
        targetUserId === actor.user.id
      ) {
        return res.status(400).json({
          error:
            "You cannot suspend your own account.",
        });
      }

      if (targetProfile.role === "owner") {
        return res.status(403).json({
          error:
            "Owner accounts cannot be suspended here.",
        });
      }

      if (
        actor.profile.role === "admin" &&
        ["admin", "owner"].includes(
          targetProfile.role,
        )
      ) {
        return res.status(403).json({
          error:
            "Admins cannot suspend other admins or owners.",
        });
      }

      let suspendedUntil = null;

      if (requestedUntil) {
        const parsed = new Date(
          requestedUntil,
        );

        if (
          !Number.isFinite(
            parsed.getTime(),
          )
        ) {
          return res.status(400).json({
            error:
              "Choose a valid suspension expiration time.",
          });
        }

        const minimum =
          Date.now() + 5 * 60 * 1000;
        const maximum =
          Date.now() +
          365 * 24 * 60 * 60 * 1000;

        if (
          parsed.getTime() < minimum ||
          parsed.getTime() > maximum
        ) {
          return res.status(400).json({
            error:
              "Suspensions must last between 5 minutes and 1 year.",
          });
        }

        suspendedUntil =
          parsed.toISOString();

        if (!reason) {
          return res.status(400).json({
            error:
              "Enter a reason for the suspension.",
          });
        }
      }

      const oldState =
        getSuspensionState(
          targetProfile,
        );

      const now =
        new Date().toISOString();

      const update = suspendedUntil
        ? {
            suspended_until:
              suspendedUntil,
            suspension_reason: reason,
            suspended_at: now,
            suspended_by:
              actor.user.id,
            suspension_source:
              "manual_admin",
            updated_at: now,
          }
        : {
            suspended_until: null,
            suspension_reason: null,
            suspended_at: null,
            suspended_by: null,
            suspension_source: null,
            updated_at: now,
          };

      const {
        data: updatedProfile,
        error: updateError,
      } = await supabaseAdmin
        .from("profiles")
        .update(update)
        .eq("id", targetUserId)
        .select(
          "id, username, role, banned, suspended_until, suspension_reason, suspended_at, suspended_by, suspension_source, updated_at",
        )
        .single();

      if (updateError) {
        throw updateError;
      }

      invalidateAdminCache();

      const nextState =
        getSuspensionState(
          updatedProfile,
        );

      void writeActivityLog({
        req,
        userId: actor.user.id,
        actorUserId: actor.user.id,
        targetUserId,
        category: "security",
        action: suspendedUntil
          ? "admin.user_suspended"
          : "admin.user_unsuspended",
        status: "success",
        description: suspendedUntil
          ? `${actor.profile.username} suspended ${targetProfile.username} until ${suspendedUntil}.`
          : `${actor.profile.username} removed ${targetProfile.username}'s suspension.`,
        resourceType: "user",
        resourceId: targetUserId,
        responseStatus: 200,
        oldValues: oldState,
        newValues: nextState,
        metadata: {
          actorUsername:
            actor.profile.username,
          targetUsername:
            targetProfile.username,
          reason:
            suspendedUntil
              ? reason
              : null,
        },
      });

      void createOrBumpAdminNotification({
        notificationType: suspendedUntil
          ? "account.manual_suspension"
          : "account.suspension_removed",
        severity: suspendedUntil
          ? "warning"
          : "info",
        title: suspendedUntil
          ? "Account suspended"
          : "Account suspension removed",
        message: suspendedUntil
          ? `${targetProfile.username} was suspended until ${suspendedUntil}. Reason: ${reason}`
          : `${targetProfile.username} was unsuspended by ${actor.profile.username}.`,
        targetUserId,
        resourceType: "user",
        resourceId: targetUserId,
        dedupeKey: suspendedUntil
          ? `manual-suspension:${targetUserId}`
          : `manual-unsuspension:${targetUserId}`,
        metadata: {
          actorUsername:
            actor.profile.username,
          reason:
            suspendedUntil
              ? reason
              : null,
          suspendedUntil,
        },
        cooldownMs: 5 * 60 * 1000,
      });

      return res.json({
        success: true,
        profile: {
          id: updatedProfile.id,
          username:
            updatedProfile.username,
          role: updatedProfile.role,
          banned:
            updatedProfile.banned === true,
          suspended:
            nextState.active,
          suspendedUntil:
            nextState.suspendedUntil,
          suspensionReason:
            nextState.reason,
          suspensionSource:
            nextState.source,
        },
      });
    } catch (error) {
      console.error(
        "Suspension update failed:",
        error,
      );

      return res.status(500).json({
        error:
          "That account suspension could not be updated.",
      });
    }
  },
);

app.get(
  "/api/admin/usage/settings",
  requireRole("owner"),
  async (req, res) => {
    try {
      const [
        policiesResult,
        violationsResult,
      ] = await Promise.all([
        supabaseAdmin
          .from("usage_policies")
          .select("*")
          .order("role", {
            ascending: true,
          }),
        supabaseAdmin
          .from("usage_events")
          .select(
            "id, user_id, created_at, metadata",
          )
          .eq(
            "usage_type",
            "limit_violation",
          )
          .order("created_at", {
            ascending: false,
          })
          .limit(100),
      ]);

      const error =
        policiesResult.error ||
        violationsResult.error;

      if (error) {
        throw error;
      }

      const violations =
        violationsResult.data || [];

      const profileMap =
        await getProfilesByIds(
          violations.map(
            (item) => item.user_id,
          ),
        );

      return res.json({
        policies: (
          policiesResult.data || []
        )
          .sort(
            (a, b) =>
              USAGE_POLICY_ROLES.indexOf(
                a.role,
              ) -
              USAGE_POLICY_ROLES.indexOf(
                b.role,
              ),
          )
          .map(serializeUsagePolicy),
        recentViolations:
          violations.map((item) => ({
            id: item.id,
            userId: item.user_id,
            username:
              profileMap.get(item.user_id)
                ?.username || "Unknown",
            blockedType:
              item.metadata?.blockedType ||
              "unknown",
            limit:
              item.metadata?.limit ?? null,
            used:
              item.metadata?.used ?? null,
            createdAt:
              item.created_at,
          })),
      });
    } catch (error) {
      console.error(
        "Usage settings load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "Usage settings could not be loaded.",
      });
    }
  },
);

app.patch(
  "/api/admin/usage/settings/:role",
  requireRole("owner"),
  async (req, res) => {
    const role = String(
      req.params.role || "",
    ).toLowerCase();

    if (!USAGE_POLICY_ROLES.includes(role)) {
      return res.status(400).json({
        error:
          "That usage-policy role is invalid.",
      });
    }

    try {
      const values = {
        ai_messages_daily:
          parseOptionalUsageLimit(
            req.body.aiMessagesDaily,
          ) ?? 0,
        ai_images_daily:
          parseOptionalUsageLimit(
            req.body.aiImagesDaily,
          ) ?? 0,
        proxy_requests_minute:
          parseOptionalUsageLimit(
            req.body.proxyRequestsMinute,
          ) ?? 0,
        proxy_requests_daily:
          parseOptionalUsageLimit(
            req.body.proxyRequestsDaily,
          ) ?? 0,
        violation_window_minutes:
          parseOptionalUsageLimit(
            req.body.violationWindowMinutes,
            {
              minimum: 5,
              maximum: 1440,
            },
          ) ?? 60,
        auto_suspend_after_violations:
          parseOptionalUsageLimit(
            req.body.autoSuspendAfterViolations,
          ) ?? 0,
        auto_suspend_minutes:
          parseOptionalUsageLimit(
            req.body.autoSuspendMinutes,
            {
              minimum: 5,
              maximum: 525600,
            },
          ) ?? 60,
        updated_by:
          req.auth.user.id,
        updated_at:
          new Date().toISOString(),
      };

      const {
        data: policy,
        error,
      } = await supabaseAdmin
        .from("usage_policies")
        .upsert(
          {
            role,
            ...values,
          },
          {
            onConflict: "role",
          },
        )
        .select("*")
        .single();

      if (error) {
        throw error;
      }

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId:
          req.auth.user.id,
        category: "admin",
        action:
          "admin.usage_policy_updated",
        status: "success",
        description:
          `${req.auth.profile.username} updated the ${role} usage policy.`,
        resourceType:
          "usage_policy",
        resourceId: role,
        responseStatus: 200,
        newValues:
          serializeUsagePolicy(policy),
      });

      return res.json({
        success: true,
        policy:
          serializeUsagePolicy(policy),
      });
    } catch (error) {
      const message =
        error?.message ||
        "Usage policy update failed.";

      return res.status(400).json({
        error: message,
      });
    }
  },
);

app.get(
  "/api/admin/users/:userId/usage",
  requireRole("owner"),
  async (req, res) => {
    const targetUserId = String(
      req.params.userId || "",
    );

    try {
      const {
        data: profile,
        error: profileError,
      } = await supabaseAdmin
        .from("profiles")
        .select(
          "id, username, role, banned, suspended_until, suspension_reason, suspended_at, suspended_by, suspension_source",
        )
        .eq("id", targetUserId)
        .maybeSingle();

      if (profileError) {
        throw profileError;
      }

      if (!profile) {
        return res.status(404).json({
          error:
            "That user was not found.",
        });
      }

      const [policyData, usage] =
        await Promise.all([
          getEffectiveUsagePolicy(
            targetUserId,
            profile.role,
          ),
          getUserUsageSnapshot(
            targetUserId,
          ),
        ]);

      return res.json({
        user: {
          id: profile.id,
          username:
            profile.username,
          role: profile.role,
        },
        policy:
          serializeUsagePolicy(
            policyData.policy,
          ),
        override:
          serializeUsageOverride(
            policyData.override,
          ),
        effective:
          policyData.effective,
        usage,
        suspension:
          getSuspensionState(profile),
      });
    } catch (error) {
      console.error(
        "User usage load failed:",
        error,
      );

      return res.status(500).json({
        error:
          "That user's usage information could not be loaded.",
      });
    }
  },
);

app.patch(
  "/api/admin/users/:userId/usage",
  requireRole("owner"),
  async (req, res) => {
    const targetUserId = String(
      req.params.userId || "",
    );

    try {
      const values = {
        user_id: targetUserId,
        ai_messages_daily:
          parseOptionalUsageLimit(
            req.body.aiMessagesDaily,
          ),
        ai_images_daily:
          parseOptionalUsageLimit(
            req.body.aiImagesDaily,
          ),
        proxy_requests_minute:
          parseOptionalUsageLimit(
            req.body.proxyRequestsMinute,
          ),
        proxy_requests_daily:
          parseOptionalUsageLimit(
            req.body.proxyRequestsDaily,
          ),
        auto_suspend_after_violations:
          parseOptionalUsageLimit(
            req.body.autoSuspendAfterViolations,
          ),
        auto_suspend_minutes:
          parseOptionalUsageLimit(
            req.body.autoSuspendMinutes,
            {
              minimum: 5,
              maximum: 525600,
            },
          ),
        updated_by:
          req.auth.user.id,
        updated_at:
          new Date().toISOString(),
      };

      const {
        data: override,
        error,
      } = await supabaseAdmin
        .from("user_usage_overrides")
        .upsert(values, {
          onConflict: "user_id",
        })
        .select("*")
        .single();

      if (error) {
        throw error;
      }

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId:
          req.auth.user.id,
        targetUserId,
        category: "admin",
        action:
          "admin.user_usage_override_updated",
        status: "success",
        description:
          `${req.auth.profile.username} updated a user's usage limits.`,
        resourceType: "user",
        resourceId: targetUserId,
        responseStatus: 200,
        newValues:
          serializeUsageOverride(override),
      });

      return res.json({
        success: true,
        override:
          serializeUsageOverride(override),
      });
    } catch (error) {
      return res.status(400).json({
        error:
          error?.message ||
          "That user's usage limits could not be updated.",
      });
    }
  },
);

app.delete(
  "/api/admin/users/:userId/usage",
  requireRole("owner"),
  async (req, res) => {
    const targetUserId = String(
      req.params.userId || "",
    );

    try {
      const { error } = await supabaseAdmin
        .from("user_usage_overrides")
        .delete()
        .eq("user_id", targetUserId);

      if (error) {
        throw error;
      }

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId:
          req.auth.user.id,
        targetUserId,
        category: "admin",
        action:
          "admin.user_usage_override_cleared",
        status: "success",
        description:
          `${req.auth.profile.username} restored a user's role-based limits.`,
        resourceType: "user",
        resourceId: targetUserId,
        responseStatus: 200,
      });

      return res.json({
        success: true,
      });
    } catch (error) {
      return res.status(500).json({
        error:
          "That user's custom limits could not be cleared.",
      });
    }
  },
);

app.post(
  "/api/admin/users/:userId/usage/reset",
  requireRole("owner"),
  async (req, res) => {
    const targetUserId = String(
      req.params.userId || "",
    );

    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    try {
      const { error } = await supabaseAdmin
        .from("usage_events")
        .delete()
        .eq("user_id", targetUserId)
        .gte(
          "created_at",
          dayStart.toISOString(),
        )
        .in("usage_type", [
          "ai_message",
          "ai_image",
          "proxy_request",
        ]);

      if (error) {
        throw error;
      }

      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId:
          req.auth.user.id,
        targetUserId,
        category: "admin",
        action:
          "admin.user_usage_reset",
        status: "success",
        description:
          `${req.auth.profile.username} reset a user's usage counters for today.`,
        resourceType: "user",
        resourceId: targetUserId,
        responseStatus: 200,
      });

      return res.json({
        success: true,
      });
    } catch (error) {
      return res.status(500).json({
        error:
          "That user's usage counters could not be reset.",
      });
    }
  },
);

/* =======================================================
   OWNER BACKUPS + DATA EXPORTS
======================================================= */

const ADMIN_EXPORT_PAGE_SIZE = 1000;
const ADMIN_EXPORT_MAX_ROWS = 50000;

const ADMIN_EXPORT_TABLES = {
  profiles: {
    table: "profiles",
    orderColumn: "created_at",
  },
  inviteCodes: {
    table: "invite_codes",
    orderColumn: "id",
  },
  aiChats: {
    table: "ai_chats",
    orderColumn: "created_at",
  },
  aiMessages: {
    table: "ai_messages",
    orderColumn: "created_at",
  },
  activityLogs: {
    table: "activity_logs",
    orderColumn: "created_at",
  },
  announcements: {
    table: "announcements",
    orderColumn: "created_at",
  },
  platformSettings: {
    table: "platform_settings",
    orderColumn: "id",
  },
  adminNotifications: {
    table: "admin_notifications",
    orderColumn: "last_occurred_at",
  },
  adminNotificationStates: {
    table: "admin_notification_states",
    orderColumn: "updated_at",
  },
  securitySessions: {
    table: "user_security_sessions",
    orderColumn: "first_seen_at",
  },
  usagePolicies: {
    table: "usage_policies",
    orderColumn: "role",
  },
  userUsageOverrides: {
    table: "user_usage_overrides",
    orderColumn: "updated_at",
  },
  usageEvents: {
    table: "usage_events",
    orderColumn: "created_at",
  },
  accountAppState: {
    table: "account_app_state",
    orderColumn: "updated_at",
  },
};

function parseAdminExportDate(value, endOfDay = false) {
  const raw = String(value || "").trim();

  if (!raw) {
    return null;
  }

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : raw;

  const date = new Date(normalized);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function getAdminExportRange(req) {
  const from = parseAdminExportDate(req.query.from, false);
  const to = parseAdminExportDate(req.query.to, true);

  if (req.query.from && !from) {
    return {
      error: "Choose a valid export start date.",
    };
  }

  if (req.query.to && !to) {
    return {
      error: "Choose a valid export end date.",
    };
  }

  if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
    return {
      error: "The export start date must be before the end date.",
    };
  }

  return { from, to };
}

async function fetchAdminExportRows({
  table,
  select = "*",
  orderColumn = null,
  dateColumn = null,
  from = null,
  to = null,
  equals = {},
  maximumRows = ADMIN_EXPORT_MAX_ROWS,
}) {
  const rows = [];
  let offset = 0;
  let truncated = false;

  while (offset < maximumRows) {
    const remaining = maximumRows - offset;
    const pageSize = Math.min(ADMIN_EXPORT_PAGE_SIZE, remaining);

    let query = supabaseAdmin
      .from(table)
      .select(select)
      .range(offset, offset + pageSize - 1);

    if (orderColumn) {
      query = query.order(orderColumn, {
        ascending: true,
      });
    }

    if (dateColumn && from) {
      query = query.gte(dateColumn, from);
    }

    if (dateColumn && to) {
      query = query.lte(dateColumn, to);
    }

    for (const [column, value] of Object.entries(equals || {})) {
      query = query.eq(column, value);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const pageRows = data || [];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  if (rows.length >= maximumRows) {
    truncated = true;
  }

  return {
    rows,
    truncated,
  };
}

async function fetchAllAdminAuthUsers() {
  const users = [];
  const perPage = 1000;
  let page = 1;
  let truncated = false;

  while (users.length < ADMIN_EXPORT_MAX_ROWS) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw error;
    }

    const pageUsers = data?.users || [];
    users.push(...pageUsers);

    if (pageUsers.length < perPage) {
      break;
    }

    page += 1;
  }

  if (users.length >= ADMIN_EXPORT_MAX_ROWS) {
    truncated = true;
  }

  return {
    rows: users.slice(0, ADMIN_EXPORT_MAX_ROWS).map((user) => ({
      id: user.id,
      aud: user.aud,
      role: user.role,
      email: user.email,
      phone: user.phone,
      created_at: user.created_at,
      confirmed_at: user.confirmed_at,
      email_confirmed_at: user.email_confirmed_at,
      phone_confirmed_at: user.phone_confirmed_at,
      last_sign_in_at: user.last_sign_in_at,
      banned_until: user.banned_until,
      is_anonymous: user.is_anonymous === true,
      app_metadata: user.app_metadata || {},
      user_metadata: user.user_metadata || {},
    })),
    truncated,
  };
}

function sanitizeAdminSecuritySession(row) {
  const safe = { ...row };
  delete safe.session_token_hash;
  return safe;
}

function createProfileExportMap(profiles) {
  return new Map(
    (profiles || []).map((profile) => [
      profile.id,
      profile,
    ]),
  );
}

function mergeAdminUserExports(authUsers, profiles) {
  const authMap = new Map(
    (authUsers || []).map((user) => [user.id, user]),
  );
  const profileMap = createProfileExportMap(profiles);
  const ids = new Set([
    ...authMap.keys(),
    ...profileMap.keys(),
  ]);

  return [...ids].map((id) => {
    const authUser = authMap.get(id) || {};
    const profile = profileMap.get(id) || {};

    return {
      id,
      username: profile.username || null,
      email: authUser.email || null,
      phone: authUser.phone || null,
      role: profile.role || authUser.role || null,
      banned: profile.banned === true,
      suspended_until: profile.suspended_until || null,
      suspension_reason: profile.suspension_reason || null,
      suspension_source: profile.suspension_source || null,
      profile_created_at: profile.created_at || null,
      profile_updated_at: profile.updated_at || null,
      auth_created_at: authUser.created_at || null,
      confirmed_at: authUser.confirmed_at || null,
      last_sign_in_at: authUser.last_sign_in_at || null,
      banned_until: authUser.banned_until || null,
      app_metadata: authUser.app_metadata || {},
      user_metadata: authUser.user_metadata || {},
    };
  });
}

function adminCsvCell(value) {
  if (value === null || value === undefined) {
    return "";
  }

  let text = typeof value === "object"
    ? JSON.stringify(value)
    : String(value);

  text = text.replace(/\u0000/g, "");

  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function adminRowsToCsv(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];

  if (safeRows.length === 0) {
    return "No data\n";
  }

  const columns = [];
  const seen = new Set();

  for (const row of safeRows) {
    for (const key of Object.keys(row || {})) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }

  const lines = [
    columns.map(adminCsvCell).join(","),
  ];

  for (const row of safeRows) {
    lines.push(
      columns
        .map((column) => adminCsvCell(row?.[column]))
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}

function adminExportFilename(dataset, format) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  return `fuzz-${dataset}-${timestamp}.${format}`;
}

async function countAdminExportRows(table, equals = {}) {
  let query = supabaseAdmin
    .from(table)
    .select("id", {
      count: "exact",
      head: true,
    });

  for (const [column, value] of Object.entries(equals)) {
    query = query.eq(column, value);
  }

  const { count, error } = await query;

  if (error) {
    throw error;
  }

  return count || 0;
}

async function buildAdminExportDataset(dataset, range) {
  const dateOptions = {
    from: range.from,
    to: range.to,
  };

  if (dataset === "users") {
    const [authResult, profileResult] = await Promise.all([
      fetchAllAdminAuthUsers(),
      fetchAdminExportRows({
        ...ADMIN_EXPORT_TABLES.profiles,
      }),
    ]);

    const rows = mergeAdminUserExports(
      authResult.rows,
      profileResult.rows,
    );

    return {
      json: {
        users: rows,
      },
      csvRows: rows,
      truncated: authResult.truncated || profileResult.truncated,
    };
  }

  if (dataset === "activity") {
    const [logResult, profileResult] = await Promise.all([
      fetchAdminExportRows({
        ...ADMIN_EXPORT_TABLES.activityLogs,
        dateColumn: "created_at",
        ...dateOptions,
      }),
      fetchAdminExportRows({
        ...ADMIN_EXPORT_TABLES.profiles,
      }),
    ]);

    const profiles = createProfileExportMap(profileResult.rows);
    const rows = logResult.rows.map((log) => ({
      ...log,
      username: profiles.get(log.user_id)?.username || null,
      actor_username: profiles.get(log.actor_user_id)?.username || null,
      target_username: profiles.get(log.target_user_id)?.username || null,
    }));

    return {
      json: { activity_logs: rows },
      csvRows: rows,
      truncated: logResult.truncated,
    };
  }

  if (dataset === "ai") {
    const [chatResult, messageResult, profileResult] = await Promise.all([
      fetchAdminExportRows({
        ...ADMIN_EXPORT_TABLES.aiChats,
        dateColumn: "created_at",
        ...dateOptions,
      }),
      fetchAdminExportRows({
        ...ADMIN_EXPORT_TABLES.aiMessages,
        dateColumn: "created_at",
        ...dateOptions,
      }),
      fetchAdminExportRows({
        ...ADMIN_EXPORT_TABLES.profiles,
      }),
    ]);

    const chats = new Map(
      chatResult.rows.map((chat) => [chat.id, chat]),
    );
    const profiles = createProfileExportMap(profileResult.rows);

    const csvRows = messageResult.rows.map((message) => {
      const chat = chats.get(message.chat_id) || {};

      return {
        message_id: message.id,
        chat_id: message.chat_id,
        user_id: message.user_id || chat.user_id || null,
        username:
          profiles.get(message.user_id || chat.user_id)?.username || null,
        chat_title: chat.title || null,
        role: message.role,
        content: message.content,
        has_image: message.has_image,
        image_name: message.image_name,
        message_created_at: message.created_at,
        chat_created_at: chat.created_at || null,
        chat_updated_at: chat.updated_at || null,
      };
    });

    return {
      json: {
        ai_chats: chatResult.rows,
        ai_messages: messageResult.rows,
      },
      csvRows,
      truncated: chatResult.truncated || messageResult.truncated,
    };
  }

  if (dataset === "proxy") {
    const [logResult, profileResult] = await Promise.all([
      fetchAdminExportRows({
        ...ADMIN_EXPORT_TABLES.activityLogs,
        dateColumn: "created_at",
        equals: { category: "proxy" },
        ...dateOptions,
      }),
      fetchAdminExportRows({
        ...ADMIN_EXPORT_TABLES.profiles,
      }),
    ]);

    const profiles = createProfileExportMap(profileResult.rows);
    const rows = logResult.rows.map((log) => ({
      ...log,
      username: profiles.get(log.user_id)?.username || null,
    }));

    return {
      json: { proxy_activity: rows },
      csvRows: rows,
      truncated: logResult.truncated,
    };
  }

  if (dataset === "announcements") {
    const result = await fetchAdminExportRows({
      ...ADMIN_EXPORT_TABLES.announcements,
      dateColumn: "created_at",
      ...dateOptions,
    });

    return {
      json: { announcements: result.rows },
      csvRows: result.rows,
      truncated: result.truncated,
    };
  }

  if (dataset === "invites") {
    const result = await fetchAdminExportRows({
      ...ADMIN_EXPORT_TABLES.inviteCodes,
    });

    return {
      json: { invite_codes: result.rows },
      csvRows: result.rows,
      truncated: result.truncated,
    };
  }

  if (dataset === "security") {
    const [sessionResult, notificationResult, stateResult] = await Promise.all([
      fetchAdminExportRows({
        ...ADMIN_EXPORT_TABLES.securitySessions,
        dateColumn: "first_seen_at",
        ...dateOptions,
      }),
      fetchAdminExportRows({
        ...ADMIN_EXPORT_TABLES.adminNotifications,
        dateColumn: "created_at",
        ...dateOptions,
      }),
      fetchAdminExportRows({
        ...ADMIN_EXPORT_TABLES.adminNotificationStates,
      }),
    ]);

    const sessions = sessionResult.rows.map(sanitizeAdminSecuritySession);

    return {
      json: {
        user_security_sessions: sessions,
        admin_notifications: notificationResult.rows,
        admin_notification_states: stateResult.rows,
      },
      csvRows: sessions,
      truncated:
        sessionResult.truncated ||
        notificationResult.truncated ||
        stateResult.truncated,
    };
  }

  if (dataset === "usage") {
    const [policyResult, overrideResult, eventResult] = await Promise.all([
      fetchAdminExportRows({
        ...ADMIN_EXPORT_TABLES.usagePolicies,
      }),
      fetchAdminExportRows({
        ...ADMIN_EXPORT_TABLES.userUsageOverrides,
      }),
      fetchAdminExportRows({
        ...ADMIN_EXPORT_TABLES.usageEvents,
        dateColumn: "created_at",
        ...dateOptions,
      }),
    ]);

    return {
      json: {
        usage_policies: policyResult.rows,
        user_usage_overrides: overrideResult.rows,
        usage_events: eventResult.rows,
      },
      csvRows: eventResult.rows,
      truncated:
        policyResult.truncated ||
        overrideResult.truncated ||
        eventResult.truncated,
    };
  }

  if (dataset === "settings") {
    const result = await fetchAdminExportRows({
      ...ADMIN_EXPORT_TABLES.platformSettings,
    });

    return {
      json: { platform_settings: result.rows },
      csvRows: result.rows,
      truncated: result.truncated,
    };
  }

  if (dataset === "notifications") {
    const [notificationResult, stateResult] = await Promise.all([
      fetchAdminExportRows({
        ...ADMIN_EXPORT_TABLES.adminNotifications,
        dateColumn: "created_at",
        ...dateOptions,
      }),
      fetchAdminExportRows({
        ...ADMIN_EXPORT_TABLES.adminNotificationStates,
      }),
    ]);

    return {
      json: {
        admin_notifications: notificationResult.rows,
        admin_notification_states: stateResult.rows,
      },
      csvRows: notificationResult.rows,
      truncated: notificationResult.truncated || stateResult.truncated,
    };
  }

  if (dataset === "full") {
    const [authResult, ...tableResults] = await Promise.all([
      fetchAllAdminAuthUsers(),
      ...Object.values(ADMIN_EXPORT_TABLES).map((config) =>
        fetchAdminExportRows(config),
      ),
    ]);

    const tableEntries = Object.keys(ADMIN_EXPORT_TABLES).map(
      (key, index) => [key, tableResults[index]],
    );

    const tables = {};
    const truncatedTables = [];

    for (const [key, result] of tableEntries) {
      if (key === "securitySessions") {
        tables[key] = result.rows.map(sanitizeAdminSecuritySession);
      } else {
        tables[key] = result.rows;
      }

      if (result.truncated) {
        truncatedTables.push(key);
      }
    }

    if (authResult.truncated) {
      truncatedTables.push("authUsers");
    }

    return {
      json: {
        metadata: {
          application: "FuzzTheHuzz",
          backupVersion: 1,
          generatedAt: new Date().toISOString(),
          notes: [
            "Authentication password hashes and refresh tokens are never included.",
            "Security session token hashes are intentionally excluded.",
            "Environment variables, API keys and cached remote assets are not included.",
            "This is a data export, not an automatic one-click restore file.",
          ],
          rowLimitPerTable: ADMIN_EXPORT_MAX_ROWS,
          truncatedTables,
        },
        authUsers: authResult.rows,
        tables,
      },
      csvRows: [],
      truncated: truncatedTables.length > 0,
    };
  }

  throw new Error("That export dataset is not supported.");
}

app.get(
  "/api/admin/exports/summary",
  requireRole("owner"),
  async (_req, res) => {
    try {
      const [
        users,
        activity,
        aiChats,
        aiMessages,
        proxy,
        announcements,
        invites,
        notifications,
        securitySessions,
        usageEvents,
        lastExportResult,
      ] = await Promise.all([
        countAdminExportRows("profiles"),
        countAdminExportRows("activity_logs"),
        countAdminExportRows("ai_chats"),
        countAdminExportRows("ai_messages"),
        countAdminExportRows("activity_logs", { category: "proxy" }),
        countAdminExportRows("announcements"),
        countAdminExportRows("invite_codes"),
        countAdminExportRows("admin_notifications"),
        countAdminExportRows("user_security_sessions"),
        countAdminExportRows("usage_events"),
        supabaseAdmin
          .from("activity_logs")
          .select("created_at, description, metadata")
          .eq("action", "admin.data_export_downloaded")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (lastExportResult.error) {
        throw lastExportResult.error;
      }

      return res.json({
        counts: {
          users,
          activity,
          aiChats,
          aiMessages,
          proxy,
          announcements,
          invites,
          notifications,
          securitySessions,
          usageEvents,
        },
        lastExport: lastExportResult.data || null,
        limits: {
          maximumRowsPerTable: ADMIN_EXPORT_MAX_ROWS,
        },
        exclusions: [
          "Passwords and password hashes",
          "Refresh tokens and security-session token hashes",
          "Environment variables and API keys",
          "Cached proxy assets and uploaded storage objects",
        ],
      });
    } catch (error) {
      console.error("Export summary failed:", error);

      return res.status(500).json({
        error: "Backup and export information could not be loaded.",
      });
    }
  },
);

app.get(
  "/api/admin/exports/download",
  requireRole("owner"),
  async (req, res) => {
    const dataset = String(req.query.dataset || "")
      .trim()
      .toLowerCase();
    const format = String(req.query.format || "json")
      .trim()
      .toLowerCase();

    const supportedDatasets = new Set([
      "full",
      "users",
      "activity",
      "ai",
      "proxy",
      "announcements",
      "invites",
      "security",
      "usage",
      "settings",
      "notifications",
    ]);

    if (!supportedDatasets.has(dataset)) {
      return res.status(400).json({
        error: "Choose a valid export dataset.",
      });
    }

    if (!["json", "csv"].includes(format)) {
      return res.status(400).json({
        error: "Choose JSON or CSV as the export format.",
      });
    }

    if (dataset === "full" && format !== "json") {
      return res.status(400).json({
        error: "Full backups are available as JSON only.",
      });
    }

    const range = getAdminExportRange(req);

    if (range.error) {
      return res.status(400).json({
        error: range.error,
      });
    }

    try {
      const result = await buildAdminExportDataset(dataset, range);
      const generatedAt = new Date().toISOString();
      const filename = adminExportFilename(dataset, format);

      const payload = format === "csv"
        ? adminRowsToCsv(result.csvRows)
        : JSON.stringify(
            {
              export: {
                dataset,
                format,
                generatedAt,
                generatedBy: {
                  id: req.auth.user.id,
                  username: req.auth.profile.username,
                },
                dateRange: {
                  from: range.from,
                  to: range.to,
                },
                truncated: result.truncated === true,
                maximumRowsPerTable: ADMIN_EXPORT_MAX_ROWS,
              },
              data: result.json,
            },
            null,
            2,
          );

      await writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId: req.auth.user.id,
        category: "admin",
        action: "admin.data_export_downloaded",
        status: "success",
        description:
          `${req.auth.profile.username} downloaded the ${dataset} ${format.toUpperCase()} export.`,
        resourceType: "data_export",
        resourceId: dataset,
        responseStatus: 200,
        metadata: {
          dataset,
          format,
          from: range.from,
          to: range.to,
          truncated: result.truncated === true,
          filename,
        },
      });

      res.setHeader("Cache-Control", "no-store, private");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Type",
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/json; charset=utf-8",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );

      return res.status(200).send(payload);
    } catch (error) {
      console.error("Data export failed:", error);

      return res.status(500).json({
        error: "That data export could not be generated.",
      });
    }
  },
);

/* =======================================================
   STATIC FILES

   Protect private HTML before static serving, but keep
   sw.js, bundles, CSS, JavaScript and proxy resources public.
======================================================= */

const protectedHtmlFiles = new Set([
  "/index.html",
  "/apps.html",
  "/games.html",
  "/settings.html",
  "/tabs.html",
  "/proxy.html",
  "/ai.html",
  "/admin.html",
  "/status.html",
]);

app.use((req, res, next) => {
  if (!protectedHtmlFiles.has(req.path)) {
    return next();
  }

  if (req.path === "/admin.html") {
    return requireOwnerPage(
      req,
      res,
      next,
    );
  }

  return requirePageAuth(
    req,
    res,
    next,
  );
});

/* =======================================================
   SCRAMJET CLIENT ASSETS
======================================================= */

const proxyVendorStaticOptions = {
  index: false,
  fallthrough: false,
  setHeaders(res) {
    res.setHeader(
      "Cache-Control",
      "public, max-age=3600",
    );
    res.setHeader(
      "Cross-Origin-Resource-Policy",
      "same-origin",
    );
  },
};

app.use(
  "/scram",
  express.static(
    scramjetPath,
    proxyVendorStaticOptions,
  ),
);

app.use(
  "/baremux",
  express.static(
    baremuxPath,
    proxyVendorStaticOptions,
  ),
);

app.use(
  "/libcurl",
  express.static(
    libcurlPath,
    proxyVendorStaticOptions,
  ),
);

app.use(
  express.static(
    path.join(__dirname, "static"),
    {
      index: false,
      fallthrough: true,
      setHeaders(res, filePath) {
        if (
          filePath.endsWith("sw.js") ||
          filePath.includes(
            `${path.sep}mathematics${path.sep}`,
          )
        ) {
          res.setHeader(
            "Cache-Control",
            "no-store, no-cache, must-revalidate",
          );
        }
      },
    },
  ),
);

/* =======================================================
   PAGE ROUTES
======================================================= */

const publicRoutes = [
  {
    route: "/login",
    file: "login.html",
  },
  {
    route: "/signup",
    file: "signup.html",
  },
  {
    route: "/verified",
    file: "verified.html",
  },
  {
    route: "/suspended",
    file: "suspended.html",
  },
  {
    route: "/maintenance",
    file: "maintenance.html",
  },
  {
    route: "/feature-unavailable",
    file: "feature-unavailable.html",
  },
];

const protectedRoutes = [
  {
    route: "/",
    file: "index.html",
  },
  {
    route: "/b",
    file: "apps.html",
  },
  {
    route: "/a",
    file: "games.html",
  },
  {
    route: "/play.html",
    file: "games.html",
  },
  {
    route: "/c",
    file: "settings.html",
  },
  {
    route: "/d",
    file: "tabs.html",
  },
  {
    route: "/p",
    file: "proxy.html",
  },
  {
    route: "/ai",
    file: "ai.html",
  },
  {
    route: "/account",
    file: "account.html",
  },
  {
    route: "/status",
    file: "status.html",
  },
];

app.get(
  "/admin",
  requireOwnerPage,
  (_req, res) => {
    return res.sendFile(
      path.join(
        __dirname,
        "static",
        "admin.html",
      ),
    );
  },
);

for (const route of publicRoutes) {
  app.get(route.route, (_req, res) => {
    return res.sendFile(
      path.join(
        __dirname,
        "static",
        route.file,
      ),
    );
  });
}

for (const route of protectedRoutes) {
  app.get(
    route.route,
    requirePageAuth,
    (_req, res) => {
      return res.sendFile(
        path.join(
          __dirname,
          "static",
          route.file,
        ),
      );
    },
  );
}

/* =======================================================
   ERRORS
======================================================= */

app.use((_req, res) => {
  return res
    .status(404)
    .sendFile(
      path.join(
        __dirname,
        "static",
        "404.html",
      ),
    );
});

app.use((error, _req, res, _next) => {
  console.error(
    error?.stack || error,
  );

  return res
    .status(500)
    .sendFile(
      path.join(
        __dirname,
        "static",
        "404.html",
      ),
    );
});

/* =======================================================
   BARE SERVER + HTTP SERVER
======================================================= */

server.on("request", (req, res) => {
  /*
   * Bare requests must be handled before Express.
   */
  if (bareServer.shouldRoute(req)) {
    const settings =
      platformSettingsCache.value ||
      DEFAULT_PLATFORM_SETTINGS;

    if (
      !settings.proxy_enabled ||
      isMaintenanceActive(settings)
    ) {
      res.writeHead(503, {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });

      return res.end(
        JSON.stringify({
          error:
            "Proxy browsing is temporarily unavailable.",
          featureDisabled: true,
        }),
      );
    }

    return bareServer.routeRequest(
      req,
      res,
    );
  }

  return app(req, res);
});

server.on(
  "upgrade",
  (req, socket, head) => {
    let upgradePath = "";

    try {
      upgradePath = new URL(
        req.url || "/",
        "http://localhost",
      ).pathname;
    } catch {
      upgradePath = req.url || "";
    }

    if (
      upgradePath === "/wisp/" ||
      upgradePath.startsWith("/wisp/")
    ) {
      const settings =
        platformSettingsCache.value ||
        DEFAULT_PLATFORM_SETTINGS;

      if (
        !settings.proxy_enabled ||
        isMaintenanceActive(settings)
      ) {
        socket.end(
          "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n",
        );
        return;
      }

      return wispServer.routeRequest(
        req,
        socket,
        head,
      );
    }

    if (bareServer.shouldRoute(req)) {
      const settings =
        platformSettingsCache.value ||
        DEFAULT_PLATFORM_SETTINGS;

      if (
        !settings.proxy_enabled ||
        isMaintenanceActive(settings)
      ) {
        socket.end(
          "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n",
        );
        return;
      }

      return bareServer.routeUpgrade(
        req,
        socket,
        head,
      );
    }

    socket.end();
  },
);

server.on("error", (error) => {
  console.error(
    "Server failed to start:",
    error,
  );

  process.exitCode = 1;
});

server.on("listening", () => {
  console.log(
    chalk.green(
      `🌍 Server is running on port ${PORT}`,
    ),
  );
});

void getPlatformSettings(true).catch((error) => {
  console.error(
    "Initial platform settings preload failed:",
    error,
  );
});

server.listen(PORT, "0.0.0.0");