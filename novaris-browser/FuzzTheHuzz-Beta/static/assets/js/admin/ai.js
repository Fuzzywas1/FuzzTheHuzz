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

export async function renderAi(container) {
  container.innerHTML = loadingState("Loading Novaris AI analytics...");

  try {
    const payload = await api.aiAnalytics(selectedDays);
    paint(container, payload);
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container.querySelector("[data-action='retry']")?.addEventListener("click", () => {
      renderAi(container);
    });
  }
}

function paint(container, payload) {
  const totals = payload.totals || {};
  const performance = payload.performance || {};

  container.innerHTML = `
    <div class="page-section">
      <div class="toolbar">
        <div class="toolbar-group">
          <select class="select-field" id="ai-period">
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
        ${metricCard("Total chats", formatNumber(totals.chats), "All time")}
        ${metricCard("Total messages", formatNumber(totals.messages), "All time")}
        ${metricCard("Responses in period", formatNumber(totals.responses), `Last ${selectedDays} days`)}
        ${metricCard("Image messages", formatNumber(totals.imageMessages), "Messages with images")}
        ${metricCard("Average response", formatDuration(performance.averageDurationMs), "Generation duration")}
        ${metricCard("Average output", formatNumber(performance.averageOutputLength), "Characters per response")}
      </section>

      <section class="dashboard-grid">
        ${panel({
          title: "AI usage",
          subtitle: `Messages and completed responses over ${selectedDays} days`,
          body: lineChart(
            [
              { name: "Messages", data: payload.charts?.messages },
              { name: "Responses", data: payload.charts?.responses },
            ],
            { label: "Novaris AI usage" },
          ),
        })}

        ${panel({
          title: "Token accounting",
          subtitle: "Available when OpenAI usage data is logged",
          body: `
            <div class="settings-list">
              <div class="setting-row">
                <div class="setting-copy">
                  <strong>Input tokens</strong>
                  <span>User prompts and conversation context</span>
                </div>
                <strong>${escapeHtml(formatNumber(totals.inputTokens))}</strong>
              </div>

              <div class="setting-row">
                <div class="setting-copy">
                  <strong>Output tokens</strong>
                  <span>Generated response tokens</span>
                </div>
                <strong>${escapeHtml(formatNumber(totals.outputTokens))}</strong>
              </div>

              <div class="setting-row">
                <div class="setting-copy">
                  <strong>Total tokens</strong>
                  <span>Combined usage</span>
                </div>
                <strong>${escapeHtml(formatNumber(totals.totalTokens))}</strong>
              </div>
            </div>
          `,
        })}
      </section>

      <div style="height:14px"></div>

      ${panel({
        title: "Most active AI users",
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
                        <span class="rank-value">${escapeHtml(formatNumber(user.messages))} messages</span>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            `
            : emptyState(
                "No AI usage yet",
                "AI activity will appear after users send messages.",
              ),
      })}
    </div>
  `;

  container.querySelector("#ai-period")?.addEventListener("change", (event) => {
    selectedDays = Number(event.target.value || 30);
    renderAi(container);
  });
}
