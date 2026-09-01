import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const staticRoot = path.join(root, "static");
const failures = [];
const warnings = [];
const checked = {
  javascript: 0,
  html: 0,
  localAssets: 0,
};

const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
]);

function walk(directory) {
  const entries = fs.readdirSync(directory, {
    withFileTypes: true,
  });
  const files = [];

  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else files.push(fullPath);
  }

  return files;
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function stripQueryAndHash(value) {
  return String(value || "").split(/[?#]/, 1)[0];
}

const requiredFiles = [
  "index.js",
  "lib/supabaseAdmin.js",
  "static/index.html",
  "static/login.html",
  "static/apps.html",
  "static/tabs.html",
  "static/ai.html",
  "static/cloud.html",
  "static/chat.html",
  "static/feedback.html",
  "static/settings.html",
  "static/account.html",
  "static/admin.html",
  "static/sw.js",
  "static/scramjet-sw.js",
  "static/assets/js/login.js",
  "static/assets/js/ai.js",
  "static/assets/js/cloud.js",
  "static/assets/js/chat.js",
  "static/assets/js/feedback.js",
  "static/assets/js/settings.js",
  "static/assets/js/m1.js",
  "static/assets/js/c1.js",
  "static/assets/js/t3.js",
  "supabase/FUZZ_STABILITY_SCHEMA.sql",
  "supabase/FUZZ_CLOUD_SCHEMA.sql",
  "supabase/FUZZ_6_COMMUNITY_SCHEMA.sql",
];

for (const required of requiredFiles) {
  if (!fs.existsSync(path.join(root, required))) {
    fail(`Missing required file: ${required}`);
  }
}

if (fs.existsSync(path.join(root, ".env"))) {
  warn("A local .env file exists. It must not be included in a release ZIP or committed to Git.");
}

const allFiles = walk(root);
const sourceJavaScript = allFiles.filter((filePath) => {
  if (!filePath.endsWith(".js") && !filePath.endsWith(".mjs")) return false;
  const rel = relative(filePath);
  // Vendored browser runtimes are validated by their package/build process.
  return !rel.startsWith("static/assets/mathematics/") &&
    !rel.startsWith("static/assets/history/");
});

for (const filePath of sourceJavaScript) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    encoding: "utf8",
  });
  checked.javascript += 1;
  if (result.status !== 0) {
    fail(`JavaScript syntax failed in ${relative(filePath)}: ${String(result.stderr || result.stdout).trim()}`);
  }
}

const htmlFiles = allFiles.filter((filePath) => filePath.endsWith(".html"));
const localAssetPattern = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
const idPattern = /\bid\s*=\s*["']([^"']+)["']/gi;

const routeOnlyPaths = new Set([
  "/",
  "/a",
  "/b",
  "/c",
  "/settings",
  "/d",
  "/p",
  "/ai",
  "/cloud",
  "/chat",
  "/feedback",
  "/account",
  "/admin",
  "/status",
  "/login",
  "/signup",
  "/verified",
  "/suspended",
  "/maintenance",
  "/feature-unavailable",
  "/play.html",
]);

const dynamicAssetPrefixes = [
  "/baremux/",
  "/scram/",
  "/libcurl/",
  "/ca/",
  "/wisp/",
];

for (const htmlPath of htmlFiles) {
  const html = fs.readFileSync(htmlPath, "utf8");
  checked.html += 1;

  if (html.includes("/assets/js/m1.js")) {
    if (!/class=["'][^"']*\bf-nav\b[^"']*["']/.test(html)) {
      fail(`The universal sidebar script is loaded without a .f-nav mount in ${relative(htmlPath)}`);
    }
    if (!html.includes("/assets/css/nav.css")) {
      fail(`The universal sidebar script is loaded without nav.css in ${relative(htmlPath)}`);
    }
  }

  const seenIds = new Set();
  for (const match of html.matchAll(idPattern)) {
    const id = match[1];
    if (seenIds.has(id)) {
      fail(`Duplicate HTML id "${id}" in ${relative(htmlPath)}`);
    }
    seenIds.add(id);
  }

  for (const match of html.matchAll(localAssetPattern)) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("data:") || raw.startsWith("blob:")) continue;
    if (/^(?:https?:)?\/\//i.test(raw)) continue;

    const cleaned = stripQueryAndHash(raw);
    if (!cleaned || routeOnlyPaths.has(cleaned)) continue;
    if (dynamicAssetPrefixes.some((prefix) => cleaned.startsWith(prefix))) continue;

    let target;
    if (cleaned.startsWith("/")) {
      target = path.join(staticRoot, cleaned.slice(1));
    } else {
      target = path.resolve(path.dirname(htmlPath), cleaned);
    }

    // Only treat references with a file extension as static assets. Extensionless
    // links are application routes and are validated in index.js instead.
    if (!path.extname(cleaned)) continue;
    checked.localAssets += 1;
    if (!fs.existsSync(target)) {
      fail(`Missing local asset referenced by ${relative(htmlPath)}: ${raw}`);
    }
  }
}

