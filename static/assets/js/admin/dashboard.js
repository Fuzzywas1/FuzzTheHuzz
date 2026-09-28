import { api } from "./api.js";
import {
  activityList,
  errorState,
  loadingState,
  panel,
  serviceList,
  statCard,
} from "./components.js";
import { lineChart } from "./charts.js";
import { showToast } from "./toast.js";
import {
  escapeHtml,
  formatBytes,
  formatUptime,
  setButtonBusy,
} from "./utils.js";
import { navigate } from "./router.js";

let lastPayload = null;

export async function renderDashboard(container, options = {}) {
  const forceRefresh = options.refresh === true;

  if (!lastPayload || forceRefresh) {
    container.innerHTML = loadingState("Loading command center...");
  }

  try {
    const [dashboard, stats, platform] = await Promise.all([
      api.dashboard(forceRefresh),
      api.stats(30),
      api.platformSettings(),
    ]);

    lastPayload = { dashboard, stats, platform };
    paint(container, dashboard, stats, platform);
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container.querySelector("[data-action='retry']")?.addEventListener("click", () => {
      renderDashboard(container, { refresh: true });
    });
  }
}

function featureChip(label, enabled, icon) {
  return `
    <div class="control-feature ${enabled ? "is-online" : "is-offline"}">
      <span class="control-feature-icon">${escapeHtml(icon)}</span>
      <span><strong>${escapeHtml(label)}</strong><small>${enabled ? "Enabled" : "Disabled"}</small></span>
      <i></i>
    </div>
  `;
}

