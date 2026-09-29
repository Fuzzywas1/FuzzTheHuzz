const SESSION_ID = /^[a-f0-9]{32}$/;

function baseUrl(value, publicFacing = false) {
  if (!value) return null;
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || !["http:", "https:"].includes(url.protocol) || (publicFacing && url.protocol !== "https:" && !local)) throw new Error("Invalid Rammerhead origin");
  return url;
}

export function createRammerhead({ env = process.env, fetcher = fetch, now = Date.now } = {}) {
  let internal;
  let external;
  try {
    internal = baseUrl(env.RAMMERHEAD_API_URL);
    external = baseUrl(env.RAMMERHEAD_PUBLIC_URL, true);
  } catch {
    // Invalid optional configuration must not prevent the other engines starting.
  }
  const authMode = env.RAMMERHEAD_AUTH_MODE || "query";
  const configured = Boolean(internal && external && env.RAMMERHEAD_PASSWORD && ["header", "query"].includes(authMode));
  const sessions = new Map();
  const pending = new Map();
  const ttl = 12 * 60 * 60 * 1000;
  async function command(route, values = {}) {
    const url = new URL(route, internal);
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
    const headers = {};
    if (authMode === "header") headers["x-novaris-rh-key"] = env.RAMMERHEAD_PASSWORD;
    else url.searchParams.set("pwd", env.RAMMERHEAD_PASSWORD);
    const response = await fetcher(url, { headers, redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Rammerhead backend unavailable");
    const body = (await response.text()).trim();
    if (body.length > 1024) throw new Error("Invalid Rammerhead response");
    return body;
  }
  async function remove(userId) {
    const entry = sessions.get(userId);
    if (!entry) return;
    // Retain the mapping on failure so the next cleanup can retry.
    await command("/deletesession", { id: entry.id });
    sessions.delete(userId);
  }
  async function sweep() {
    for (const [userId, entry] of sessions) {
      if (entry.expires <= now() && !pending.has(userId)) await remove(userId).catch(() => {});
    }
  }
  async function launch(userId, value, websiteOrigin) {
    if (!configured) throw Object.assign(new Error("Rammerhead is not connected yet. See docs/RAMMERHEAD.md."), { status: 503 });
    if (external.origin === websiteOrigin) throw Object.assign(new Error("Rammerhead must use a separate origin from Novaris."), { status: 503 });
    let target;
    try {
      target = new URL(value);
      if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || target.href.length > 8192) throw new Error();
    } catch {
      throw Object.assign(new Error("Enter a valid HTTP or HTTPS address."), { status: 400 });
    }
    let operation = pending.get(userId);
    if (!operation) {
      operation = (async () => {
        await sweep();
        let entry = sessions.get(userId);
        if (entry && entry.expires <= now()) {
          await remove(userId);
          entry = null;
        }
        if (entry && (await command("/sessionexists", { id: entry.id })) !== "exists") {
          sessions.delete(userId);
          entry = null;
        }
        if (!entry) {
          if (sessions.size + pending.size >= 500) throw new Error("Session capacity reached");
          const id = await command("/newsession");
          if (!SESSION_ID.test(id)) throw new Error("Invalid Rammerhead session");
          try {
            if ((await command("/editsession", { id, enableShuffling: "0" })) !== "Success") throw new Error("Cannot configure session");
          } catch (error) {
            await command("/deletesession", { id }).catch(() => {});
            throw error;
          }
          entry = { id, expires: now() + ttl };
          sessions.set(userId, entry);
        }
        return entry;
      })();
      pending.set(userId, operation);
    }
    try {
      const entry = await operation;
      return { url: `${external.origin}/${entry.id}/${target.href}`, origin: external.origin };
    } finally {
      if (pending.get(userId) === operation) pending.delete(userId);
    }
  }
  const timer = setInterval(() => void sweep(), 60000);
  timer.unref();
  return {
    configured,
    launch,
    sweep,
    close() {
      clearInterval(timer);
    },
  };
}

export function registerRammerhead(app, { requireApiAuth, client = createRammerhead() }) {
  app.post("/api/rammerhead/launch", requireApiAuth, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const site = req.headers["sec-fetch-site"];
    const origin = `${req.protocol}://${req.get("host")}`;
    if (!req.is("application/json") || (site !== "same-origin" && (site || req.headers.origin !== origin))) return res.status(403).json({ error: "Use a same-origin JSON request." });
    try {
      return res.json(await client.launch(req.auth.user.id, req.body?.url, req.headers.origin || origin));
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.status ? error.message : "Rammerhead could not connect. Check its backend address and password, or try another engine." });
    }
  });
  return client;
}
