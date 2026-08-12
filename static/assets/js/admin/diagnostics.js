import { api } from "./api.js";
import {
  emptyState,
  errorState,
  loadingState,
  panel,
} from "./components.js";
import { escapeHtml, formatUptime } from "./utils.js";

function statusBadge(ok, good = "Ready", bad = "Needs attention") {
  return `<span class="badge ${ok ? "badge-success" : "badge-warning"}">${escapeHtml(
    ok ? good : bad,
  )}</span>`;
}

function settingsRows(items) {
  return `<div class="settings-list">${items
    .map(
      ([name, ok, detail = "", good = "Ready", bad = "Missing"]) => `
        <div class="setting-row diagnostics-setting-row">
          <div class="setting-copy">
            <strong>${escapeHtml(name)}</strong>
            ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
          </div>
          ${statusBadge(Boolean(ok), good, bad)}
        </div>`,
    )
    .join("")}</div>`;
}

function findings(items, tone = "warning") {
  if (!items.length) {
    return emptyState(
      "Nothing to report",
      tone === "warning"
        ? "No warnings were returned by the diagnostics check."
        : "No deployment issues were found.",
    );
  }

  return `<div class="diagnostics-findings">${items
    .map(
      (item) => `
        <article class="diagnostics-finding diagnostics-finding-${escapeHtml(tone)}">
          <span class="diagnostics-finding-icon">${tone === "warning" ? "!" : "×"}</span>
          <div>
            <strong>${tone === "warning" ? "Warning" : "Action required"}</strong>
            <p>${escapeHtml(item)}</p>
          </div>
        </article>`,
    )
    .join("")}</div>`;
}

function databaseRows(checks) {
  if (!checks.length) {
    return emptyState(
      "No database checks returned",
      "The diagnostics endpoint returned no schema results.",
    );
  }

  return `<div class="settings-list">${checks
    .map(
      (check) => `
        <div class="setting-row diagnostics-setting-row">
          <div class="setting-copy">
            <strong>${escapeHtml(check.name)}</strong>
            <span>${escapeHtml(check.message || "")}${Number.isFinite(check.durationMs) ? ` · ${escapeHtml(String(check.durationMs))} ms` : ""}</span>
          </div>
          ${statusBadge(Boolean(check.ok))}
        </div>`,
    )
    .join("")}</div>`;
}

