import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import { test } from "node:test";
import vm from "node:vm";
import express from "express";
import { createRammerhead, registerRammerhead } from "../lib/rammerhead.js";

test("Cloud Run header authentication excludes secrets from request URLs and rejects unknown modes", async () => {
  const env = { RAMMERHEAD_API_URL: "https://backend.example", RAMMERHEAD_PUBLIC_URL: "https://backend.example", RAMMERHEAD_PASSWORD: "private-key", RAMMERHEAD_AUTH_MODE: "header" };
  const client = createRammerhead({
    env,
    fetcher: async (url, options) => {
      assert.equal(url.searchParams.has("pwd"), false);
      assert.equal(options.headers["x-novaris-rh-key"], "private-key");
      assert.equal(options.redirect, "error");
      return new Response(url.pathname === "/newsession" ? "a".repeat(32) : "Success");
    },
  });
  try {
    await client.launch("alice", "https://example.com", "https://novaris.example");
  } finally {
    client.close();
  }
  const invalid = createRammerhead({ env: { ...env, RAMMERHEAD_AUTH_MODE: "typo" } });
  assert.equal(invalid.configured, false);
  invalid.close();
});

test("Rammerhead allocates distinct sessions, deduplicates concurrent launches and keeps credentials server-side", async () => {
  const active = new Set();
  let created = 0;
  let now = 0;
  const backend = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    assert.equal(url.searchParams.get("pwd"), "private-key");
    assert.equal(req.headers.cookie, undefined);
    const id = url.searchParams.get("id");
    if (url.pathname === "/newsession") {
      const value = (++created).toString(16).padStart(32, "0");
      active.add(value);
      return res.end(value);
    }
    if (url.pathname === "/sessionexists") return res.end(active.has(id) ? "exists" : "not found");
    if (url.pathname === "/editsession") {
      assert.equal(url.searchParams.get("enableShuffling"), "0");
      return res.end("Success");
    }
    if (url.pathname === "/deletesession") {
      active.delete(id);
      return res.end("Success");
    }
    res.writeHead(404).end();
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const client = createRammerhead({ env: { RAMMERHEAD_API_URL: `http://127.0.0.1:${backend.address().port}`, RAMMERHEAD_PUBLIC_URL: "https://proxy.example", RAMMERHEAD_PASSWORD: "private-key" }, now: () => now });
  try {
    const [one, two] = await Promise.all([client.launch("alice", "https://example.com/?a=1#part", "https://novaris.example"), client.launch("alice", "https://example.org/", "https://novaris.example")]);
    assert.equal(created, 1);
    assert.equal(new URL(one.url).pathname.split("/")[1], new URL(two.url).pathname.split("/")[1]);
    assert.ok(one.url.endsWith("https://example.com/?a=1#part"));
    assert.ok(!JSON.stringify(one).includes("private-key"));
    await client.launch("bob", "https://example.com/", "https://novaris.example");
    assert.equal(created, 2);
    await assert.rejects(client.launch("alice", "javascript:alert(1)", "https://novaris.example"), /valid HTTP/);
    await assert.rejects(client.launch("alice", "https://example.com", "https://proxy.example"), /separate origin/);
    now = 13 * 60 * 60 * 1000;
    await client.sweep();
    assert.equal(active.size, 0);
    await client.launch("alice", "https://example.com/", "https://novaris.example");
    assert.equal(created, 3);
  } finally {
    client.close();
    backend.closeAllConnections();
    await new Promise(resolve => backend.close(resolve));
  }
});

test("launch API requires account authentication and same-origin JSON; ignores client-supplied user IDs", async () => {
  const app = express();
  app.use(express.json());
  let called;
  registerRammerhead(app, {
    requireApiAuth(req, res, next) {
      if (!req.headers["x-test-login"]) return res.sendStatus(401);
      req.auth = { user: { id: "trusted-user" } };
      next();
    },
    client: {
      async launch(...args) {
        called = args;
        return { url: "https://proxy.example/session/https://example.com/" };
      },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = headers => fetch(`${origin}/api/rammerhead/launch`, { method: "POST", headers, body: JSON.stringify({ url: "https://example.com/", userId: "victim" }) });
  try {
    assert.equal((await request({ "Content-Type": "application/json", Origin: origin })).status, 401);
    assert.equal((await request({ "Content-Type": "application/json", "x-test-login": "1", Origin: "https://attacker.example" })).status, 403);
    assert.equal((await request({ "Content-Type": "text/plain", "x-test-login": "1", Origin: origin })).status, 403);
    const response = await request({ "Content-Type": "application/json", "x-test-login": "1", Origin: origin });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(called, ["trusted-user", "https://example.com/", origin]);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("unconfigured or failed Rammerhead fails clearly without falling back silently", async () => {
  for (const env of [{}, { RAMMERHEAD_API_URL: "http://localhost:8081", RAMMERHEAD_PUBLIC_URL: "http://public.example", RAMMERHEAD_PASSWORD: "x" }]) {
    const client = createRammerhead({ env });
    try {
      assert.equal(client.configured, false);
      await assert.rejects(client.launch("user", "https://example.com", "https://novaris.example"), /not connected/);
    } finally {
      client.close();
    }
  }
  const client = createRammerhead({ env: { RAMMERHEAD_API_URL: "http://localhost:8081", RAMMERHEAD_PUBLIC_URL: "https://proxy.example", RAMMERHEAD_PASSWORD: "x" }, fetcher: async () => new Response("<html>incorrect backend</html>") });
  try {
    await assert.rejects(client.launch("user", "https://example.com", "https://novaris.example"), /Invalid Rammerhead session/);
  } finally {
    client.close();
  }
});

test("existing proxy controller selects Rammerhead, creates its iframe and leaves Scramjet/UV available", async () => {
  const values = new Map();
  const frames = [];
  const window = { dispatchEvent() {} };
  const context = vm.createContext({
    window,
    URL,
    location: { origin: "https://novaris.example" },
    CustomEvent: class {},
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
    document: { readyState: "loading", addEventListener() {}, querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, classList: { add() {} }, dataset: {}, remove() {} }) },
    fetch: async (route, options) => {
      assert.equal(route, "/api/rammerhead/launch");
      assert.equal(JSON.parse(options.body).url, "https://example.com/");
      return { ok: true, json: async () => ({ url: `https://proxy.example/${"a".repeat(32)}/https://example.com/`, origin: "https://proxy.example" }) };
    },
  });
  vm.runInContext(fs.readFileSync("static/assets/js/proxy-engine.js", "utf8"), context);
  window.FuzzProxy.setEngine("rammerhead", { sync: false });
  assert.equal(window.FuzzProxy.getEngine(), "rammerhead");
  const view = await window.FuzzProxy.createView({ appendChild: frame => frames.push(frame) }, "https://example.com/", "rammerhead");
  assert.equal(frames.length, 1);
  assert.equal(view.engine, "rammerhead");
  assert.equal(view.element.referrerPolicy, "no-referrer");
  assert.ok(window.FuzzProxy.engines.scramjet);
  assert.ok(window.FuzzProxy.engines.ultraviolet);
});
