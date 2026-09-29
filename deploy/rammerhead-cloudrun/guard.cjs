const crypto = require("node:crypto");
const management = new Set(["/newsession", "/editsession", "/deletesession", "/sessionexists"]);
module.exports = function makeGuard(secret, ready) {
  const digest = value => crypto.createHash("sha256").update(value).digest();
  const expected = digest(secret);
  return function guard(req, res) {
    const url = new URL(req.url, "http://localhost");
    const key = req.headers["x-novaris-rh-key"];
    delete req.headers["x-novaris-rh-key"];
    const end = (status, body) => {
      if (typeof res.writeHead === "function") {
        res.writeHead(status, { "content-type": "text/plain", "cache-control": "no-store" });
        res.end(body);
      } else res.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return true;
    };
    if (url.pathname === "/healthz") return end(200, "ok");
    if (!ready) return end(503, "Set RH_PUBLIC_ORIGIN before using this service");
    if (management.has(url.pathname)) {
      if (req.headers.upgrade || req.method !== "GET" || typeof key !== "string" || !crypto.timingSafeEqual(digest(key), expected)) return end(403, "Forbidden");
      // The secret is added only inside the process, after Cloud Run access logging.
      url.searchParams.set("pwd", secret);
      req.url = url.pathname + url.search;
      res.setHeader("cache-control", "no-store");
    }
    if (url.pathname === "/garbageCollect") return end(404, "Not found");
  };
};
