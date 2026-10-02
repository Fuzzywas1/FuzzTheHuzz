import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import { createRuntime, volumeName } from "../deploy/browser-host/runtime.mjs";
import { createHostServer } from "../deploy/browser-host/server.mjs";
import { registerCloudBrowser } from "../lib/cloud-browser.js";
import { createRemoteBrowserHost } from "../lib/cloud-browser-remote.js";

const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
const c = "00000000-0000-4000-8000-000000000003";
const config = { image: `sha256:${"a".repeat(64)}`, mediaAddress: "127.0.0.1", maxSessions: 2 };
const key = "test-host-key-".repeat(4);
const network = JSON.stringify([{ Options: { "com.docker.network.bridge.enable_icc": "false" } }]);
const inspect = port => JSON.stringify([{ NetworkSettings: { Ports: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: String(port) }] } } }]);
const listen = async server => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
};
const close = server =>
  new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  });

test("Neko runtime isolates users, reserves unique UDP ports, reuses profiles, and expires leases", async () => {
  const calls = [];
  let time = 0;
  let stopFails = false;
  const runtime = createRuntime(config, {
    now: () => time,
    fetcher: async () => new Response("ready"),
    docker: async args => {
      calls.push(args);
      if (args[0] === "network") return network;
      if (args[0] === "inspect") return inspect(41000);
      if (args[0] === "stop" && stopFails) throw Error("Docker temporarily unavailable");
      if (args[0] === "ps" && stopFails) return "a".repeat(64);
      return "";
    },
  });
  try {
    const [first, same] = await Promise.all([runtime.start(a), runtime.start(a)]);
    assert.equal(first.id, same.id);
    const second = await runtime.start(b);
    assert.notEqual(first.id, second.id);
    assert.equal(runtime.get(b, first.id), null);
    assert.equal(runtime.touch(b, first.id), false);
    await assert.rejects(runtime.start(c), error => error.status === 429);
    const runs = calls.filter(args => args[0] === "run");
    assert.equal(runs.length, 2);
    assert.ok(runs[0].includes("57000:57000/udp"));
    assert.ok(runs[1].includes("57001:57001/udp"));
    assert.notEqual(volumeName(a), volumeName(b));
    for (const args of runs) {
      assert.ok(args.includes("127.0.0.1::8080"));
      assert.ok(args.includes("--pull=never"));
      assert.ok(args.includes("NEKO_SESSION_COOKIE_ENABLED=false"));
      assert.ok(!args.includes("--privileged"));
      assert.ok(!args.some(value => value.includes("docker.sock")));
    }
    stopFails = true;
    await assert.rejects(runtime.stop(a));
    await assert.rejects(runtime.start(c), error => error.status === 429);
    assert.equal(runtime.current(a), null, "stopping sessions cannot be reattached");
    stopFails = false;
    await Promise.all([runtime.stop(a), runtime.stop(a)]);
    const restarted = await runtime.start(a);
    assert.notEqual(restarted.id, first.id);
    const lastRun = calls.filter(args => args[0] === "run").at(-1);
    assert.equal(lastRun[lastRun.indexOf("--mount") + 1], runs[0][runs[0].indexOf("--mount") + 1]);
    time = 180001;
    await runtime.sweep();
    assert.equal(runtime.current(a), null);
    assert.equal(runtime.current(b), null);
    assert.ok(!calls.some(args => args[0] === "volume"), "stopping does not delete profiles");
  } finally {
    await runtime.close();
  }
});

test("failed starts clean up; failed cleanup retains capacity until Docker confirms removal", async () => {
  let failing = true;
  const runtime = createRuntime(
    { ...config, maxSessions: 1 },
    {
      docker: async args => {
        if (args[0] === "network") return network;
        if (args[0] === "run") throw Error("startup failed after container creation");
        if (args[0] === "stop" && failing) throw Error("cannot stop");
        if (args[0] === "ps" && args.at(-1).startsWith("name=") && failing) return "a".repeat(64);
        return "";
      },
    },
  );
  try {
    await assert.rejects(runtime.start(a));
    await assert.rejects(runtime.start(b), error => error.status === 429);
    failing = false;
    await runtime.sweep();
    await assert.rejects(runtime.start(b), error => error.status !== 429);
  } finally {
    await runtime.close();
  }
});

