import { api } from "./api.js";
import {
  errorState,
  loadingState,
  metricCard,
  panel,
} from "./components.js";
import { showToast } from "./toast.js";
import {
  escapeHtml,
  formatDate,
  formatNumber,
  setButtonBusy,
} from "./utils.js";

const DATASETS = [
  {
    id: "users",
    icon: "◎",
    title: "Users",
    description: "Profiles combined with safe Supabase authentication details.",
    countKey: "users",
  },
  {
    id: "activity",
    icon: "◌",
    title: "Activity log",
    description: "Complete audit events, devices, actions and metadata.",
    countKey: "activity",
    dated: true,
  },
  {
    id: "ai",
    icon: "✦",
    title: "AI conversations",
    description: "Saved chats and every stored user and assistant message.",
    countKey: "aiMessages",
    dated: true,
  },
  {
    id: "proxy",
    icon: "◈",
    title: "Proxy history",
    description: "Logged searches, destinations, engines and request status.",
    countKey: "proxy",
    dated: true,
  },
  {
    id: "security",
    icon: "⊙",
    title: "Security records",
    description: "Sanitized sessions, account alerts and notification states.",
    countKey: "securitySessions",
    dated: true,
  },
  {
    id: "usage",
    icon: "⌁",
    title: "Usage and limits",
    description: "Policies, account overrides, usage events and violations.",
    countKey: "usageEvents",
    dated: true,
  },
  {
    id: "announcements",
    icon: "◒",
    title: "Announcements",
    description: "Active, scheduled and expired platform notices.",
    countKey: "announcements",
    dated: true,
  },
  {
    id: "invites",
    icon: "◇",
    title: "Invite codes",
    description: "Used and unused invite codes with account associations.",
    countKey: "invites",
  },
  {
    id: "notifications",
    icon: "◉",
    title: "Admin notifications",
    description: "Security and system notifications plus read states.",
    countKey: "notifications",
    dated: true,
  },
  {
    id: "settings",
    icon: "⚙",
    title: "Platform settings",
    description: "Maintenance configuration and feature-switch values.",
    countKey: null,
  },
];

export async function renderExports(container) {
  container.innerHTML = loadingState("Loading backup and export tools...");

  try {
    const payload = await api.exportsSummary();
    paint(container, payload);
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container.querySelector("[data-action='retry']")?.addEventListener("click", () => {
      renderExports(container);
    });
  }
}

function paint(container, payload) {
  const counts = payload.counts || {};

  container.innerHTML = `
    <div class="page-section">
      <section class="metric-grid">
        ${metricCard("Users", formatNumber(counts.users), "Account profiles")}
        ${metricCard("AI messages", formatNumber(counts.aiMessages), `${formatNumber(counts.aiChats)} chats`)}
        ${metricCard("Proxy requests", formatNumber(counts.proxy), "Logged navigations")}
        ${metricCard("Activity events", formatNumber(counts.activity), "Audit trail")}
      </section>

      <div style="height:14px"></div>

      <section class="backup-hero">
        <div class="backup-hero-copy">
          <span class="backup-icon">⇩</span>

          <div>
            <p class="eyebrow">Owner-only data backup</p>
            <h2>Download a complete Novaris data snapshot</h2>
            <p>
              Includes app database tables and safe authentication-account details.
              Password hashes, API keys and session tokens are excluded.
            </p>
          </div>
        </div>

        <button
          class="button button-primary"
          type="button"
          data-export-dataset="full"
          data-export-format="json"
        >
          Download full backup
        </button>
      </section>

      <div style="height:14px"></div>

      ${panel({
        title: "Export date range",
        subtitle: "Optional filter for time-based exports; leave blank to include all records",
        body: `
          <div class="export-date-controls">
            <label class="field-group">
              <span>From</span>
              <input class="field" id="export-from" type="date" />
            </label>

            <label class="field-group">
              <span>Through</span>
              <input class="field" id="export-to" type="date" />
            </label>

            <button class="button button-ghost" id="clear-export-dates" type="button">
              Clear dates
            </button>
          </div>
        `,
      })}

      <div style="height:14px"></div>

      <section class="export-grid">
        ${DATASETS.map((dataset) => exportCard(dataset, counts)).join("")}
      </section>

      <div style="height:14px"></div>

      <section class="split-grid">
        ${panel({
          title: "Backup coverage",
          subtitle: "Sensitive credentials are intentionally never exported",
          body: `
            <div class="settings-list">
              ${(payload.exclusions || [])
                .map(
                  (item) => `
                    <div class="setting-row">
                      <div class="setting-copy">
                        <strong>${escapeHtml(item)}</strong>
                        <span>Excluded for account and server security.</span>
                      </div>
                      <span class="badge badge-success">Protected</span>
                    </div>
                  `,
                )
                .join("")}
            </div>
          `,
        })}

        ${panel({
          title: "Export status",
          subtitle: "Recent backup information",
          body: `
            <div class="settings-list">
              <div class="setting-row">
                <div class="setting-copy">
                  <strong>Last export</strong>
                  <span>
                    ${
                      payload.lastExport
                        ? escapeHtml(formatDate(payload.lastExport.created_at))
                        : "No export has been recorded yet."
                    }
                  </span>
                </div>
                <span class="badge badge-info">
                  ${payload.lastExport ? "Recorded" : "None"}
                </span>
              </div>

              <div class="setting-row">
                <div class="setting-copy">
                  <strong>Maximum per table</strong>
                  <span>Large exports are capped to protect server memory.</span>
                </div>
                <strong>${escapeHtml(formatNumber(payload.limits?.maximumRowsPerTable))}</strong>
              </div>

              <div class="setting-row">
                <div class="setting-copy">
                  <strong>Restore support</strong>
                  <span>Downloads are snapshots; automatic restore is not enabled yet.</span>
                </div>
                <span class="badge badge-warning">Export only</span>
              </div>
            </div>
          `,
        })}
      </section>
    </div>
  `;

  bind(container);
}

