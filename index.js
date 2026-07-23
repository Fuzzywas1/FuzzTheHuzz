import "dotenv/config";

import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";

import { createBareServer } from "@nebula-services/bare-server-node";
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

const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const cache = new Map();

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
  });
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
      description: targetDomain
        ? `Opened ${targetDomain} through the proxy.`
        : "A proxy navigation was started.",
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
      proxyQuery: query || null,
      proxyTargetUrl: targetUrl || null,
      proxyTargetDomain: targetDomain,
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
      const stream =
        await openai.responses.create({
          model: "gpt-5-mini",
          instructions:
            "You are Fuzz AI, the helpful AI assistant built into FuzzTheHuzz. Give clear, accurate, natural answers. Analyze attached images when provided. Use markdown when helpful.",
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
  "/ai.html",
  "/admin.html",
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
    route: "/ai",
    file: "ai.html",
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