import "dotenv/config";

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
const server = http.createServer();
const app = express();

/*
 * Codespaces and most hosting providers place Express behind
 * an HTTPS reverse proxy. This allows secure cookies to work.
 */
app.set("trust proxy", 1);

const bareServer = createBareServer("/ca/");
const PORT = process.env.PORT || 8080;

const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const cache = new Map();

/* -------------------------------------------------------
   SUPABASE CLIENT
------------------------------------------------------- */

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_ANON_KEY in the .env file.",
  );
}

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
  apiKey: process.env.OPENAI_API_KEY,
});

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY in the .env file.");
}
/* -------------------------------------------------------
   AUTH COOKIE HELPERS
------------------------------------------------------- */

const ACCESS_COOKIE = "fuzz_access_token";
const REFRESH_COOKIE = "fuzz_refresh_token";

function isSecureRequest(req) {
  const forwardedProtocol = req.get("x-forwarded-proto") || "";

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

function clearAuthCookies(req, res) {
  const options = {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: "lax",
    path: "/",
  };

  res.clearCookie(ACCESS_COOKIE, options);
  res.clearCookie(REFRESH_COOKIE, options);
}

/* -------------------------------------------------------
   EXPRESS MIDDLEWARE
------------------------------------------------------- */

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

/* -------------------------------------------------------
   AUTHENTICATED USER LOOKUP
------------------------------------------------------- */

async function getAuthenticatedUser(req, res) {
  let accessToken = req.cookies[ACCESS_COOKIE];
  const refreshToken = req.cookies[REFRESH_COOKIE];

  if (!accessToken) {
    return null;
  }

  let {
    data: { user },
    error,
  } = await supabasePublic.auth.getUser(accessToken);

  /*
   * Try refreshing the Supabase session when the access token
   * has expired but a refresh token is still available.
   */
  if ((!user || error) && refreshToken) {
    const {
      data: refreshedData,
      error: refreshError,
    } = await supabasePublic.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (!refreshError && refreshedData.session) {
      accessToken = refreshedData.session.access_token;

      const cookieOptions = getCookieOptions(req);

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
      error = null;
    }
  }

  if (!user || error) {
    clearAuthCookies(req, res);
    return null;
  }

  const { data: profile, error: profileError } =
    await supabaseAdmin
      .from("profiles")
      .select("username, role, banned")
      .eq("id", user.id)
      .maybeSingle();

  if (profileError || !profile || profile.banned) {
    clearAuthCookies(req, res);
    return null;
  }

  return {
    user,
    profile,
    accessToken,
  };
}

async function requirePageAuth(req, res, next) {
  try {
    const auth = await getAuthenticatedUser(req, res);

    if (!auth) {
      const nextPath = encodeURIComponent(req.originalUrl);

      return res.redirect(`/login?next=${nextPath}`);
    }

    req.auth = auth;
    return next();
  } catch (error) {
    console.error("Page authentication failed:", error);

    clearAuthCookies(req, res);
    return res.redirect("/login");
  }
}

async function requireApiAuth(req, res, next) {
  try {
    const auth = await getAuthenticatedUser(req, res);

    if (!auth) {
      return res.status(401).json({
        error: "You must be signed in to use Fuzz AI.",
      });
    }

    req.auth = auth;
    return next();
  } catch (error) {
    console.error("API authentication failed:", error);

    clearAuthCookies(req, res);

    return res.status(401).json({
      error: "Your login session is no longer valid.",
    });
  }
}
/* -------------------------------------------------------
   SUPABASE CONNECTION TEST

   This can be removed after authentication is complete.
------------------------------------------------------- */

app.get("/api/setup-test", async (_req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .limit(1);

    if (error) {
      console.error("Supabase setup test failed:", error);

      return res.status(500).json({
        connected: false,
        error: error.message,
      });
    }

    return res.json({
      connected: true,
      message: "FuzzTheHuzz is connected to Supabase.",
    });
  } catch (error) {
    console.error("Supabase setup test crashed:", error);

    return res.status(500).json({
      connected: false,
      error: "Server configuration error.",
    });
  }
});

/* -------------------------------------------------------
   CREATE SECURE SERVER SESSION
------------------------------------------------------- */

app.post("/api/auth/session", async (req, res) => {
  const accessToken = String(req.body.accessToken || "");
  const refreshToken = String(req.body.refreshToken || "");

  if (!accessToken || !refreshToken) {
    return res.status(400).json({
      error: "Missing login session.",
    });
  }

  try {
    const {
      data: { user },
      error: userError,
    } = await supabasePublic.auth.getUser(accessToken);

    if (userError || !user) {
      clearAuthCookies(req, res);

      return res.status(401).json({
        error: "Invalid login session.",
      });
    }

    const { data: profile, error: profileError } =
      await supabaseAdmin
        .from("profiles")
        .select("username, role, banned")
        .eq("id", user.id)
        .maybeSingle();

    if (profileError || !profile) {
      return res.status(403).json({
        error: "Your profile could not be found.",
      });
    }

    if (profile.banned) {
      return res.status(403).json({
        error: "This account has been disabled.",
      });
    }

    const cookieOptions = getCookieOptions(req);

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
    console.error("Session creation failed:", error);

    clearAuthCookies(req, res);

    return res.status(500).json({
      error: "The secure login session could not be created.",
    });
  }
});

