import http from "node:http";
import { authorization, streamPrefix } from "./cloud-browser-host.js";

const STREAM = /^\/cloud-browser\/stream\/([a-f0-9-]{36})\//;
const FRAME_POLICY = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; worker-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'self'; object-src 'none'";

export function upstreamHeaders(request, session, publicOrigin = "") {
  // An allowlist prevents leaking Novaris cookies, bearer tokens, or proxy credentials.
  const headers = { host: `127.0.0.1:${session.port}`, authorization: authorization(session) };
  if (publicOrigin) {
    const target = new URL(publicOrigin);
    headers.host = target.host;
    headers["x-forwarded-proto"] = target.protocol.slice(0, -1);
  }
  for (const key of ["accept", "accept-language", "user-agent", "range", "sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol"]) {
    if (request.headers[key]) headers[key] = request.headers[key];
  }
  return headers;
}

export function registerCloudBrowser(app, { store, host, requirePageAuth, requireApiAuth, requireRole, pagePath, writeActivityLog, authenticateStream, publicOrigin = process.env.CLOUD_BROWSER_PUBLIC_ORIGIN || "", recheckMs = 15000 }) {
  let origin = "";
  try {
    const value = new URL(publicOrigin);
    if (value.protocol === "https:" || (value.protocol === "http:" && ["localhost", "127.0.0.1"].includes(value.hostname))) origin = value.origin;
  } catch {
    /* Hosting is not configured yet. */
  }
  const configured = Boolean(host.configured && origin);
  const noStore = (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  };
  const sameOrigin = req => req.headers["sec-fetch-site"] !== "cross-site" && (!req.headers.origin || req.headers.origin === (origin || `${req.protocol}://${req.get("host")}`));
  const mutation = (req, res, next) => {
    if (!sameOrigin(req) || !req.is("application/json")) return res.status(403).json({ error: "Use a same-origin JSON request." });
    return next();
  };
  // Account administration belongs to the current website, even before a stream host is configured.
  const adminMutation = (req, res, next) => {
    const site = req.headers["sec-fetch-site"];
    const validOrigin = site === "same-origin" || (!site && req.headers.origin === `${req.protocol}://${req.get("host")}`);
    if (!validOrigin || !req.is("application/json")) return res.status(403).json({ error: "Use a same-origin JSON request." });
    return next();
  };
  const requirePermission = async (req, res, next) => {
    try {
      if (!(await store.allowed(req.auth.user.id))) return res.status(403).json({ error: "Cloud Browser access has not been enabled for your account." });
      return next();
    } catch {
      return res.status(503).json({ error: "Cloud Browser permissions are temporarily unavailable." });
    }
  };
  const reportError = (res, error) =>
    res.status(error.status === 429 ? 429 : 503).json({
      error: error.status === 429 ? error.message : "The cloud browser could not start. Please ask an administrator to check the browser host.",
    });
  app.get(["/cloud-browser", "/cloud-browser.html"], noStore, requirePageAuth, requirePermission, (_req, res) => res.sendFile(pagePath));
  app.get(["/cloud-games", "/cloud-games.html"], noStore, requirePageAuth, requirePermission, (_req, res) => res.redirect(302, "/cloud-browser"));
  app.use("/api/cloud-browser", noStore, requireApiAuth, requirePermission);
  app.get("/api/cloud-browser", async (req, res) => {
    try {
      return res.json({ configured, persistentProfile: true, session: await host.current(req.auth.user.id) });
    } catch (error) {
      return reportError(res, error);
    }
  });
  app.post("/api/cloud-browser/sessions", mutation, async (req, res) => {
    if (!configured) return res.status(503).json({ code: "BROWSER_HOST_NOT_CONFIGURED", error: "Your cloud browser host has not been connected yet." });
    try {
      const session = await host.start(req.auth.user.id);
      // Permission may have changed while a container was starting.
      if (!(await store.allowed(req.auth.user.id))) {
        await host.stop(req.auth.user.id);
        return res.status(403).json({ error: "Cloud Browser access was turned off." });
      }
      return res.status(201).json({ session });
    } catch (error) {
      return reportError(res, error);
    }
  });
  app.post("/api/cloud-browser/sessions/:sessionId/heartbeat", mutation, async (req, res) => {
    try {
      if (!(await host.touch(req.auth.user.id, req.params.sessionId))) return res.status(404).json({ error: "This browser session has ended." });
      return res.json({ active: true });
    } catch (error) {
      return reportError(res, error);
    }
  });
  app.delete("/api/cloud-browser/sessions/:sessionId", mutation, async (req, res) => {
    try {
      if (!(await host.get(req.auth.user.id, req.params.sessionId))) return res.status(404).json({ error: "Browser session not found." });
      await host.stop(req.auth.user.id);
      return res.json({ stopped: true, profileSaved: true });
    } catch {
      return res.status(503).json({ error: "The browser could not stop yet. Please try again." });
    }
  });

  app.use("/cloud-browser/stream", noStore, requireApiAuth, requirePermission, async (req, res) => {
    const id = STREAM.exec(req.originalUrl)?.[1];
    let session;
    try {
      session = id && (await host.get(req.auth.user.id, id));
    } catch {
      return res.status(503).end();
    }
    if (!sameOrigin(req)) return res.status(403).end();
    if (!session) return res.status(404).end();
    if (!["GET", "HEAD"].includes(req.method)) return res.status(405).end();
    res.setHeader("Content-Security-Policy", FRAME_POLICY);
    const respond = response => {
      res.status(response.statusCode || 502);
      for (const header of ["content-type", "content-length", "content-range", "accept-ranges", "content-encoding"]) {
        if (response.headers[header]) res.setHeader(header, response.headers[header]);
      }
      // Do not forward worker cookies, authentication challenges, or arbitrary redirects.
      const location = response.headers.location;
      if (location?.startsWith(streamPrefix(id))) res.setHeader("Location", location);
      response.on("error", () => res.destroy());
      response.pipe(res);
    };
    const upstream = host.remote ? host.request(req.auth.user.id, req.originalUrl, req.method, req.headers, respond) : http.request({ host: "127.0.0.1", port: session.port, path: req.originalUrl, method: req.method, headers: upstreamHeaders(req, session, origin), timeout: 15000 }, respond);
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => {
      if (!res.headersSent) res.status(502).end();
      else res.destroy();
    });
    res.on("close", () => upstream.destroy());
    upstream.end();
  });

  app.get("/api/admin/cloud-browser/permissions", noStore, requireRole("admin"), async (_req, res) => {
    try {
      return res.json({ permissions: await store.list() });
    } catch {
      return res.status(503).json({ error: "Cloud Browser permissions could not load. Check the database migration." });
    }
  });
  app.patch("/api/admin/users/:userId/cloud-browser", noStore, requireRole("admin"), adminMutation, async (req, res) => {
    const { userId } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) || typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "A valid user ID and boolean enabled value are required." });
    try {
      if (!(await store.set(userId, req.body.enabled, req.auth.user.id))) return res.status(404).json({ error: "User not found." });
      if (!req.body.enabled) void host.stop(userId).catch(() => {});
      void writeActivityLog({
        req,
        userId: req.auth.user.id,
        actorUserId: req.auth.user.id,
        targetUserId: userId,
        category: "admin",
        action: "admin.cloud_browser_permission_updated",
        status: "success",
        responseStatus: 200,
        description: `${req.auth.profile.username} turned Cloud Browser ${req.body.enabled ? "ON" : "OFF"} for a user.`,
        metadata: { enabled: req.body.enabled },
      });
      return res.json({ userId, enabled: req.body.enabled });
    } catch {
      return res.status(503).json({ error: "Cloud Browser permission could not be saved." });
    }
  });

  async function upgrade(req, socket, head) {
    socket.on("error", () => socket.destroy());
    socket.setTimeout(15000, () => socket.destroy());
    const reject = status => socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);
    const id = STREAM.exec(req.url || "")?.[1];
    if (!configured || !id || !origin || req.headers.origin !== origin) return reject(403);
    let auth;
    try {
      auth = await authenticateStream(req);
    } catch {
      return reject(401);
    }
    if (!auth || auth.suspension?.active) return reject(401);
    let session;
    try {
      session = await host.get(auth.user.id, id);
    } catch {
      return reject(503);
    }
    if (!session) return reject(404);
    try {
      if (!(await store.allowed(auth.user.id))) return reject(403);
    } catch {
      return reject(503);
    }
    if (socket.destroyed) return;
    const headers = { ...upstreamHeaders(req, session, origin), upgrade: "websocket", connection: "Upgrade", origin };
    const upstream = host.remote ? host.request(auth.user.id, req.url, "GET", headers) : http.request({ host: "127.0.0.1", port: session.port, path: req.url, headers, timeout: 15000 });
    upstream.on("upgrade", (response, remote, remoteHead) => {
      if (socket.destroyed) {
        remote.destroy();
        return;
      }
      let handshake = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n";
      for (const key of ["sec-websocket-accept", "sec-websocket-protocol"]) if (response.headers[key]) handshake += `${key}: ${response.headers[key]}\r\n`;
      socket.write(`${handshake}\r\n`);
      if (head.length) remote.write(head);
      if (remoteHead.length) socket.write(remoteHead);
      remote.setTimeout(0);
      socket.setTimeout(0);
      socket.pipe(remote).pipe(socket);
      session.sockets.add(socket);
      let checking = false;
      const timer = setInterval(async () => {
        if (checking) return;
        checking = true;
        try {
          const current = await authenticateStream(req);
          if (!current || current.user.id !== session.userId || current.suspension?.active || !(await store.allowed(session.userId))) {
            socket.destroy();
            // A signaling disconnect alone does not revoke an established WebRTC stream.
            await host.stop(session.userId);
          } else if (!(await host.get(session.userId, id))) socket.destroy();
        } catch {
          socket.destroy();
        } finally {
          checking = false;
        }
      }, recheckMs);
      timer.unref();
      socket.on("close", () => {
        clearInterval(timer);
        session.sockets.delete(socket);
        remote.destroy();
      });
      socket.on("error", () => remote.destroy());
      remote.on("error", () => socket.destroy());
      remote.on("close", () => socket.destroy());
    });
    upstream.on("response", response => {
      response.resume();
      reject(502);
    });
    upstream.on("error", () => socket.destroy());
    upstream.on("timeout", () => upstream.destroy());
    upstream.end();
  }
  return { upgrade, close: () => host.close() };
}
