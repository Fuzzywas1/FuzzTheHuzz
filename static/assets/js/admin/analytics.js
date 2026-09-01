import { api } from "./api.js";
import {
  errorState,
  loadingState,
  metricCard,
  panel,
} from "./components.js";
import { lineChart } from "./charts.js";
import { formatNumber } from "./utils.js";

let selectedDays = 30;

export async function renderAnalytics(container) {
  container.innerHTML = loadingState("Loading platform analytics...");

  try {
    const payload = await api.stats(selectedDays);
    paint(container, payload);
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container.querySelector("[data-action='retry']")?.addEventListener("click", () => {
      renderAnalytics(container);
    });
  }
}

function paint(container, payload) {
  const totals = payload.totals || {};
  const charts = payload.charts || {};

  container.innerHTML = `
    <div class="page-section">
      <div class="toolbar">
        <div class="toolbar-group">
          <select class="select-field" id="analytics-period">
            ${[7, 30, 60, 90]
              .map(
                (days) => `
                  <option value="${days}" ${selectedDays === days ? "selected" : ""}>
                    Last ${days} days
                  </option>
                `,
              )
              .join("")}
          </select>
        </div>
      </div>

      <section class="metric-grid">
        ${metricCard("Users", formatNumber(totals.users), `${totals.verifiedUsers || 0} verified`)}
        ${metricCard("AI chats", formatNumber(totals.aiChats), "All time")}
        ${metricCard("AI messages", formatNumber(totals.aiMessages), "All time")}
        ${metricCard("Proxy requests", formatNumber(totals.proxyRequests), "All time")}
        ${metricCard("Activity logs", formatNumber(totals.activityLogs), "All time")}
        ${metricCard("Staff accounts", formatNumber((totals.owners || 0) + (totals.admins || 0) + (totals.moderators || 0)), "Owners, admins and moderators")}
      </section>

      ${panel({
        title: "Platform growth",
        subtitle: `New users, AI messages, proxy traffic and activity over ${selectedDays} days`,
        body: lineChart(
          [
            { name: "Users", data: charts.users },
            { name: "AI Messages", data: charts.aiMessages },
            { name: "Proxy", data: charts.proxyRequests },
            { name: "Activity", data: charts.activityLogs },
          ],
          { label: "Novaris platform analytics" },
        ),
      })}

      <section class="split-grid" style="margin-top:14px">
        ${panel({
          title: "AI chat creation",
          subtitle: "New saved chats by day",
          body: lineChart(
            [{ name: "AI Chats", data: charts.aiChats }],
            { label: "New AI chats" },
          ),
        })}

        ${panel({
          title: "User registrations",
          subtitle: "New accounts by day",
          body: lineChart(
            [{ name: "Users", data: charts.users }],
            { label: "New users" },
          ),
        })}
      </section>
    </div>
  `;

  container.querySelector("#analytics-period")?.addEventListener("change", (event) => {
    selectedDays = Number(event.target.value || 30);
    renderAnalytics(container);
  });
}
