const fs = require("node:fs");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const file = "src/build.js";
const before = 'var w = window; while (w !== w.top && w.parent["%hammerhead"]) w = w.parent; return w;';
const after = 'var w = window; while (w !== w.top) { var p; try { p = w.parent; if (!p["%hammerhead"]) break; } catch (e) { break; } w = p; } return w;';
const source = fs.readFileSync(file, "utf8");
assert.equal(source.split(before).length, 2, "Pinned upstream bootstrap changed; review patch before building");
// A proxied iframe must stop at an inaccessible embedding page, not crash.
const foreign = new Proxy(
  {},
  {
    get() {
      throw new DOMException("Blocked cross-origin frame", "SecurityError");
    },
  },
);
const child = { parent: foreign, top: foreign };
assert.equal(vm.runInNewContext(`(function(){${after}})()`, { window: child }), child);
const parent = { parent: foreign, top: foreign, "%hammerhead": {} };
const nested = { parent, top: foreign };
assert.equal(vm.runInNewContext(`(function(){${after}})()`, { window: nested }), parent);
const top = {};
top.top = top;
top.parent = top;
assert.equal(vm.runInNewContext(`(function(){${after}})()`, { window: top }), top);
fs.writeFileSync(
  file,
  source.replace(before, () => after),
);
console.log("Cross-origin iframe bootstrap patch and 3 boundary tests passed.");