function exportCard(dataset, counts) {
  const count = dataset.countKey ? counts[dataset.countKey] : null;

  return `
    <article class="export-card">
      <div class="export-card-header">
        <span class="export-card-icon">${escapeHtml(dataset.icon)}</span>

        <span class="badge badge-info">
          ${count === null || count === undefined ? "Configuration" : `${formatNumber(count)} records`}
        </span>
      </div>

      <div class="export-card-copy">
        <h3>${escapeHtml(dataset.title)}</h3>
        <p>${escapeHtml(dataset.description)}</p>
        ${dataset.dated ? "<small>Uses the optional date range above.</small>" : "<small>Always exports all available records.</small>"}
      </div>

      <div class="export-card-actions">
        <button
          class="button button-small button-secondary"
          type="button"
          data-export-dataset="${escapeHtml(dataset.id)}"
          data-export-format="json"
        >
          JSON
        </button>

        <button
          class="button button-small button-secondary"
          type="button"
          data-export-dataset="${escapeHtml(dataset.id)}"
          data-export-format="csv"
        >
          CSV
        </button>
      </div>
    </article>
  `;
}

function bind(container) {
  container.querySelector("#clear-export-dates")?.addEventListener("click", () => {
    container.querySelector("#export-from").value = "";
    container.querySelector("#export-to").value = "";
  });

  container.querySelectorAll("[data-export-dataset]").forEach((button) => {
    button.addEventListener("click", () => {
      downloadExport(container, button);
    });
  });
}

async function downloadExport(container, button) {
  const dataset = button.dataset.exportDataset;
  const format = button.dataset.exportFormat;
  const from = container.querySelector("#export-from")?.value || "";
  const to = container.querySelector("#export-to")?.value || "";

  if (from && to && from > to) {
    showToast("The start date must be before the end date.", "error");
    return;
  }

  if (dataset === "full") {
    const confirmed = window.confirm(
      "Download a complete backup containing sensitive account and activity data? Keep the file private.",
    );

    if (!confirmed) {
      return;
    }
  }

  setButtonBusy(button, true, "Preparing...");

  try {
    const url = api.exportDownloadUrl(dataset, format, { from, to });
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: {
        Accept: format === "csv" ? "text/csv" : "application/json",
      },
    });

    if (response.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent("/admin#exports")}`;
      return;
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || `Export failed with status ${response.status}.`);
    }

    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
    const filename = filenameMatch?.[1] || `fuzz-${dataset}.${format}`;
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);

    showToast(
      `${dataset === "full" ? "Full backup" : "Export"} downloaded successfully.`,
      "success",
      "Download ready",
    );
  } catch (error) {
    showToast(error.message, "error", "Export failed");
  } finally {
    setButtonBusy(button, false);
  }
}
