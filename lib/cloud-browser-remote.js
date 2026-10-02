import http from "node:http";
import https from "node:https";

// Only the website knows this key. User IDs always come from its authenticated account.
export function createRemoteBrowserHost({ env = process.env, fetcher = fetch } = {}) {
  let endpoint;
  try {
    endpoint = new URL(env.CLOUD_BROWSER_HOST_URL);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") endpoint = null;
    else if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && ["127.0.0.1", "localhost"].includes(endpoint.hostname))) endpoint = null;
  } catch {
    /* Remain disabled until configured. */
  }
  const key = env.CLOUD_BROWSER_HOST_KEY || "";
  const configured = Boolean(env.CLOUD_BROWSER_ENABLED === "true" && endpoint && key.length >= 32);
  const headers = userId => ({ authorization: `Bearer ${key}`, "x-novaris-user": userId });
  async function rpc(userId, method = "GET", id = "") {
    if (!configured) throw new Error("Browser host is not configured.");
    const response = await fetcher(new URL(`/v1/session${id ? `/${encodeURIComponent(id)}` : ""}`, endpoint), {
      method,
      headers: headers(userId),
      redirect: "error",
      signal: AbortSignal.timeout(method === "POST" ? 90000 : 30000),
    });
    if (!response.ok) throw Object.assign(new Error(response.status === 429 ? "All cloud browsers are in use. Try again shortly." : "Browser host unavailable."), { status: response.status });
    return response.json();
  }
  return {
    remote: true,
    configured,
    async start(userId) {
      return (await rpc(userId, "POST")).session;
    },
    async current(userId) {
      return configured ? (await rpc(userId)).session : null;
    },
    async get(userId, id) {
      const session = configured ? (await rpc(userId)).session : null;
      return session?.id === id ? { ...session, userId, sockets: new Set() } : null;
    },
    async touch(userId, id) {
      return (await rpc(userId, "PUT", id)).active;
    },
    async stop(userId) {
      if (configured) await rpc(userId, "DELETE");
    },
    // Cloud Run instances come and go. Their shutdown must not stop other instances' users.
    async close() {},
    request(userId, path, method, forwarded, callback) {
      if (!configured) throw new Error("Browser host is not configured.");
      const safe = {};
      for (const name of ["accept", "accept-language", "range", "sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol", "upgrade", "connection"]) {
        if (forwarded[name]) safe[name] = forwarded[name];
      }
      return (endpoint.protocol === "https:" ? https : http).request(
        new URL(path, endpoint),
        {
          method,
          headers: { ...safe, ...headers(userId) },
          timeout: 15000,
        },
        callback,
      );
    },
  };
}
