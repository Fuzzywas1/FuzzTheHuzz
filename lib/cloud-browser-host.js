import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { promisify } from "node:util";

const exec = promisify(execFile);
const LABEL = "com.novaris.cloud-browser";
export const streamPrefix = id => `/cloud-browser/stream/${id}/`;
export const profileVolume = userId => `novaris-browser-profile-${createHash("sha256").update(userId).digest("hex")}`;

export function createBrowserHost({ env = process.env, docker, fetcher = fetch, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const run = docker || (async args => (await exec("docker", args, { timeout: 45000, maxBuffer: 1024 * 1024 })).stdout.trim());
  const sessions = new Map();
  const pending = new Map();
  const stopping = new Map();
  const capacity = Math.max(1, Number.parseInt(env.CLOUD_BROWSER_MAX_SESSIONS || "2", 10) || 2);
  const idleMs = Math.max(60, Number.parseInt(env.CLOUD_BROWSER_IDLE_SECONDS || "180", 10) || 180) * 1000;
  const configured = env.CLOUD_BROWSER_ENABLED === "true" && /^lscr\.io\/linuxserver\/chromium@sha256:[a-f0-9]{64}$/.test(env.CLOUD_BROWSER_IMAGE || "") && env.CLOUD_BROWSER_NETWORK_READY === "true";
  let initialized;
  let closed = false;

  async function initialize() {
    // This deployment supports one Novaris process on one dedicated browser host.
    // Recover orphaned runtime containers after a crash; never delete profile volumes.
    const network = JSON.parse(await run(["network", "inspect", "novaris-browsers"]));
    if (network[0]?.Options?.["com.docker.network.bridge.enable_icc"] !== "false" || network[0]?.Options?.["com.docker.network.bridge.name"] !== "novaris-br") throw new Error("Browser network is not configured.");
    const old = await run(["ps", "-aq", "--filter", `label=${LABEL}=v1`]);
    const ids = old.split(/\s+/).filter(value => /^[a-f0-9]{12,64}$/.test(value));
    if (ids.length) await run(["rm", "-f", ...ids]);
  }
  function publicSession(session) {
    return { id: session.id, url: streamPrefix(session.id), persistentProfile: true };
  }
  async function start(userId) {
    if (!configured || closed) return null;
    if (stopping.has(userId)) await stopping.get(userId);
    if (pending.has(userId)) return pending.get(userId);
    if (sessions.has(userId)) {
      const session = sessions.get(userId);
      session.touched = now();
      return publicSession(session);
    }
    if (sessions.size + pending.size >= capacity) throw Object.assign(new Error("All cloud browsers are in use. Try again shortly."), { status: 429 });
    const operation = (async () => {
      if (!initialized)
        initialized = initialize().catch(error => {
          initialized = null;
          throw error;
        });
      await initialized;
      const id = randomUUID();
      const name = `novaris-browser-${id}`;
      const password = randomBytes(32).toString("hex");
      const session = { id, name, userId, password, port: 0, touched: now(), sockets: new Set() };
      try {
        const variables = {
          PUID: "1000",
          PGID: "1000",
          TZ: "Etc/UTC",
          TITLE: "Home",
          SUBFOLDER: streamPrefix(id),
          CUSTOM_USER: "novaris",
          PASSWORD: password,
          HARDEN_DESKTOP: "true",
          HARDEN_OPENBOX: "true",
          DISABLE_IPV6: "true",
          SELKIES_ENABLE_SHARING: "false",
          SELKIES_ENABLE_COLLAB: "false",
          SELKIES_FILE_TRANSFERS: "none",
          SELKIES_UI_SHOW_SIDEBAR: "false|locked",
          SELKIES_FRAMERATE: "30",
          CHROME_CLI: "https://www.google.com/",
        };
        await run([
          "run",
          "-d",
          "--rm",
          "--pull=never",
          "--name",
          name,
          "--label",
          `${LABEL}=v1`,
          "--network",
          "novaris-browsers",
          "--memory",
          "2g",
          "--memory-swap",
          "2g",
          "--cpus",
          "1",
          "--pids-limit",
          "512",
          "--shm-size",
          "1g",
          "--publish",
          "127.0.0.1::3000",
          "--mount",
          `type=volume,src=${profileVolume(userId)},dst=/config`,
          ...Object.entries(variables).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
          env.CLOUD_BROWSER_IMAGE,
        ]);
        const inspect = JSON.parse(await run(["inspect", name]));
        const binding = inspect[0]?.NetworkSettings?.Ports?.["3000/tcp"]?.[0];
        if (binding?.HostIp !== "127.0.0.1" || !/^\d+$/.test(binding?.HostPort || "")) throw new Error("Invalid browser port binding.");
        session.port = Number(binding.HostPort);
        let ready = false;
        for (let attempt = 0; attempt < 40; attempt++) {
          try {
            const response = await fetcher(`http://127.0.0.1:${session.port}${streamPrefix(id)}`, {
              headers: { Authorization: authorization(session) },
              signal: AbortSignal.timeout(1500),
              redirect: "manual",
            });
            await response.body?.cancel();
            if (response.ok) {
              ready = true;
              break;
            }
          } catch {
            /* The container is still starting. */
          }
          await pause(1000);
        }
        if (!ready || closed) throw new Error("Browser startup did not complete.");
        sessions.set(userId, session);
        return publicSession(session);
      } catch (error) {
        await run(["rm", "-f", name]).catch(() => {});
        throw error;
      }
    })();
    pending.set(userId, operation);
    try {
      return await operation;
    } finally {
      pending.delete(userId);
    }
  }
  async function stopRuntime(userId) {
    if (pending.has(userId)) await pending.get(userId).catch(() => {});
    const session = sessions.get(userId);
    if (!session) return;
    for (const socket of session.sockets) socket.destroy();
    // Keep the capacity slot reserved until Docker confirms removal.
    try {
      await run(["stop", "--time", "10", session.name]);
    } catch (error) {
      const remaining = await run(["ps", "-aq", "--filter", `name=^/${session.name}$`]);
      if (remaining.trim()) throw error;
    }
    sessions.delete(userId);
  }
  async function stop(userId) {
    if (stopping.has(userId)) return stopping.get(userId);
    const operation = stopRuntime(userId);
    stopping.set(userId, operation);
    try {
      await operation;
    } finally {
      stopping.delete(userId);
    }
  }
  function get(userId, id) {
    const session = sessions.get(userId);
    return session && session.id === id ? session : null;
  }
  async function sweep() {
    for (const session of sessions.values()) {
      if (now() - session.touched > idleMs) await stop(session.userId).catch(() => {});
    }
  }
  const timer = setInterval(() => {
    void sweep();
  }, 30000);
  timer.unref();
  return {
    configured,
    start,
    stop,
    get,
    publicSession,
    sweep,
    current(userId) {
      const session = sessions.get(userId);
      return session ? publicSession(session) : null;
    },
    touch(userId, id) {
      const session = get(userId, id);
      if (session) session.touched = now();
      return Boolean(session);
    },
    async close() {
      closed = true;
      clearInterval(timer);
      await Promise.allSettled([...new Set([...sessions.keys(), ...pending.keys()])].map(stop));
    },
  };
}

export function authorization(session) {
  return `Basic ${Buffer.from(`novaris:${session.password}`).toString("base64")}`;
}