/* -------------------------------------------------------
   LOGOUT
------------------------------------------------------- */

app.post("/api/auth/logout", async (req, res) => {
  const accessToken = req.cookies[ACCESS_COOKIE];

  try {
    if (accessToken) {
      await supabaseAdmin.auth.admin.signOut(
        accessToken,
        "local",
      );
    }
  } catch (error) {
    console.error("Logout warning:", error);
  }

  clearAuthCookies(req, res);

  return res.json({
    success: true,
  });
});

/* -------------------------------------------------------
   ACCOUNT SIGNUP
------------------------------------------------------- */

app.post("/api/auth/signup", async (req, res) => {
  const email = String(req.body.email || "")
    .trim()
    .toLowerCase();

  const password = String(req.body.password || "");
  const username = String(req.body.username || "").trim();

  const inviteCode = String(req.body.inviteCode || "")
    .trim()
    .toUpperCase();

  const usernamePattern = /^[A-Za-z0-9_]{3,20}$/;

  if (!email || !password || !username || !inviteCode) {
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
      error: "Password must be at least 8 characters.",
    });
  }

  let createdUserId = null;
  let claimedInviteId = null;

  try {
    /*
     * Prevent duplicate usernames.
     * This is case-insensitive.
     */
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
        error: "That username is already taken.",
      });
    }

    /*
     * Check for an available one-time invite code.
     */
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

    /*
     * Create the Supabase authentication user.
     */
    const { data: signupData, error: signupError } =
      await supabasePublic.auth.signUp({
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

    /*
     * Supabase can return an empty identities array when an
     * account with the email already exists.
     */
    if (
      Array.isArray(signupData.user?.identities) &&
      signupData.user.identities.length === 0
    ) {
      return res.status(409).json({
        error: "An account with that email already exists.",
      });
    }

    createdUserId = signupData.user?.id;

    if (!createdUserId) {
      return res.status(500).json({
        error: "The account could not be created.",
      });
    }

    /*
     * Claim the invite code. Only an unused code can be updated.
     */
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

    if (!claimedCodes || claimedCodes.length !== 1) {
      await supabaseAdmin.auth.admin.deleteUser(createdUserId);
      createdUserId = null;

      return res.status(409).json({
        error:
          "That invite code was just used by someone else. Please use another code.",
      });
    }

    claimedInviteId = claimedCodes[0].id;

    /*
     * Create the user's public profile.
     */
    const { error: profileError } = await supabaseAdmin
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

    return res.status(201).json({
      success: true,
      message:
        "Account created successfully. Check your email to verify your account.",
    });
  } catch (error) {
    console.error("Signup error:", error);

    /*
     * Undo a partially created authentication account.
     */
    if (createdUserId) {
      const { error: deleteError } =
        await supabaseAdmin.auth.admin.deleteUser(
          createdUserId,
        );

      if (deleteError) {
        console.error(
          "Could not roll back Auth user:",
          deleteError,
        );
      }
    }

    /*
     * Make the invite code available again when signup fails.
     */
    if (claimedInviteId) {
      const { error: restoreInviteError } =
        await supabaseAdmin
          .from("invite_codes")
          .update({
            used: false,
            used_by: null,
          })
          .eq("id", claimedInviteId);

      if (restoreInviteError) {
        console.error(
          "Could not restore the invite code:",
          restoreInviteError,
        );
      }
    }

    return res.status(500).json({
      error: "Account creation failed. Please try again.",
    });
  }
});

app.post("/api/ai/chat", requireApiAuth, async (req, res) => {
  const messages = Array.isArray(req.body.messages)
    ? req.body.messages
    : [];

  if (messages.length === 0) {
    return res.status(400).json({
      error: "Send at least one message.",
    });
  }

  if (messages.length > 30) {
    return res.status(400).json({
      error: "This conversation is too long. Start a new chat.",
    });
  }

  const cleanedMessages = messages
    .filter((message) => {
      return (
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string"
      );
    })
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 12000),
    }))
    .filter((message) => message.content.length > 0);

  if (cleanedMessages.length === 0) {
    return res.status(400).json({
      error: "No valid messages were provided.",
    });
  }

  res.status(200);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Content-Type-Options", "nosniff");

  try {
    const stream = await openai.responses.create({
      model: "gpt-5-mini",
      instructions:
        "You are Fuzz AI, the helpful AI assistant built into FuzzTheHuzz. Give clear, accurate, natural answers. Use markdown when helpful. Do not claim to be ChatGPT.",
      input: cleanedMessages,
      max_output_tokens: 2000,
      store: false,
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        res.write(event.delta);
      }

      if (event.type === "response.failed") {
        console.error("OpenAI response failed:", event.response?.error);
      }
    }

    res.end();
  } catch (error) {
    console.error("Fuzz AI streaming request failed:", error);

    if (!res.headersSent) {
      return res.status(500).json({
        error: "Fuzz AI could not generate a response.",
      });
    }

    res.write("\n\nFuzz AI could not finish the response.");
    res.end();
  }
});

