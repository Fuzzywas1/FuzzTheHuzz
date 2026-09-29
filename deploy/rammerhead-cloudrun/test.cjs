const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const makeGuard = require("./guard.cjs");
const { publicAddress } = require("./egress.cjs");
test("management requires a header secret, never accepts query-only authentication", () => {
  const guard = makeGuard("test-key", true);
  for (const path of ["newsession", "editsession", "deletesession", "sessionexists"]) {
    const res = {
      writeHead(code) {
        this.status = code;
      },
      end() {},
      setHeader() {},
    };
    assert.equal(guard({ url: `/${path}?pwd=test-key`, method: "GET", headers: {} }, res), true);
    assert.equal(res.status, 403);
    const req = { url: `/${path}`, method: "GET", headers: { "x-novaris-rh-key": "test-key" } };
    assert.equal(guard(req, res), undefined);
    assert.equal(req.headers["x-novaris-rh-key"], undefined);
    assert.equal(new URL(req.url, "http://localhost").searchParams.get("pwd"), "test-key");
  }
});
test("bootstrap refuses requests except health; websocket rejection uses socket response", () => {
  const guard = makeGuard("test-key", false);
  let status;
  const res = {
    writeHead(code) {
      status = code;
    },
    end() {},
  };
  guard({ url: "/newsession", headers: {} }, res);
  assert.equal(status, 503);
  guard({ url: "/healthz", headers: {} }, res);
  assert.equal(status, 200);
  let raw;
  makeGuard("test-key", true)(
    { url: "/newsession", method: "GET", headers: { upgrade: "websocket", "x-novaris-rh-key": "test-key" } },
    {
      end(value) {
        raw = value;
      },
    },
  );
  assert.match(raw, /403/);
});
test("egress rejects private, metadata, mapped IPv6 and special addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.100.100.200", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:169.254.169.254", "224.0.0.1", "2001:db8::1"]) assert.equal(publicAddress(address), false, address);
  for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) assert.equal(publicAddress(address), true, address);
});
test("socket guard blocks literal and DNS-resolved loopback connections", () => {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
    require('./egress.cjs').install();
    const net=require('net');
    Promise.all(['127.0.0.1','localhost','::ffff:127.0.0.1'].map(host=>new Promise((resolve,reject)=>{
      const socket=net.connect({host,port:80});
      socket.on('connect',()=>reject(new Error('Guard bypassed')));
      socket.on('error',err=>err.code==='EACCES'?resolve():reject(err));
    }))).then(()=>process.exit(0)).catch(err=>{console.error(err);process.exit(1)});
  `,
    ],
    { cwd: __dirname, encoding: "utf8", timeout: 10000 },
  );
  assert.equal(result.status, 0, result.stderr);
});
