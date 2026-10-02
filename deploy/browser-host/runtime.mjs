import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { promisify } from "node:util";

const exec = promisify(execFile);
const LABEL = "com.novaris.neko-host=v1";
const NETWORK = "novaris-neko";
export const prefix = id => `/cloud-browser/stream/${id}/`;
export const volumeName = user => `novaris-neko-profile-${createHash("sha256").update(user).digest("hex")}`;
const publicSession = session => (session?.ready ? { id: session.id, url: prefix(session.id), provider: "neko", persistentProfile: true } : null);

export function createRuntime(config, { docker, fetcher = fetch, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!/^sha256:[a-f0-9]{64}$/.test(config.image || "")) throw new Error("Run Setup.ps1 to build and pin the browser image.");
  if (!isIP(config.mediaAddress || "")) throw new Error("mediaAddress must be your PC's LAN IP or public IP.");
  const capacity = config.maxSessions ?? 1;
  const firstPort = config.mediaPort ?? 57000;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4 || !Number.isInteger(firstPort) || firstPort < 1024 || firstPort + capacity > 65535) throw new Error("Invalid session limit or media port.");
  const run = docker || (async args => (await exec("docker", args, { timeout: 45000, maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim());
  const sessions = new Map();
  const pending = new Map();
  const stopping = new Map();
  const slots = new Set();
  let initialized;
  let closed = false;
  async function initialize() {
    let network;
    try {
      network = JSON.parse(await run(["network", "inspect", NETWORK]))[0];
    } catch {
      await run(["network", "create", "--driver", "bridge", "--opt", "com.docker.network.bridge.enable_icc=false", NETWORK]);
      network = JSON.parse(await run(["network", "inspect", NETWORK]))[0];
    }
    if (network?.Options?.["com.docker.network.bridge.enable_icc"] !== "false") throw new Error("Browser network must disable communication between containers.");
    const old = (await run(["ps", "-aq", "--filter", `label=${LABEL}`])).split(/\s+/).filter(id => /^[a-f0-9]{12,64}$/.test(id));
    if (old.length) await run(["rm", "-f", ...old]);
  }
  async function remove(session) {
    for (const socket of session.sockets) socket.destroy();
    session.ready = false;
    try {
      await run(["stop", "--time", "20", session.name]);
    } catch (error) {
      if ((await run(["ps", "-aq", "--filter", `name=^/${session.name}$`])).trim()) throw error;
    }
    sessions.delete(session.userId);
    slots.delete(session.slot);
  }
  async function stop(userId) {
    if (stopping.has(userId)) return stopping.get(userId);
    const operation = (async () => {
      if (pending.has(userId)) await pending.get(userId).catch(() => {});
      const session = sessions.get(userId);
      if (session) await remove(session);
    })();
    stopping.set(userId, operation);
    try {
      await operation;
    } finally {
      stopping.delete(userId);
    }
  }
  async function start(userId) {
    if (closed) throw new Error("Host is shutting down.");
    if (stopping.has(userId)) await stopping.get(userId);
    if (pending.has(userId)) return pending.get(userId);
    const existing = sessions.get(userId);
    if (existing?.ready) {
      existing.touched = now();
      return publicSession(existing);
    }
    if (existing) throw new Error("The previous browser is still stopping.");
    if (slots.size >= capacity) throw Object.assign(new Error("All browsers are in use."), { status: 429 });
    const slot = Array.from({ length: capacity }, (_, i) => i).find(i => !slots.has(i));
    slots.add(slot);
    const operation = (async () => {
      const id = randomUUID();
      const session = { id, slot, userId, name: `novaris-neko-${id}`, password: randomBytes(32).toString("hex"), sockets: new Set(), ready: false, touched: now() };
      let attempted = false;
      try {
        initialized ||= initialize().catch(error => {
          initialized = null;
          throw error;
        });
        await initialized;
        const port = firstPort + slot;
        const vars = {
          NEKO_SERVER_BIND: "0.0.0.0:8080",
          NEKO_SERVER_PATH_PREFIX: prefix(id).slice(0, -1),
          NEKO_SERVER_PROXY: "false",
          NEKO_SERVER_METRICS: "false",
          NEKO_LEGACY: "true",
          NEKO_FILETRANSFER_ENABLED: "false",
          NEKO_OPENINAPP_ENABLED: "false",
          NEKO_MEMBER_PROVIDER: "multiuser",
          NEKO_MEMBER_MULTIUSER_USER_PASSWORD: session.password,
          NEKO_MEMBER_MULTIUSER_ADMIN_PASSWORD: randomBytes(32).toString("hex"),
          NEKO_MEMBER_MULTIUSER_USER_PROFILE: JSON.stringify({ is_admin: false, can_login: true, can_connect: true, can_watch: true, can_host: true, can_share_media: false, can_access_clipboard: true }),
          NEKO_SESSION_COOKIE_ENABLED: "false",
          NEKO_SESSION_IMPLICIT_HOSTING: "true",
          NEKO_SESSION_CONTROL_PROTECTION: "false",
          NEKO_DESKTOP_SCREEN: "1280x720@30",
          NEKO_WEBRTC_UDPMUX: String(port),
          NEKO_WEBRTC_NAT1TO1: config.mediaAddress,
        };
        if (config.iceServersFrontend) vars.NEKO_WEBRTC_ICESERVERS_FRONTEND = JSON.stringify(config.iceServersFrontend);
        if (config.iceServersBackend) vars.NEKO_WEBRTC_ICESERVERS_BACKEND = JSON.stringify(config.iceServersBackend);
        attempted = true;
        sessions.set(userId, session);
        await run([
          "run",
          "-d",
          "--rm",
          "--pull=never",
          "--name",
          session.name,
          "--label",
          LABEL,
          "--network",
          NETWORK,
          "--memory",
          "3g",
          "--memory-swap",
          "3g",
          "--cpus",
          "2",
          "--pids-limit",
          "512",
          "--shm-size",
          "2g",
          "--security-opt",
          "no-new-privileges:true",
          "--publish",
          "127.0.0.1::8080",
          "--publish",
          `${port}:${port}/udp`,
          "--mount",
          `type=volume,src=${volumeName(userId)},dst=/home/neko/.config/chromium`,
          ...Object.entries(vars).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
          config.image,
        ]);
        const binding = JSON.parse(await run(["inspect", session.name]))[0]?.NetworkSettings?.Ports?.["8080/tcp"]?.[0];
        if (binding?.HostIp !== "127.0.0.1" || !/^\d+$/.test(binding?.HostPort || "")) throw new Error("Invalid browser HTTP binding.");
        session.port = Number(binding.HostPort);
        for (let i = 0; i < 40 && !closed; i++) {
          try {
            const response = await fetcher(`http://127.0.0.1:${session.port}${prefix(id)}`, { redirect: "manual", signal: AbortSignal.timeout(1000) });
            await response.body?.cancel();
            if (response.ok) {
              session.ready = true;
              session.touched = now();
              return publicSession(session);
            }
          } catch {
            /* Chromium and the streaming service are still starting. */
          }
          await pause(1000);
        }
        throw new Error("Browser did not become ready.");
      } catch (error) {
        // A failed removal keeps its slot reserved and is retried by the idle sweep.
        if (attempted) await remove(session).catch(() => {});
        else slots.delete(slot);
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
  function get(userId, id) {
    const session = sessions.get(userId);
    return session?.ready && session.id === id ? session : null;
  }
  async function sweep() {
    for (const s of sessions.values()) {
      if (!pending.has(s.userId) && (!s.ready || now() - s.touched > 180000)) await stop(s.userId).catch(() => {});
    }
  }
  const timer = setInterval(() => void sweep(), 15000);
  timer.unref();
  return {
    start,
    stop,
    get,
    sweep,
    current(userId) {
      return publicSession(sessions.get(userId));
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