test("website → host → Neko enforces identity, strips secrets, proxies WS and stops revoked WebRTC sessions", async () => {
  const received = [];
  const worker = http.createServer((req, res) => {
    received.push({ url: req.url, headers: req.headers });
    res.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": "neko-secret=private; Path=/" });
    res.end("<title>Neko</title><p>Streaming client fixture</p>");
  });
  const workerWs = new WebSocketServer({ server: worker });
  workerWs.on("connection", (socket, req) => {
    received.push({ url: req.url, headers: req.headers });
    socket.on("message", data => socket.send(data));
  });
  await listen(worker);
  const stops = [];
  const runtime = createRuntime(config, {
    fetcher: async () => new Response("ready"),
    docker: async args => {
      if (args[0] === "network") return network;
      if (args[0] === "inspect") return inspect(worker.address().port);
      if (args[0] === "stop") stops.push(args.at(-1));
      return "";
    },
  });
  const agent = createHostServer({ key, runtime });
  const endpoint = await listen(agent);
  const remote = createRemoteBrowserHost({ env: { CLOUD_BROWSER_ENABLED: "true", CLOUD_BROWSER_HOST_URL: endpoint, CLOUD_BROWSER_HOST_KEY: key } });
  const allowed = new Set([a, b]);
  const auth = req => (req.headers["x-test-user"] ? { user: { id: req.headers["x-test-user"] } } : null);
  const gate = (req, res, next) => {
    req.auth = auth(req);
    return req.auth ? next() : res.sendStatus(401);
  };
  const app = express();
  app.use(express.json());
  const website = http.createServer(app);
  const origin = await listen(website);
  const routes = registerCloudBrowser(app, { host: remote, publicOrigin: origin, store: { allowed: async id => allowed.has(id) }, requirePageAuth: gate, requireApiAuth: gate, requireRole: () => gate, authenticateStream: async req => auth(req), recheckMs: 20 });
  website.on("upgrade", (req, socket, head) => void routes.upgrade(req, socket, head));
  const request = (route, userId = a, method = "GET") => fetch(origin + route, { method, headers: { "x-test-user": userId, Origin: origin, "Content-Type": "application/json", cookie: "novaris-account=PRIVATE", "x-novaris-user": b, authorization: "Bearer private-user-token" } });
  let socket;
  try {
    assert.equal((await fetch(`${endpoint}/v1/session`)).status, 401);
    assert.equal((await fetch(`${endpoint}/v1/session`, { headers: { authorization: `Bearer ${key}`, "x-novaris-user": "../../owner" } })).status, 401);
    const response = await request("/api/cloud-browser/sessions", a, "POST");
    assert.equal(response.status, 201);
    const { session } = await response.json();
    assert.equal(session.provider, "neko");
    assert.equal(runtime.current(b), null, "spoofed forwarded user is ignored");
    assert.equal((await request(session.url, b)).status, 404);
    const page = await request(session.url);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("set-cookie"), null);
    assert.match(await page.text(), /<title>Home<\/title>/);
    assert.equal(received.at(-1).headers.cookie, undefined);
    assert.equal(received.at(-1).headers.authorization, undefined);
    assert.equal((await request(`${session.url}api/admin`)).status, 403);
    assert.equal((await request(`${session.url}api/login`, a, "POST")).status, 405);
    const anotherInstance = createRemoteBrowserHost({ env: { CLOUD_BROWSER_ENABLED: "true", CLOUD_BROWSER_HOST_URL: endpoint, CLOUD_BROWSER_HOST_KEY: key } });
    assert.equal((await anotherInstance.current(a)).id, session.id, "Cloud Run instances share host state");
    await anotherInstance.close();
    assert.ok(runtime.current(a), "Cloud Run shutdown does not stop browser users");
    const impostor = new WebSocket(`${origin.replace("http:", "ws:") + session.url}ws`, { headers: { origin, "x-test-user": b } });
    await assert.rejects(once(impostor, "open"));
    socket = new WebSocket(`${origin.replace("http:", "ws:") + session.url}ws?password=forged`, { headers: { origin, "x-test-user": a, cookie: "PRIVATE" } });
    await once(socket, "open");
    const echo = once(socket, "message");
    socket.send("input-event");
    assert.equal((await echo)[0].toString(), "input-event");
    const wsRequest = received.at(-1);
    assert.equal(wsRequest.headers.cookie, undefined);
    assert.equal(wsRequest.headers.authorization, undefined);
    assert.equal(new URL(wsRequest.url, endpoint).searchParams.get("password"), runtime.get(a, session.id).password);
    const ended = once(socket, "close");
    allowed.delete(a);
    await ended;
    for (let i = 0; i < 50 && runtime.current(a); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(runtime.current(a), null);
    assert.equal(stops.length, 1, "revocation stops the container, not just the socket");
    assert.equal((await request(session.url)).status, 403);
  } finally {
    socket?.terminate();
    await runtime.close();
    workerWs.close();
    await Promise.all([close(website), close(agent), close(worker)]);
  }
});

test("remote host rejects insecure or malformed endpoints and stays disabled without a key", () => {
  for (const endpoint of ["http://example.com", "https://user:password@example.com", "https://example.com/path", "https://example.com/?key=value"]) {
    const host = createRemoteBrowserHost({ env: { CLOUD_BROWSER_ENABLED: "true", CLOUD_BROWSER_HOST_URL: endpoint, CLOUD_BROWSER_HOST_KEY: key } });
    assert.equal(host.configured, false);
  }
  assert.equal(createRemoteBrowserHost({ env: {} }).configured, false);
});