export async function renderDiagnostics(container) {
  container.innerHTML = loadingState("Running deployment diagnostics...");

  try {
    const payload = await api.diagnostics();
    const env = payload.environment || {};
    const files = payload.files || {};
    const cloud = payload.cloud || {};
    const runtime = payload.runtime || {};
    const database = payload.database || {};
    const tables = database.checks || [];
    const warnings = payload.warnings || [];
    const issues = payload.issues || [];
    const checkedAt = payload.checkedAt ? new Date(payload.checkedAt) : new Date();

    container.innerHTML = `
      <div class="page-section diagnostics-page">
        <div class="diagnostics-toolbar">
          <div>
            <strong>${payload.ok ? "Deployment looks healthy" : "Deployment needs attention"}</strong>
            <span>Checked ${escapeHtml(checkedAt.toLocaleString())}${Number.isFinite(payload.durationMs) ? ` · ${escapeHtml(String(payload.durationMs))} ms` : ""}</span>
          </div>
          <button class="button button-secondary" type="button" data-action="rerun-diagnostics">Run again</button>
        </div>

        <section class="stat-grid">
          <article class="stat-card">
            <div class="stat-header"><span class="stat-label">Audit status</span><span class="stat-icon">${payload.ok ? "✓" : "!"}</span></div>
            <strong class="stat-value diagnostics-status-value">${payload.ok ? "Ready" : "Review"}</strong>
            <div class="stat-footer"><span>Fuzz ${escapeHtml(payload.version || "")}</span></div>
          </article>
          <article class="stat-card">
            <div class="stat-header"><span class="stat-label">Database</span><span class="stat-icon">◆</span></div>
            <strong class="stat-value">${escapeHtml(String(database.passed ?? tables.filter((item) => item.ok).length))}/${escapeHtml(String(database.total ?? tables.length))}</strong>
            <div class="stat-footer"><span>Core tables ready</span></div>
          </article>
          <article class="stat-card">
            <div class="stat-header"><span class="stat-label">Fuzz Cloud</span><span class="stat-icon">▣</span></div>
            <strong class="stat-value diagnostics-status-value">${cloud.configured ? "Ready" : "Setup"}</strong>
            <div class="stat-footer"><span>${escapeHtml(cloud.host || "No gateway host")}</span></div>
          </article>
          <article class="stat-card">
            <div class="stat-header"><span class="stat-label">Findings</span><span class="stat-icon">!</span></div>
            <strong class="stat-value">${issues.length + warnings.length}</strong>
            <div class="stat-footer"><span>${issues.length} issues · ${warnings.length} warnings</span></div>
          </article>
        </section>

        <section class="dashboard-grid">
          ${panel({
            title: "Environment",
            subtitle: "Presence only — secret values are never returned",
            body: settingsRows([
              ["Supabase URL", env.supabaseUrl],
              ["Supabase anon key", env.supabaseAnonKey],
              ["Supabase server key", env.supabaseServerKey],
              ["OpenAI API key", env.openaiApiKey, `Model: ${env.openaiModel || "default"}`, "Configured", "Optional"],
            ]),
          })}
          ${panel({
            title: "Runtime",
            subtitle: "Current server process",
            body: settingsRows([
              ["Node.js", Boolean(runtime.node), runtime.node || "Unknown", runtime.node || "Ready", "Unknown"],
              ["Platform", Boolean(runtime.platform), runtime.platform || "Unknown", runtime.platform || "Ready", "Unknown"],
              ["Uptime", Number.isFinite(runtime.uptimeSeconds), Number.isFinite(runtime.uptimeSeconds) ? formatUptime(runtime.uptimeSeconds) : "Unknown", "Running", "Unknown"],
              ["Memory", Number.isFinite(runtime.memoryMb), Number.isFinite(runtime.memoryMb) ? `${runtime.memoryMb} MB RSS` : "Unknown", "Measured", "Unknown"],
            ]),
          })}
        </section>

        <section class="dashboard-grid">
          ${panel({
            title: "Runtime assets",
            subtitle: "Browser and proxy files required by the active build",
            body: settingsRows([
              ["Scramjet", files.scramjet],
              ["BareMux", files.bareMux],
              ["Libcurl", files.libcurl],
              ["Ultraviolet", files.ultraviolet],
              ["Service worker", files.serviceWorker],
              ["Scramjet worker", files.scramjetWorker],
            ]),
          })}
          ${panel({
            title: "Fuzz Cloud",
            subtitle: "Owner remote-PC gateway",
            body: settingsRows([
              ["Feature enabled", cloud.enabled, cloud.name || "Gaming PC", "Enabled", "Disabled"],
              ["Guacamole gateway", cloud.configured, cloud.host || "No valid HTTPS host"],
              ["Owner-only access", cloud.ownerOnly, "Only the owner can access Fuzz Cloud", "Protected", "Open"],
            ]),
          })}
        </section>

        <section class="dashboard-grid diagnostics-findings-grid">
          ${panel({
            title: "Issues",
            subtitle: "Items that can prevent features from working",
            body: issues.length
              ? findings(issues, "error")
              : emptyState("No deployment issues found", "Required checks passed."),
          })}
          ${panel({
            title: "Warnings",
            subtitle: "Non-blocking configuration notes",
            body: warnings.length
              ? findings(warnings, "warning")
              : emptyState("No warnings", "No non-blocking warnings were returned."),
          })}
        </section>

        ${panel({
          title: "Database readiness",
          subtitle: "Each required Supabase table is checked independently with a timeout",
          body: databaseRows(tables),
        })}
      </div>`;

    container
      .querySelector("[data-action='rerun-diagnostics']")
      ?.addEventListener("click", () => renderDiagnostics(container));
  } catch (error) {
    container.innerHTML = errorState(error.message, "Run diagnostics again");
    container
      .querySelector("[data-action='retry']")
      ?.addEventListener("click", () => renderDiagnostics(container));
  }
}
