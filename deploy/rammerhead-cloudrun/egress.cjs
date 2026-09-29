// Applied before loading the proxy: both literal IPs and DNS results must be public.
const dns = require("node:dns");
const net = require("node:net");
const ipaddr = require("ipaddr.js");
function publicAddress(value) {
  try {
    const address = ipaddr.process(value);
    return address.range() === "unicast";
  } catch {
    return false;
  }
}
function install() {
  const lookup = dns.lookup;
  function guardedLookup(host, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    lookup(host, options, (error, address, family) => {
      if (error) return callback(error);
      const addresses = Array.isArray(address) ? address : [{ address }];
      if (!addresses.length || addresses.some(item => !publicAddress(item.address))) return callback(Object.assign(new Error("Private destination blocked"), { code: "EACCES" }));
      callback(null, address, family);
    });
  }
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    // Node passes normalized [options, callback] arrays internally as well.
    if (Array.isArray(args[0])) args = args[0];
    let options;
    let callback;
    if (typeof args[0] === "object") {
      options = { ...args[0] };
      callback = args[1];
    } else if (typeof args[0] === "number" || /^\d+$/.test(args[0])) {
      options = { port: args[0], host: typeof args[1] === "string" ? args[1] : "localhost" };
      callback = typeof args[1] === "function" ? args[1] : args[2];
    } else options = { path: args[0] };
    const host = options.host || "localhost";
    if (options.path || (net.isIP(host) && !publicAddress(host))) {
      process.nextTick(() => this.destroy(Object.assign(new Error("Private destination blocked"), { code: "EACCES" })));
      return this;
    }
    options.lookup = guardedLookup;
    return connect.call(this, options, callback);
  };
}
module.exports = { publicAddress, install };
