import { api } from "./api.js";
import {
  emptyState,
  errorState,
  loadingState,
  metricCard,
  panel,
} from "./components.js";
import { lineChart } from "./charts.js";
import {
  escapeHtml,
  formatDuration,
  formatNumber,
} from "./utils.js";

let selectedDays = 30;

export async function renderProxy(container) {
  container.innerHTML = loadingState("Loading proxy analytics...");

  try {
    const payload = await api.proxyAnalytics(selectedDays);
    paint(container, payload);
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container.querySelector("[data-action='retry']")?.addEventListener("click", () => {
      renderProxy(container);
    });
  }
}

function paint(container, payload) {
  const totals = payload.totals || {};

  container.innerHTML = `
    <div class="page-section">
      <div class="toolbar">
        <div class="toolbar-group">
          <select class="select-field" id="proxy-period">
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
        ${metricCard("All-time requests", formatNumber(totals.allTime), "Logged proxy navigations")}
        ${metricCard("Requests in period", formatNumber(totals.inPeriod), `Last ${selectedDays} days`)}
        ${metricCard("Successful", formatNumber(totals.successful), "Completed navigations")}
        ${metricCard("Failed", formatNumber(totals.failed), "Logged failures")}
        ${metricCard("Unique domains", formatNumber(totals.uniqueDomains), "Distinct destinations")}
        ${metricCard("Average duration", formatDuration(payload.performance?.averageDurationMs), "Navigation timing")}
      </section>

      <section class="dashboard-grid">
        ${panel({
          title: "Proxy traffic",
          subtitle: `Logged requests during the last ${selectedDays} days`,
          body: lineChart(
            [{ name: "Requests", data: payload.charts?.requests }],
            { label: "Proxy traffic" },
          ),
        })}

        ${panel({
          title: "Proxy engines",
          subtitle: "Traffic split by engine",
          body:
            payload.engines?.length
              ? `
                <div class="rank-list">
                  ${payload.engines
                    .map(
                      (engine, index) => `
                        <div class="rank-row">
                          <span class="rank-index">${String(index + 1).padStart(2, "0")}</span>
                          <span class="rank-label">${escapeHtml(engine.engine)}</span>
                          <span class="rank-value">${escapeHtml(formatNumber(engine.count))}</span>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              `
              : emptyState("No engine data", "Proxy logs have not recorded an engine yet."),
        })}
      </section>

      <section class="split-grid" style="margin-top:14px">
        ${panel({
          title: "Top domains",
          subtitle: "Most requested destinations",
          body:
            payload.topDomains?.length
              ? `
                <div class="rank-list">
                  ${payload.topDomains
                    .slice(0, 10)
                    .map(
                      (domain, index) => `
                        <div class="rank-row">
                          <span class="rank-index">${String(index + 1).padStart(2, "0")}</span>
                          <span class="rank-label">${escapeHtml(domain.domain)}</span>
                          <span class="rank-value">${escapeHtml(formatNumber(domain.count))}</span>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              `
              : emptyState("No domain data", "Proxy destinations will appear here."),
        })}

        ${panel({
          title: "Most active proxy users",
          subtitle: `Top accounts during the last ${selectedDays} days`,
          body:
            payload.topUsers?.length
              ? `
                <div class="rank-list">
                  ${payload.topUsers
                    .map(
                      (user, index) => `
                        <div class="rank-row">
                          <span class="rank-index">${String(index + 1).padStart(2, "0")}</span>
                          <span class="rank-label">${escapeHtml(user.username)}</span>
                          <span class="rank-value">${escapeHtml(formatNumber(user.requests))}</span>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              `
              : emptyState("No active users", "Proxy user rankings will appear here."),
        })}
      </section>
    </div>
  `;

  container.querySelector("#proxy-period")?.addEventListener("change", (event) => {
    selectedDays = Number(event.target.value || 30);
    renderProxy(container);
  });
}
