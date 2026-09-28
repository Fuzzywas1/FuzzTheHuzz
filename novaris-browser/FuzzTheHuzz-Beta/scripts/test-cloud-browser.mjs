import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, test } from "node:test";
import vm from "node:vm";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import { registerCloudBrowser, upstreamHeaders } from "../lib/cloud-browser.js";
import { createBrowserHost, profileVolume, streamPrefix } from "../lib/cloud-browser-host.js";
import { createCloudBrowserStore } from "../lib/cloud-browser-store.js";

const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const source = fs.readFileSync("index.js", "utf8");
const pagePath = path.resolve("views/cloud-browser.html");
const permissions = new Map();
let databaseDown = false;
const banned = new Set();
const authenticate = async req => {
  const role = req.headers["x-test-role"];
  const id = req.headers["x-test-user"] || first;
  if (!role || banned.has(id)) return null;
  return { user: { id }, profile: { role, username: "tester" }, suspension: { active: req.headers["x-test-suspended"] === "true" } };
};
const context = vm.createContext({ console, getAuthenticatedUser: authenticate, clearAuthCookies() {}, sendSuspensionResponse: res => res.status(403).json({ error: "Suspended" }) });
vm.runInContext(source.slice(source.indexOf("async function requirePageAuth("), source.indexOf("function getRequestHeader(")), context);
const gates = vm.runInContext("({ requirePageAuth, requireApiAuth, requireRole })", context);
const store = {
  async allowed(id) {
    if (databaseDown) throw Error("offline");
    return permissions.get(id) === true;
  },
  async list() {
    return Object.fromEntries(permissions);
  },
  async set(id, enabled) {
    if (id !== first && id !== second) return false;
    permissions.set(id, enabled);
    return true;
  },
};
let receivedHeaders;
const worker = http.createServer((req, res) => {
  receivedHeaders = req.headers;
  res.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": "malicious=worker; Path=/" });
  res.end("<title>Home</title><p>Browser worker fixture</p>");
});
const wsWorker = new WebSocketServer({ server: worker });
wsWorker.on("connection", (socket, req) => {
  receivedHeaders = req.headers;
  socket.on("message", bytes => socket.send(bytes));
});
worker.listen(0, "127.0.0.1");
await once(worker, "listening");
const sessions = new Map();
const host = {
  configured: true,
  async start(userId) {
    if (!sessions.has(userId)) {
      const id = userId === first ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222";
      sessions.set(userId, { id, userId, port: worker.address().port, password: "worker-secret", sockets: new Set() });
    }
    return this.current(userId);
  },
  current(id) {
    const s = sessions.get(id);
    return s ? { id: s.id, url: streamPrefix(s.id), persistentProfile: true } : null;
  },
  get(id, sessionId) {
    const s = sessions.get(id);
    return s?.id === sessionId ? s : null;
  },
  touch(id, sessionId) {
    return Boolean(this.get(id, sessionId));
  },
  async stop(id) {
    for (const socket of sessions.get(id)?.sockets || []) socket.destroy();
    sessions.delete(id);
  },
  async close() {
    for (const id of sessions.keys()) await this.stop(id);
  },
};
const app = express();
app.use(express.json());
const gateway = registerCloudBrowser(app, { ...gates, store, host, pagePath, writeActivityLog() {}, authenticateStream: authenticate, publicOrigin: "http://localhost", recheckMs: 20 });
app.use(express.static(path.resolve("static"), { index: false }));
const server = http.createServer(app);
server.on("upgrade", (req, socket, head) => {
  void gateway.upgrade(req, socket, head);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
const request = (route, role, options = {}) => fetch(origin + route, { redirect: "manual", ...options, headers: { ...(role ? { "x-test-role": role } : {}), ...options.headers } });
const json = (method, data = {}, headers = {}) => ({ method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data) });
const toggle = (role, enabled) => request(`/api/admin/users/${first}/cloud-browser`, role, json("PATCH", { enabled }, { Origin: origin, "Sec-Fetch-Site": "same-origin" }));
after(async () => {
  await host.close();
  wsWorker.close();
  server.closeAllConnections();
  worker.closeAllConnections();
  await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => worker.close(resolve))]);
});

