import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRuntime, prefix } from "./runtime.mjs";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const STREAM = /^\/cloud-browser\/stream\/([a-f0-9-]{36})\/(.*)$/;
export function createHostServer({ key, runtime }) {
  if (typeof key !== "string" || key.length < 32) throw new Error("A host key of at least 32 characters is required.");
  const expected = Buffer.from(`Bearer ${key}`);
  function user(req) {
    const actual = Buffer.from(req.headers.authorization || "");
    const id = req.headers["x-novaris-user"];
    return actual.length === expected.length && timingSafeEqual(actual, expected) && typeof id === "string" && UUID.test(id) ? id.toLowerCase() : null;
  }
  function json(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  }
  function target(req, userId) {
    const url = new URL(req.url, "http://localhost");
    const match = STREAM.exec(url.pathname);
    if (match && /[%\\]/.test(match[2])) return null;
    const session = match && runtime.get(userId, match[1]);
    return session ? { session, url, route: match[2] } : null;
  }
  const server = http.createServer(async (req, res) => {
    const userId = user(req);
    if (!userId) return json(res, 401, { error: "Unauthorized" });
    // The RPC protocol has no request bodies and never accepts a client-selected owner.
    req.resume();
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/v1/session") {
        if (req.method === "GET") return json(res, 200, { session: runtime.current(userId) });
        if (req.method === "POST") return json(res, 200, { session: await runtime.start(userId) });
        if (req.method === "DELETE") {
          await runtime.stop(userId);
          return json(res, 200, { stopped: true });
        }
      }
      const heartbeat = /^\/v1\/session\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (heartbeat && req.method === "PUT") return json(res, 200, { active: runtime.touch(userId, heartbeat[1]) });
      const stream = target(req, userId);
      if (!stream) return json(res, 404, { error: "Not found" });
      if (!["GET", "HEAD"].includes(req.method)) return json(res, 405, { error: "Method not allowed" });
      // The legacy client needs only public assets and its authenticated signaling socket.
      if (stream.route === "api/oauth/config") return json(res, 200, { enabled: false, password_login_enabled: true });
      if (/^(api|metrics|debug|ws)(\/|$)/i.test(stream.route)) return json(res, 403, { error: "Unavailable" });
      const upstream = http.request({ host: "127.0.0.1", port: stream.session.port, path: stream.url.pathname, method: req.method, timeout: 15000 }, response => {
        const headers = { "Cache-Control": "no-store" };
        for (const name of ["content-type", "content-length", "content-encoding"]) if (response.headers[name]) headers[name] = response.headers[name];
        const location = response.headers.location;
        if (location?.startsWith(prefix(stream.session.id))) headers.location = location;
        if (req.method === "GET" && /text\/html/i.test(headers["content-type"] || "")) {
          let html = "";
          response.setEncoding("utf8");
          response.on("data", chunk => {
            html += chunk;
            if (html.length > 2 * 1024 * 1024) upstream.destroy();
          });
          response.on("end", () => {
            delete headers["content-length"];
            res.writeHead(response.statusCode || 502, headers);
            res.end(html.replace(/<title[^>]*>[^<]*<\/title>/i, "<title>Home</title>"));
          });
        } else {
          res.writeHead(response.statusCode || 502, headers);
          response.pipe(res);
        }
        response.on("error", () => res.destroy());
      });
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => {
        if (!res.headersSent) json(res, 502, { error: "Browser unavailable" });
        else res.destroy();
      });
      res.on("close", () => upstream.destroy());
      upstream.end();
    } catch (error) {
      // Never print Docker arguments: they contain per-container passwords.
      json(res, error.status === 429 ? 429 : 503, { error: "Browser host unavailable" });
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 100000;
  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => socket.destroy());
    socket.setTimeout(15000, () => socket.destroy());
    const reject = status => socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);
    const userId = user(req);
    if (!userId) return reject(401);
    if (typeof req.headers["sec-websocket-key"] !== "string" || req.headers["sec-websocket-version"] !== "13") return reject(400);
    const stream = target(req, userId);
    if (!stream || stream.route !== "ws") return reject(404);
    // A harmless UI placeholder is replaced here, after both authentication layers.
    // The real Neko user/admin passwords never reach the visitor or the website.
    const query = new URLSearchParams({ username: "Novaris", password: stream.session.password });
    const upstream = http.request({ host: "127.0.0.1", port: stream.session.port, path: `${stream.url.pathname}?${query}`, timeout: 15000, headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": req.headers["sec-websocket-key"], "sec-websocket-version": "13" } });
    upstream.on("upgrade", (response, remote, remoteHead) => {
      if (socket.destroyed || !runtime.get(userId, stream.session.id)) {
        remote.destroy();
        return;
      }
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${response.headers["sec-websocket-accept"]}\r\n\r\n`);
      if (head.length) remote.write(head);
      if (remoteHead.length) socket.write(remoteHead);
      socket.setTimeout(0);
      remote.setTimeout(0);
      stream.session.sockets.add(socket);
      socket.pipe(remote).pipe(socket);
      socket.on("close", () => {
        stream.session.sockets.delete(socket);
        remote.destroy();
      });
      remote.on("close", () => socket.destroy());
      remote.on("error", () => socket.destroy());
    });
    upstream.on("response", response => {
      response.resume();
      reject(502);
    });
    upstream.on("error", () => socket.destroy());
    upstream.on("timeout", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
    upstream.end();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const configPath = path.resolve(process.argv[2] || fileURLToPath(new URL("./host-config.json", import.meta.url)));
  const config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
  const runtime = createRuntime(config);
  const server = createHostServer({ key: config.key, runtime });
  server.listen(config.port || 8092, "127.0.0.1", () => console.log(`Novaris browser host listening on 127.0.0.1:${config.port || 8092}. Keep this window open.`));
  // The listening port also prevents two agents from managing the same containers.
  server.on("error", error => {
    console.error(`Cannot start browser host (${error.code}).`);
    process.exitCode = 1;
    void runtime.close();
  });
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      server.close();
      await runtime.close();
      server.closeAllConnections();
    });
}
