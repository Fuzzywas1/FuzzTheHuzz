import { api } from "./api.js";
import {
  emptyState,
  errorState,
  loadingState,
  panel,
} from "./components.js";
import { escapeHtml } from "./utils.js";

function badge(ok, good = "Ready", bad = "Needs attention") {
  return `<span class="badge ${ok ? "badge-success" : "badge-warning"}">${escapeHtml(
    ok ? good : bad,
  )}</span>`;
}

function rows(items) {
  return `<div class="settings-list">${items
    .map(
      ([name, ok, detail = ""]) => `
        <div class="setting-row">
          <div class="setting-copy">
            <strong>${escapeHtml(name)}</strong>
            ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
          </div>
          ${badge(Boolean(ok))}
        </div>`,
    )
    .join("")}</div>`;
}

export async function renderDiagnostics(container) {
  container.innerHTML = loadingState("Auditing deployment...");

  try {
    const payload = await api.diagnostics();
    const env = payload.environment || {};
    const files = payload.files || {};
    const cloud = payload.cloud || {};
    const tables = payload.database?.checks || [];
    const issues = payload.issues || [];

    const databaseBody = tables.length
      ? `<div class="settings-list">${tables
          .map(
            (check) => `
              <div class="setting-row">
                <div class="setting-copy">
                  <strong>${escapeHtml(check.name)}</strong>
                  <span>${escapeHtml(check.message || "")}</span>
                </div>
                ${badge(check.ok)}
              </div>`,
          )
          .join("")}</div>`
      : emptyState(
          "No database checks returned",
          "The diagnostics endpoint returned no schema results.",
        );

    const issueBody = issues.length
      ? `<div class="activity-list">${issues
          .map(
            (issue) => `
              <article class="activity-item">
                <span class="activity-symbol">!</span>
                <div class="activity-copy">
                  <strong>Attention needed</strong>
                  <span>${escapeHtml(issue)}</span>
                </div>
              </article>`,
          )
          .join("")}</div>`
      : emptyState(
          "No deployment issues found",
          "The automated deployment checks passed.",
        );

    container.innerHTML = `
      <div class="page-section">
        <section class="stat-grid">
          <article class="stat-card">
            <div class="stat-header"><span class="stat-label">Audit status</span><span class="stat-icon">${payload.ok ? "✓" : "!"}</span></div>
            <strong class="stat-value" style="font-size:24px">${payload.ok ? "Ready" : "Review"}</strong>
            <div class="stat-footer"><span>Fuzz ${escapeHtml(payload.version || "")}</span></div>
          </article>
          <article class="stat-card">
            <div class="stat-header"><span class="stat-label">Database</span><span class="stat-icon">◆</span></div>
            <strong class="stat-value">${tables.filter((item) => item.ok).length}/${tables.length}</strong>
            <div class="stat-footer"><span>Core tables ready</span></div>
          </article>
          <article class="stat-card">
            <div class="stat-header"><span class="stat-label">Fuzz Cloud</span><span class="stat-icon">▣</span></div>
            <strong class="stat-value" style="font-size:22px">${cloud.configured ? "Ready" : "Setup"}</strong>
            <div class="stat-footer"><span>${escapeHtml(cloud.host || "No gateway host")}</span></div>
          </article>
          <article class="stat-card">
            <div class="stat-header"><span class="stat-label">Issues</span><span class="stat-icon">!</span></div>
            <strong class="stat-value">${issues.length}</strong>
            <div class="stat-footer"><span>Automated findings</span></div>
          </article>
        </section>

        <section class="dashboard-grid">
          ${panel({
            title: "Environment",
            subtitle: "Presence only — secret values are never returned",
            body: rows([
              ["Supabase URL", env.supabaseUrl],
              ["Supabase anon key", env.supabaseAnonKey],
              ["Supabase server key", env.supabaseServerKey],
              ["OpenAI API key", env.openaiApiKey, `Model: ${env.openaiModel || "default"}`],
            ]),
          })}
          ${panel({
            title: "Runtime assets",
            subtitle: "Browser/proxy files required by the active build",
            body: rows([
              ["Scramjet", files.scramjet],
              ["BareMux", files.bareMux],
              ["Libcurl", files.libcurl],
              ["Ultraviolet", files.ultraviolet],
              ["Service worker", files.serviceWorker],
              ["Scramjet worker", files.scramjetWorker],
            ]),
          })}
        </section>

        <section class="dashboard-grid">
          ${panel({
            title: "Fuzz Cloud",
            subtitle: "Owner remote-PC gateway",
            body: rows([
              ["Feature enabled", cloud.enabled, cloud.name || "Gaming PC"],
              ["Guacamole gateway", cloud.configured, cloud.host || "No valid HTTPS host"],
              ["Owner-only access", cloud.ownerOnly],
            ]),
          })}
          ${panel({
            title: "Automated findings",
            subtitle: `Checked ${new Date(payload.checkedAt).toLocaleString()}`,
            body: issueBody,
          })}
        </section>

        ${panel({
          title: "Database readiness",
          subtitle: "Accounts, AI, chat, feedback and personalization schema",
          body: databaseBody,
        })}
      </div>`;
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container
      .querySelector("[data-action='retry']")
      ?.addEventListener("click", () => renderDiagnostics(container));
  }
}