/* -------------------------------------------------------
   REMOTE ASSET CACHE
------------------------------------------------------- */

app.get("/e/*", async (req, res, next) => {
  try {
    if (cache.has(req.path)) {
      const {
        data,
        contentType,
        timestamp,
      } = cache.get(req.path);

      if (Date.now() - timestamp > CACHE_TTL) {
        cache.delete(req.path);
      } else {
        res.writeHead(200, {
          "Content-Type": contentType,
        });

        return res.end(data);
      }
    }

    const baseUrls = {
      "/e/1/":
        "https://raw.githubusercontent.com/qrs/x/fixy/",
      "/e/2/":
        "https://raw.githubusercontent.com/3v1/V5-Assets/main/",
      "/e/3/":
        "https://raw.githubusercontent.com/3v1/V5-Retro/master/",
    };

    let reqTarget;

    for (const [prefix, baseUrl] of Object.entries(baseUrls)) {
      if (req.path.startsWith(prefix)) {
        reqTarget =
          baseUrl + req.path.slice(prefix.length);

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

    const extension = path.extname(reqTarget);
    const binaryExtensions = [".unityweb"];

    const contentType =
      binaryExtensions.includes(extension)
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
    console.error("Error fetching asset:", error);

    return res
      .status(500)
      .send("Error fetching the asset.");
  }
});

/* -------------------------------------------------------
   BARE SERVER CORS
------------------------------------------------------- */

app.use("/ca", cors({ origin: true }));

/* -------------------------------------------------------
   WEBSITE PAGE ROUTES
------------------------------------------------------- */

const publicRoutes = [
  {
    path: "/login",
    file: "login.html",
  },
  {
    path: "/signup",
    file: "signup.html",
  },
  {
    path: "/verified",
    file: "verified.html",
  },
];

const protectedRoutes = [
  {
    path: "/b",
    file: "apps.html",
  },
  {
    path: "/a",
    file: "games.html",
  },
  {
    path: "/play.html",
    file: "games.html",
  },
  {
    path: "/c",
    file: "settings.html",
  },
  {
    path: "/d",
    file: "tabs.html",
  },
  {
    path: "/ai",
    file: "ai.html",
  },
  {
    path: "/",
    file: "index.html",
  },
];

publicRoutes.forEach((route) => {
  app.get(route.path, (_req, res) => {
    res.sendFile(
      path.join(__dirname, "static", route.file),
    );
  });
});

protectedRoutes.forEach((route) => {
  app.get(
    route.path,
    requirePageAuth,
    (_req, res) => {
      res.sendFile(
        path.join(__dirname, "static", route.file),
      );
    },
  );
});

/* -------------------------------------------------------
   PREVENT DIRECT HTML AUTH BYPASS
------------------------------------------------------- */

const protectedHtmlFiles = new Set([
  "/index.html",
  "/apps.html",
  "/games.html",
  "/settings.html",
  "/tabs.html",
  "/ai.html",
]);

app.use(async (req, res, next) => {
  if (!protectedHtmlFiles.has(req.path)) {
    return next();
  }

  return requirePageAuth(req, res, next);
});

/*
 * Static files must be served after the protected HTML check.
 * CSS, JavaScript, images, and public auth pages still work.
 */
app.use(
  express.static(path.join(__dirname, "static")),
);

/* -------------------------------------------------------
   404 AND ERROR HANDLERS
------------------------------------------------------- */

app.use((_req, res) => {
  res
    .status(404)
    .sendFile(
      path.join(__dirname, "static", "404.html"),
    );
});

app.use((error, _req, res, _next) => {
  console.error(error.stack || error);

  res
    .status(500)
    .sendFile(
      path.join(__dirname, "static", "404.html"),
    );
});

/* -------------------------------------------------------
   HTTP AND BARE SERVER HANDLING
------------------------------------------------------- */

server.on("request", (req, res) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

server.on("listening", () => {
  console.log(
    chalk.green(
      `🌍 Server is running on http://localhost:${PORT}`,
    ),
  );
});

server.listen({
  port: PORT,
});