test("permission defaults, admin-only grants, protected HTML/aliases, and persistent session ownership", async () => {
  assert.equal((await request("/cloud-browser")).status, 302);
  // The stream origin is localhost; administration must work on the actual website origin.
  assert.equal((await request(`/api/admin/users/${first}/cloud-browser`, "admin", json("PATCH", { enabled: false }, { Origin: origin }))).status, 200);
  assert.equal((await request(`/api/admin/users/${first}/cloud-browser`, "admin", json("PATCH", { enabled: true }, { Origin: origin, "Sec-Fetch-Site": "cross-site" }))).status, 403);
  for (const role of ["user", "moderator", "admin", "owner"]) assert.equal((await request("/cloud-browser", role)).status, 403);
  assert.equal((await request("/api/cloud-browser")).status, 401);
  for (const role of [undefined, "user", "moderator"]) assert.equal((await toggle(role, true)).status, role ? 403 : 401);
  for (const enabled of ["true", 1, null]) assert.equal((await toggle("admin", enabled)).status, 400);
  assert.equal((await request(`/api/admin/users/${first}/cloud-browser`, "admin", json("PATCH", { enabled: true }, { Origin: "https://attacker.example" }))).status, 403);
  assert.equal((await toggle("owner", true)).status, 200);
  for (const route of ["/cloud-browser", "/cloud-browser.html", "/CLOUD-BROWSER", "/cloud-browser/"]) {
    const response = await request(route, "user");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    const html = await response.text();
    assert.match(html, /<title[^>]*>Home<\/title>/);
    assert.doesNotMatch(html, /Roblox|novnc/i);
  }
  assert.equal((await request("/cloud-games", "user")).headers.get("location"), "/cloud-browser");
  for (const route of ["/views/cloud-browser.html", "/static/cloud-browser.html", "/%63loud-browser.html"]) assert.equal((await request(route, "user")).status, 404);
  const launched = await request("/api/cloud-browser/sessions", "user", json("POST", { userId: second }));
  assert.equal(launched.status, 201);
  const session = (await launched.json()).session;
  assert.equal(session.persistentProfile, true);
  assert.equal(sessions.get(first).userId, first);
  assert.equal(sessions.has(second), false, "body cannot choose profile owner");
  permissions.set(second, true);
  assert.equal((await request(`/api/cloud-browser/sessions/${session.id}`, "user", json("DELETE", {}, { "x-test-user": second }))).status, 404);
  assert.equal((await request(session.url, "user", { headers: { "x-test-user": second } })).status, 404);
  assert.equal((await request(`/api/cloud-browser/sessions/${session.id}/heartbeat`, "user", json("POST"))).status, 200);
  const proxy = await request(session.url, "user", { headers: { cookie: "novaris-secret=private", authorization: "Bearer private" } });
  assert.equal(proxy.status, 200);
  assert.equal(proxy.headers.get("set-cookie"), null);
  await proxy.text();
  assert.equal(receivedHeaders.cookie, undefined);
  assert.notEqual(receivedHeaders.authorization, "Bearer private");
  assert.equal((await request("/api/cloud-browser", "user", { headers: { "x-test-suspended": "true" } })).status, 403);
  databaseDown = true;
  assert.equal((await request("/cloud-browser", "user")).status, 503);
  assert.equal((await request(session.url, "user")).status, 503);
  databaseDown = false;
  assert.equal((await toggle("admin", false)).status, 200);
  assert.equal((await request(session.url, "user")).status, 403);
  assert.equal((await request("/api/cloud-browser/sessions", "user", json("POST"))).status, 403);
});

test("stream WebSockets enforce origin, ownership, credentials and live permission revocation", async () => {
  permissions.set(first, true);
  const session = await host.start(first);
  const url = `${origin.replace("http:", "ws:")}${session.url}websocket`;
  for (const headers of [{ origin: "https://attacker.example", "x-test-role": "user" }, { origin: "http://localhost" }, { origin: "http://localhost", "x-test-role": "user", "x-test-user": second }]) {
    const socket = new WebSocket(url, { headers });
    await assert.rejects(once(socket, "open"));
  }
  const socket = new WebSocket(url, { headers: { origin: "http://localhost", "x-test-role": "user", cookie: "private-account-cookie=value" } });
  await once(socket, "open");
  const echo = once(socket, "message");
  socket.send("input-and-video-fixture");
  assert.equal((await echo)[0].toString(), "input-and-video-fixture");
  assert.equal(receivedHeaders.cookie, undefined);
  const closed = once(socket, "close");
  permissions.set(first, false);
  await closed;
  await host.stop(first);
});