function paint(container, dashboard, stats, platformPayload) {
  const totals = dashboard.stats || {};
  const charts = stats.charts || {};
  const settings = platformPayload.settings || {};

  const services = [
    { name: "Server", icon: "◉", online: dashboard.system?.server === true },
    { name: "Supabase", icon: "◆", online: dashboard.system?.supabase === true },
    { name: "OpenAI", icon: "✦", online: dashboard.system?.openai === true },
    { name: "Bare Server", icon: "◈", online: dashboard.system?.proxy === true },
    { name: "Authentication", icon: "⌁", online: dashboard.system?.authentication === true },
  ];

  const onlineServices = services.filter((service) => service.online).length;
  const maintenance = settings.maintenanceActive === true;
  const cloudReady = settings.cloudEnabled !== false && settings.cloudConfigured === true;

  container.innerHTML = `
    <div class="page-section">
      <section class="control-hero">
        <div class="control-hero-copy">
          <div class="control-hero-kicker"><span class="control-live-dot ${maintenance ? "is-warning" : ""}"></span>${maintenance ? "Maintenance mode" : "Novaris is live"}</div>
          <h2>Your command center.</h2>
          <p>Manage people, features, security, AI, Cloud, and platform health without digging through separate tools.</p>
          <div class="control-hero-actions">
            <a class="button button-primary" href="/">← Back to Novaris</a>
            <button class="button button-secondary" type="button" data-control-route="users">Manage users</button>
            <button class="button button-secondary" type="button" data-control-route="settings">Platform settings</button>
          </div>
        </div>

        <div class="control-hero-status">
          <div class="control-orbit-visual" aria-hidden="true"><span>N</span><i></i><b></b></div>
          <div class="control-status-grid">
            <div><span>Services</span><strong>${onlineServices}/${services.length}</strong><small>operational</small></div>
            <div><span>Uptime</span><strong>${escapeHtml(formatUptime(dashboard.system?.uptime))}</strong><small>current process</small></div>
            <div><span>Memory</span><strong>${escapeHtml(formatBytes(dashboard.system?.memory))}</strong><small>resident usage</small></div>
            <div><span>Cloud</span><strong>${cloudReady ? "Ready" : "Check"}</strong><small>${cloudReady ? "noVNC configured" : "needs attention"}</small></div>
          </div>
        </div>
      </section>

      <section class="control-feature-strip" aria-label="Platform features">
        ${featureChip("Novaris AI", settings.aiEnabled !== false, "✦")}
        ${featureChip("Proxy", settings.proxyEnabled !== false, "◈")}
        ${featureChip("Apps", settings.appsEnabled !== false, "▦")}
        ${featureChip("Games", settings.gamesEnabled !== false, "◇")}
        ${featureChip("Novaris Cloud", settings.cloudEnabled !== false, "▣")}
        ${featureChip("Registrations", settings.registrationsEnabled !== false, "◎")}
      </section>

      <section class="stat-grid">
        ${statCard({ label: "Total Users", value: totals.totalUsers, icon: "◎", caption: `${totals.verifiedUsers || 0} verified`, series: charts.users })}
        ${statCard({ label: "AI Messages", value: totals.aiMessages, icon: "✦", caption: `${totals.aiChats || 0} chats`, series: charts.aiMessages })}
        ${statCard({ label: "Proxy Requests", value: totals.proxyRequests, icon: "◈", caption: "Logged navigations", series: charts.proxyRequests })}
        ${statCard({ label: "Activity Logs", value: totals.activityLogs, icon: "◌", caption: `${totals.bannedUsers || 0} banned users`, series: charts.activityLogs })}
      </section>

      <section class="dashboard-grid">
        ${panel({
          title: "Platform activity",
          subtitle: "Users, AI messages and proxy requests over the last 30 days",
          body: lineChart([
            { name: "Users", data: charts.users },
            { name: "AI Messages", data: charts.aiMessages },
            { name: "Proxy", data: charts.proxyRequests },
          ], { label: "Novaris platform activity over 30 days" }),
        })}
        ${panel({
          title: "System health",
          subtitle: `${onlineServices} of ${services.length} core services operational`,
          action: '<button class="button button-small button-ghost" type="button" data-control-route="health">Details</button>',
          body: serviceList(services),
        })}
      </section>

      <section class="dashboard-grid-secondary">
        ${panel({
          title: "Recent activity",
          subtitle: "The newest audit events across Novaris",
          action: '<button class="button button-small button-ghost" type="button" data-control-route="activity">View all</button>',
          body: activityList(dashboard.recentActivity, 9),
        })}

        ${panel({
          title: "Quick launch",
          subtitle: "Jump directly to the places you use most",
          body: `
            <div class="quick-actions">
              <a class="quick-action" href="/"><span class="quick-action-icon">↗</span><span class="quick-action-copy"><strong>Open Novaris</strong><span>Return to the main platform.</span></span></a>
              <a class="quick-action" href="/ai"><span class="quick-action-icon">✦</span><span class="quick-action-copy"><strong>Novaris AI</strong><span>Open the AI workspace.</span></span></a>
              <a class="quick-action" href="/cloud"><span class="quick-action-icon">▣</span><span class="quick-action-copy"><strong>Novaris Cloud</strong><span>Connect to your Windows PC.</span></span></a>
              <button class="quick-action" type="button" data-quick-action="invites"><span class="quick-action-icon">◇</span><span class="quick-action-copy"><strong>Generate invite</strong><span>Create signup access.</span></span></button>
              <button class="quick-action" type="button" data-quick-action="clear-cache"><span class="quick-action-icon">↻</span><span class="quick-action-copy"><strong>Clear cache</strong><span>Flush remote asset cache.</span></span></button>
            </div>
          `,
        })}
      </section>
    </div>
  `;

  container.querySelectorAll("[data-control-route]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.controlRoute));
  });

  container.querySelectorAll("[data-quick-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.quickAction;
      if (action === "invites") { navigate("invites"); return; }
      if (action === "clear-cache") {
        if (!window.confirm("Clear the remote asset cache now?")) return;
        setButtonBusy(button, true, "Clearing...");
        try {
          const result = await api.clearCache();
          showToast(`Cleared ${result.clearedEntries || 0} cached assets.`, "success", "Cache cleared");
        } catch (error) {
          showToast(error.message, "error");
        } finally {
          setButtonBusy(button, false);
        }
      }
    });
  });
}
