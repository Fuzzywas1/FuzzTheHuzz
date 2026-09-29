const RammerheadJSMemCache = require("./src/classes/RammerheadJSMemCache");
const port = Number(process.env.PORT || 8080);
const origin = new URL(process.env.RH_PUBLIC_ORIGIN || "https://setup.invalid");
if (!process.env.RAMMERHEAD_PASSWORD || process.env.RAMMERHEAD_PASSWORD.length < 32) throw new Error("Set RAMMERHEAD_PASSWORD to a random secret of at least 32 characters");
if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Invalid RH_PUBLIC_ORIGIN");
module.exports = {
  bindingAddress: "0.0.0.0",
  port,
  crossDomainPort: null,
  enableWorkers: false,
  publicDir: null,
  logLevel: "disabled",
  password: process.env.RAMMERHEAD_PASSWORD,
  restrictSessionToIP: false,
  jsCache: new RammerheadJSMemCache(32 * 1024 * 1024),
  disableHttp2: true,
  stripClientHeaders: ["x-novaris-rh-key", "metadata-flavor", "x-google-metadata-request", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "x-cloud-trace-context"],
  getServerInfo: () => ({ hostname: origin.hostname, port: Number(origin.port || 443), crossDomainPort: Number(origin.port || 443), protocol: "https:" }),
  fileCacheSessionConfig: {
    saveDirectory: require("node:path").join(require("node:os").tmpdir(), "rh-sessions"),
    cacheTimeout: 600000,
    cacheCheckInterval: 60000,
    deleteUnused: true,
    deleteCorruptedSessions: true,
    staleCleanupOptions: { staleTimeout: 43200000, maxToLive: 43200000, staleCheckInterval: 60000 },
  },
};