test("Docker sessions deduplicate starts, isolate persistent volumes, limit capacity and retain profiles on stop", async () => {
  const calls = [];
  let time = 0;
  const docker = async args => {
    calls.push(args);
    if (args[0] === "network") return JSON.stringify([{ Options: { "com.docker.network.bridge.enable_icc": "false", "com.docker.network.bridge.name": "novaris-br" } }]);
    if (args[0] === "inspect") return JSON.stringify([{ NetworkSettings: { Ports: { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "39000" }] } } }]);
    return "";
  };
  const managed = createBrowserHost({
    env: { CLOUD_BROWSER_ENABLED: "true", CLOUD_BROWSER_IMAGE: `lscr.io/linuxserver/chromium@sha256:${"a".repeat(64)}`, CLOUD_BROWSER_NETWORK_READY: "true", CLOUD_BROWSER_MAX_SESSIONS: "2", CLOUD_BROWSER_IDLE_SECONDS: "60" },
    docker,
    fetcher: async () => new Response("ready"),
    now: () => time,
  });
  const [a, b] = await Promise.all([managed.start(first), managed.start(first)]);
  assert.equal(a.id, b.id);
  assert.equal(calls.filter(args => args[0] === "run").length, 1);
  const c = await managed.start(second);
  assert.notEqual(c.id, a.id);
  assert.notEqual(profileVolume(first), profileVolume(second));
  for (const args of calls.filter(args => args[0] === "run")) {
    assert.ok(args.includes("127.0.0.1::3000"));
    assert.ok(args.includes("--pull=never"));
    assert.ok(!args.includes("--privileged"));
    assert.ok(!args.some(value => value.includes("docker.sock")));
  }
  await assert.rejects(managed.start("third-user"), error => error.status === 429);
  await Promise.all([managed.stop(first), managed.stop(first)]);
  assert.equal(calls.filter(args => args[0] === "stop").length, 1);
  await managed.start(first);
  const starts = calls.filter(args => args[0] === "run");
  assert.equal(starts[0][starts[0].indexOf("--mount") + 1], starts[2][starts[2].indexOf("--mount") + 1]);
  time = 61000;
  await managed.sweep();
  assert.equal(managed.current(first), null);
  assert.equal(managed.current(second), null);
  assert.ok(!calls.some(args => args[0] === "volume"), "stopping never removes profiles");
  await managed.close();
});

test("host disabled until fully configured; permission store is strict and failures propagate", async () => {
  const disabled = createBrowserHost({
    env: {},
    docker: async () => {
      throw Error("must not invoke docker");
    },
  });
  assert.equal(await disabled.start(first), null);
  await disabled.close();
  let result = { data: null };
  const db = {
    from: table => {
      assert.equal(table, "cloud_gaming_permissions");
      return { select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) };
    },
  };
  const persisted = createCloudBrowserStore(db);
  assert.equal(await persisted.allowed(first), false);
  result = { data: { enabled: "true" } };
  assert.equal(await persisted.allowed(first), false);
  result = { data: { enabled: true } };
  assert.equal(await persisted.allowed(first), true);
  result = { error: Error("offline") };
  await assert.rejects(persisted.allowed(first));
});

test("navigation requires explicit access; proxy forwards no identity secrets", () => {
  const nav = fs.readFileSync("static/assets/js/m1.js", "utf8");
  const code = nav.slice(nav.indexOf("  function isRouteVisible("), nav.indexOf("  function renderShell("));
  for (const allowed of [undefined, false, "true", true]) assert.equal(vm.runInNewContext(`${code}; isRouteVisible({feature: 'cloudBrowser'})`, { platformConfig: { cloudBrowser: { allowed } } }), allowed === true);
  const headers = upstreamHeaders({ headers: { cookie: "private", authorization: "private", "x-forwarded-user": "private", accept: "text/html" } }, { port: 1234, password: "secret" });
  assert.equal(headers.cookie, undefined);
  assert.equal(headers["x-forwarded-user"], undefined);
  assert.equal(headers.accept, "text/html");
  assert.match(fs.readFileSync("supabase/NOVARIS_CLOUD_BROWSER_SCHEMA.sql", "utf8"), /revoke all[^;]+from public, anon, authenticated/);
  assert.equal(fs.existsSync("static/cloud-browser.html"), false);
});