const forbiddenSourcePatterns = [
  ["3nbf4.com", "legacy ad service-worker domain"],
  ["nap5k.com", "legacy ad script domain"],
  ["gizokraijaw.net", "legacy ad script domain"],
  ["googletagmanager.com", "unexpected analytics tracker"],
  ["google-analytics.com", "unexpected analytics tracker"],
];

for (const filePath of allFiles) {
  const rel = relative(filePath);
  if (rel.startsWith("docs/") || rel.startsWith("supabase/") || rel === "scripts/audit-project.mjs") continue;
  if (!/\.(?:js|mjs|html|css|json)$/i.test(filePath)) continue;

  const content = fs.readFileSync(filePath, "utf8");
  for (const [needle, description] of forbiddenSourcePatterns) {
    if (content.includes(needle)) {
      fail(`${description} remains in ${rel}: ${needle}`);
    }
  }
}

const browserSourceFiles = allFiles.filter((filePath) => {
  const rel = relative(filePath);
  return rel.startsWith("static/") && /\.(?:js|html)$/i.test(filePath);
});

const jwtLike = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
for (const filePath of browserSourceFiles) {
  const content = fs.readFileSync(filePath, "utf8");
  if (jwtLike.test(content)) {
    fail(`A JWT-like secret is embedded in browser-delivered source: ${relative(filePath)}`);
  }
}

const indexSource = fs.existsSync(path.join(root, "index.js"))
  ? fs.readFileSync(path.join(root, "index.js"), "utf8")
  : "";

const requiredServerMarkers = [
  'app.get("/api/auth/status"',
  'app.post("/api/auth/login"',
  'app.post("/api/auth/logout"',
  'app.post("/api/auth/signup"',
  '"/api/ai/chats"',
  '"/api/ai/chat"',
  '"/api/cloud/config"',
  '"/api/apps/state"',
  '"/api/bookmarks"',
  '"fuzz_consume_usage"',
  '"/api/chat/bootstrap"',
  '"/api/chat/dms"',
  '"/api/personalization"',
  '"/api/feedback"',
  '"/api/admin/feedback"',
  '"/api/chat/blocks"',
  '"/api/admin/chat/reports"',
  '"/api/notifications"',
];

for (const marker of requiredServerMarkers) {
  if (!indexSource.includes(marker)) {
    fail(`Required server route or integration marker is missing: ${marker}`);
  }
}

const htmlHookChecks = [
  ["static/login.html", ["login-form", "email", "password", "login-button", "auth-message"]],
  ["static/ai.html", ["chat-form", "chat-input", "new-chat-button", "chat-list", "chat-messages"]],
  ["static/cloud.html", ["cloud-device-name", "cloud-status", "cloud-launch", "cloud-message"]],
  ["static/apps.html", ["app-search", "app-sort", "all-apps", "app-modal-root"]],
  ["static/index.html", ["fv", "input", "home-bookmarks", "home-recents"]],
  ["static/chat.html", ["conversation-list", "message-list", "message-form", "message-input", "chat-reports-button"]],
  ["static/feedback.html", ["feedback-list", "open-feedback-form", "feedback-modal-root"]],
  ["static/assets/js/account.js", ["wallpaper-file", "accent-color", "save-settings", "blocked-users-list"]],
];

for (const [file, ids] of htmlHookChecks) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) continue;
  const content = fs.readFileSync(fullPath, "utf8");
  for (const id of ids) {
    if (!new RegExp(`\\bid=["']${id}["']`).test(content)) {
      fail(`Required DOM hook #${id} is missing from ${file}`);
    }
  }
}

console.log("Novaris project audit");
console.log(`  JavaScript files checked: ${checked.javascript}`);
console.log(`  HTML files checked:       ${checked.html}`);
console.log(`  Local asset references:   ${checked.localAssets}`);

for (const message of warnings) {
  console.warn(`WARN: ${message}`);
}

const requiredProjectFiles = [
  ".env.example",
  "index.js",
  "package.json",
  "lib/supabaseAdmin.js",
  "static/index.html",
  "static/login.html",
  "static/assets/js/m1.js",
  "static/assets/js/cloud.js",
];

for (const relativePath of requiredProjectFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    fail(`Missing required project file: ${relativePath}`);
  }
}

const cloudClientPath = path.join(root, "static", "assets", "js", "cloud.js");
if (fs.existsSync(cloudClientPath)) {
  const cloudClientSource = fs.readFileSync(cloudClientPath, "utf8");
  if (/const\s+(?:GUACAMOLE|NOVNC)_URL\s*=/.test(cloudClientSource)) {
    fail("Novaris Cloud client contains a hardcoded remote-desktop URL; use /api/cloud/config instead.");
  }
}

if (failures.length > 0) {
  console.error(`\nAudit failed with ${failures.length} problem(s):`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log("\nAudit passed.");
