import { api } from "./api.js";
import {
  emptyState,
  errorState,
  loadingState,
  panel,
  serviceList,
} from "./components.js";
import { escapeHtml, formatBytes, formatUptime, relativeTime } from "./utils.js";

export async function renderHealth(container) {
  container.innerHTML = loadingState("Running system checks...");

  try {
    const payload = await api.systemHealth();
    const checks = payload.checks || {};
    const services = Object.entries(checks).map(([name, check]) => ({
      name: name === "openai" ? "OpenAI" : name.charAt(0).toUpperCase() + name.slice(1),
      icon: check.status === "online" || check.status === "configured" ? "●" : "!",
      online: check.status === "online" || check.status === "configured",
    }));

    const recentErrors = payload.recentErrors || [];
    const errorBody = recentErrors.length
      ? `<div class="activity-list">${recentErrors.map((entry) => `
          <article class="activity-item">
            <span class="activity-symbol">!</span>
            <div class="activity-copy">
              <strong>${escapeHtml(entry.resource_id || "Client error")}</strong>
              <span>${escapeHtml(entry.description || "No description")}</span>
            </div>
            <time class="activity-time" title="${escapeHtml(entry.created_at || "")}">${escapeHtml(relativeTime(entry.created_at))}</time>
          </article>`).join("")}</div>`
      : emptyState("No recent client errors", "New browser error IDs will appear here automatically.");

    container.innerHTML = `
      <div class="page-section">
        <section class="stat-grid">
          <article class="stat-card"><div class="stat-header"><span class="stat-label">Overall status</span><span class="stat-icon">♥</span></div><strong class="stat-value" style="font-size:24px">${escapeHtml(payload.overall)}</strong><div class="stat-footer"><span>Fuzz ${escapeHtml(payload.version)}</span></div></article>
          <article class="stat-card"><div class="stat-header"><span class="stat-label">Uptime</span><span class="stat-icon">◷</span></div><strong class="stat-value" style="font-size:24px">${escapeHtml(formatUptime(payload.uptime))}</strong><div class="stat-footer"><span>Current revision</span></div></article>
          <article class="stat-card"><div class="stat-header"><span class="stat-label">Memory</span><span class="stat-icon">◫</span></div><strong class="stat-value" style="font-size:24px">${escapeHtml(formatBytes(payload.memory))}</strong><div class="stat-footer"><span>Resident process memory</span></div></article>
          <article class="stat-card"><div class="stat-header"><span class="stat-label">Client errors</span><span class="stat-icon">!</span></div><strong class="stat-value">${recentErrors.length}</strong><div class="stat-footer"><span>Newest 30 events</span></div></article>
        </section>

        <section class="dashboard-grid">
          ${panel({
            title: "Service checks",
            subtitle: `Checked ${new Date(payload.checkedAt).toLocaleString()}`,
            body: serviceList(services),
          })}
          ${panel({
            title: "Platform switches",
            subtitle: "Live feature availability",
            body: serviceList([
              { name: "Proxy browsing", icon: "◈", online: payload.platform?.proxyEnabled !== false },
              { name: "Fuzz AI", icon: "✦", online: payload.platform?.aiEnabled !== false },
              { name: "Fuzz Cloud configured", icon: "▣", online: payload.platform?.cloudEnabled === false || payload.platform?.cloudConfigured === true },
              { name: "Maintenance mode off", icon: "⌁", online: payload.platform?.maintenance !== true },
              { name: "Cache", icon: "↻", online: true },
            ]),
          })}
        </section>

        ${panel({
          title: "Recent client error IDs",
          subtitle: "Search these IDs in Activity to see the full event and device details.",
          body: errorBody,
        })}
      </div>`;
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container.querySelector("[data-action='retry']")?.addEventListener("click", () => renderHealth(container));
  }
}
