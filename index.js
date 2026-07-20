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
const app = express();
const server = http.createServer();

app.set("trust proxy", 1);

const PORT = Number(process.env.PORT) || 8080;
const bareServer = createBareServer("/ca/");

const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const cache = new Map();

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
    .select("username, role, banned")
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

  return {
    user,
    profile,
    accessToken,
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

  clearAuthCookies(req, res);

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

    return res.status(500).json({
      error:
        "Account creation failed. Please try again.",
    });
  }
});

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

      const { error } = await supabaseAdmin
        .from("ai_chats")
        .delete()
        .eq("id", chatId)
        .eq("user_id", userId);

      if (error) {
        throw error;
      }

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
            "You are Fuzz AI, the helpful AI assistant built into FuzzTheHuzz. Give clear, accurate, natural answers. Analyze attached images when provided. Use markdown when helpful. Do not claim to be ChatGPT.",
          input: cleanedMessages,
          max_output_tokens: 2000,
          store: false,
          stream: true,
        });

      for await (const event of stream) {
        if (
          event.type ===
          "response.output_text.delta"
        ) {
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

      return res.end();
    } catch (error) {
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
]);

app.use((req, res, next) => {
  if (!protectedHtmlFiles.has(req.path)) {
    return next();
  }

  return requirePageAuth(req, res, next);
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

server.listen(PORT, "0.0.0.0");