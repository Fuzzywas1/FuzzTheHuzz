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
  formatBytes,
  formatUptime,
  setButtonBusy,
} from "./utils.js";
import { navigate } from "./router.js";

let lastPayload = null;

export async function renderDashboard(container, options = {}) {
  const forceRefresh = options.refresh === true;

  if (!lastPayload || forceRefresh) {
    container.innerHTML = loadingState("Loading dashboard...");
  }

  try {
    const [dashboard, stats] = await Promise.all([
      api.dashboard(forceRefresh),
      api.stats(30),
    ]);

    lastPayload = { dashboard, stats };
    paint(container, dashboard, stats);
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container.querySelector("[data-action='retry']")?.addEventListener("click", () => {
      renderDashboard(container, { refresh: true });
    });
  }
}

function paint(container, dashboard, stats) {
  const totals = dashboard.stats || {};
  const charts = stats.charts || {};

  const services = [
    { name: "Server", icon: "◉", online: dashboard.system?.server === true },
    { name: "Supabase", icon: "◆", online: dashboard.system?.supabase === true },
    { name: "OpenAI", icon: "✦", online: dashboard.system?.openai === true },
    { name: "Bare Server", icon: "◈", online: dashboard.system?.proxy === true },
    {
      name: "Authentication",
      icon: "⌁",
      online: dashboard.system?.authentication === true,
    },
  ];

  container.innerHTML = `
    <div class="page-section">
      <section class="stat-grid">
        ${statCard({
          label: "Total Users",
          value: totals.totalUsers,
          icon: "◎",
          caption: `${totals.verifiedUsers || 0} verified`,
          series: charts.users,
        })}

        ${statCard({
          label: "AI Messages",
          value: totals.aiMessages,
          icon: "✦",
          caption: `${totals.aiChats || 0} chats`,
          series: charts.aiMessages,
        })}

        ${statCard({
          label: "Proxy Requests",
          value: totals.proxyRequests,
          icon: "◈",
          caption: "Logged navigations",
          series: charts.proxyRequests,
        })}

        ${statCard({
          label: "Activity Logs",
          value: totals.activityLogs,
          icon: "◌",
          caption: `${totals.bannedUsers || 0} banned users`,
          series: charts.activityLogs,
        })}
      </section>

      <section class="dashboard-grid">
        ${panel({
          title: "Platform activity",
          subtitle: "Users, AI messages and proxy requests over the last 30 days",
          body: lineChart(
            [
              { name: "Users", data: charts.users },
              { name: "AI Messages", data: charts.aiMessages },
              { name: "Proxy", data: charts.proxyRequests },
            ],
            { label: "Platform activity over 30 days" },
          ),
        })}

        ${panel({
          title: "System health",
          subtitle: `Uptime ${formatUptime(dashboard.system?.uptime)} · ${formatBytes(dashboard.system?.memory)} memory`,
          body: serviceList(services),
        })}
      </section>

      <section class="dashboard-grid-secondary">
        ${panel({
          title: "Recent activity",
          subtitle: "The newest audit events across FuzzTheHuzz",
          action: `
            <button class="button button-small button-ghost" type="button" data-route-action="activity">
              View all
            </button>
          `,
          body: activityList(dashboard.recentActivity, 9),
        })}

        ${panel({
          title: "Quick actions",
          subtitle: "Common owner operations",
          body: `
            <div class="quick-actions">
              <button class="quick-action" type="button" data-quick-action="invites">
                <span class="quick-action-icon">◇</span>
                <span class="quick-action-copy">
                  <strong>Generate invite</strong>
                  <span>Create new signup access.</span>
                </span>
              </button>

              <button class="quick-action" type="button" data-quick-action="users">
                <span class="quick-action-icon">◎</span>
                <span class="quick-action-copy">
                  <strong>Manage users</strong>
                  <span>Roles, bans and accounts.</span>
                </span>
              </button>

              <button class="quick-action" type="button" data-quick-action="activity">
                <span class="quick-action-icon">◌</span>
                <span class="quick-action-copy">
                  <strong>View logs</strong>
                  <span>Search the complete audit trail.</span>
                </span>
              </button>

              <button class="quick-action" type="button" data-quick-action="cloud">
                <span class="quick-action-icon">▣</span>
                <span class="quick-action-copy">
                  <strong>Open Fuzz Cloud</strong>
                  <span>Launch the owner remote-PC page.</span>
                </span>
              </button>

              <button class="quick-action" type="button" data-quick-action="clear-cache">
                <span class="quick-action-icon">↻</span>
                <span class="quick-action-copy">
                  <strong>Clear cache</strong>
                  <span>Flush remote asset cache.</span>
                </span>
              </button>
            </div>
          `,
        })}
      </section>
    </div>
  `;

  container.querySelector("[data-route-action='activity']")?.addEventListener(
    "click",
    () => navigate("activity"),
  );

  container.querySelectorAll("[data-quick-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.quickAction;

      if (["users", "activity", "invites"].includes(action)) {
        navigate(action);
        return;
      }

      if (action === "cloud") {
        window.open("/cloud", "_blank", "noopener,noreferrer");
        return;
      }

      if (action === "clear-cache") {
        if (!window.confirm("Clear the remote asset cache now?")) {
          return;
        }

        setButtonBusy(button, true, "Clearing...");

        try {
          const result = await api.clearCache();

          showToast(
            `Cleared ${result.clearedEntries || 0} cached assets.`,
            "success",
            "Cache cleared",
          );
        } catch (error) {
          showToast(error.message, "error");
        } finally {
          setButtonBusy(button, false);
        }
      }
    });
  });
}
