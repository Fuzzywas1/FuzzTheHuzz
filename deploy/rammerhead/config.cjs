// Copy to config.js in the separate upstream Rammerhead checkout.
// These are the backend's environment variables, not browser-visible settings.
const origin = new URL(process.env.RH_PUBLIC_ORIGIN || "http://localhost:8090");
const crossPort = Number(process.env.RH_CROSS_DOMAIN_PORT || "8091");
if (!process.env.RAMMERHEAD_PASSWORD) throw new Error("Set a private RAMMERHEAD_PASSWORD before starting Rammerhead.");
if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || !Number.isInteger(crossPort) || crossPort < 1 || crossPort > 65535) throw new Error("Invalid Rammerhead public origin or cross-domain port.");
module.exports = {
  bindingAddress: "127.0.0.1",
  port: 8090,
  crossDomainPort: 8091,
  enableWorkers: false,
  publicDir: null,
  password: process.env.RAMMERHEAD_PASSWORD,
  restrictSessionToIP: false,
  logLevel: "warn",
  getServerInfo: () => ({ hostname: origin.hostname, port: Number(origin.port || (origin.protocol === "https:" ? 443 : 80)), crossDomainPort: crossPort, protocol: origin.protocol }),
};
