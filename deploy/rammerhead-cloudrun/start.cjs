require("./egress.cjs").install();
require("node:fs").mkdirSync(require("node:path").join(__dirname, "cache-js"), { recursive: true });
// Single-process startup avoids the upstream clustering dependencies entirely.
const config = require("./src/config");
require("node:fs").mkdirSync(config.fileCacheSessionConfig.saveDirectory, { recursive: true });
const RammerheadProxy = require("./src/classes/RammerheadProxy");
const Store = require("./src/classes/RammerheadSessionFileCache");
const Logger = require("./src/classes/RammerheadLogging");
// Upstream's disabled level still emits logs; use an explicit silent sink.
const logger = new Logger({ logLevel: "disabled", logger: () => {} });
const proxy = new RammerheadProxy({ ...config, logger });
const store = new Store({ ...config.fileCacheSessionConfig, logger });
store.attachToProxy(proxy);
require("./src/server/setupPipeline")(proxy, store);
require("./src/server/setupRoutes")(proxy, store, logger);
const guard = require("./guard.cjs")(process.env.RAMMERHEAD_PASSWORD, Boolean(process.env.RH_PUBLIC_ORIGIN));
proxy.addToOnRequestPipeline(guard);
proxy.addToOnUpgradePipeline(guard);
process.on("SIGTERM", () => {
  proxy.close();
  process.exit(0);
});
