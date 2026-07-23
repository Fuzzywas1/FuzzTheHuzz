import { api } from "./api.js";
import {
  badge,
  emptyState,
  errorState,
  loadingState,
  panel,
} from "./components.js";
import { openUserProfile } from "./router.js";
import { showToast } from "./toast.js";
import {
  escapeHtml,
  formatDate,
  formatNumber,
  setButtonBusy,
} from "./utils.js";

const roleLabels = {
  user: "Users",
  moderator: "Moderators",
  admin: "Admins",
  owner: "Owners",
};

export async function renderLimits(container) {
  container.innerHTML = loadingState(
    "Loading usage and abuse controls...",
  );

  try {
    const payload = await api.usageSettings();
    paint(container, payload);
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container
      .querySelector("[data-action='retry']")
      ?.addEventListener("click", () => {
        renderLimits(container);
      });
  }
}

function paint(container, payload) {
  const policies = payload.policies || [];
  const violations =
    payload.recentViolations || [];

  container.innerHTML = `
    <div class="page-section">
      <div class="usage-callout">
        <div>
          <p class="eyebrow">Abuse protection</p>
          <h2>Role-based usage policies</h2>
          <p>
            A value of <strong>0</strong> means unlimited. Automatic suspension is triggered after the configured number of violations inside the violation window.
          </p>
        </div>
        ${badge("Owner only", "badge-info")}
      </div>

      <section class="usage-policy-grid">
        ${policies.map(policyCard).join("")}
      </section>

      <div style="height:14px"></div>

      ${panel({
        title: "Recent limit violations",
        subtitle:
          "Blocked AI and proxy requests across all accounts",
        flush: true,
        body: violations.length
          ? `
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Limit</th>
                    <th>Usage</th>
                    <th>Time</th>
                    <th style="text-align:right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${violations.map(violationRow).join("")}
                </tbody>
              </table>
            </div>
          `
          : emptyState(
              "No usage violations",
              "Blocked AI or proxy requests will appear here.",
            ),
      })}
    </div>
  `;

  container
    .querySelectorAll("[data-policy-form]")
    .forEach((form) => {
      form.addEventListener(
        "submit",
        async (event) => {
          event.preventDefault();
          await savePolicy(form);
        },
      );
    });

  container
    .querySelectorAll("[data-open-limit-user]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        openUserProfile(
          button.dataset.openLimitUser,
        );
      });
    });
}

function policyCard(policy) {
  return `
    <form class="usage-policy-card" data-policy-form="${escapeHtml(policy.role)}">
      <header>
        <div>
          <p class="eyebrow">${escapeHtml(policy.role)}</p>
          <h3>${escapeHtml(roleLabels[policy.role] || policy.role)}</h3>
        </div>
        ${
          ["admin", "owner"].includes(policy.role)
            ? badge("Usually unlimited", "badge-info")
            : badge("Protected", "badge-success")
        }
      </header>

      <div class="usage-policy-fields">
        ${numberField(
          "AI messages / day",
          "aiMessagesDaily",
          policy.aiMessagesDaily,
          "0 = unlimited",
        )}
        ${numberField(
          "AI images / day",
          "aiImagesDaily",
          policy.aiImagesDaily,
          "0 = unlimited",
        )}
        ${numberField(
          "Proxy requests / minute",
          "proxyRequestsMinute",
          policy.proxyRequestsMinute,
          "Logged navigations",
        )}
        ${numberField(
          "Proxy requests / day",
          "proxyRequestsDaily",
          policy.proxyRequestsDaily,
          "0 = unlimited",
        )}
        ${numberField(
          "Violation window (minutes)",
          "violationWindowMinutes",
          policy.violationWindowMinutes,
          "5–1440",
          5,
        )}
        ${numberField(
          "Suspend after violations",
          "autoSuspendAfterViolations",
          policy.autoSuspendAfterViolations,
          "0 disables automatic suspension",
        )}
        ${numberField(
          "Automatic suspension (minutes)",
          "autoSuspendMinutes",
          policy.autoSuspendMinutes,
          "Minimum 5 minutes",
          5,
        )}
      </div>

      <footer>
        <span>Updated ${escapeHtml(formatDate(policy.updatedAt))}</span>
        <button class="button button-secondary" type="submit">
          Save ${escapeHtml(policy.role)} policy
        </button>
      </footer>
    </form>
  `;
}

function numberField(
  label,
  name,
  value,
  hint,
  minimum = 0,
) {
  return `
    <label class="form-field compact-field">
      <span>${escapeHtml(label)}</span>
      <input
        class="field"
        type="number"
        name="${escapeHtml(name)}"
        min="${minimum}"
        step="1"
        value="${escapeHtml(value ?? 0)}"
        required
      />
      <small>${escapeHtml(hint)}</small>
    </label>
  `;
}

async function savePolicy(form) {
  const role = form.dataset.policyForm;
  const button = form.querySelector(
    "button[type='submit']",
  );
  const formData = new FormData(form);

  const payload = {
    aiMessagesDaily:
      formData.get("aiMessagesDaily"),
    aiImagesDaily:
      formData.get("aiImagesDaily"),
    proxyRequestsMinute:
      formData.get("proxyRequestsMinute"),
    proxyRequestsDaily:
      formData.get("proxyRequestsDaily"),
    violationWindowMinutes:
      formData.get("violationWindowMinutes"),
    autoSuspendAfterViolations:
      formData.get("autoSuspendAfterViolations"),
    autoSuspendMinutes:
      formData.get("autoSuspendMinutes"),
  };

  setButtonBusy(button, true, "Saving...");

  try {
    await api.updateUsagePolicy(role, payload);
    showToast(
      `${roleLabels[role] || role} usage policy saved.`,
      "success",
      "Limits updated",
    );
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setButtonBusy(button, false);
  }
}

function violationRow(item) {
  return `
    <tr>
      <td>
        <strong>${escapeHtml(item.username || "Unknown")}</strong>
      </td>
      <td>${badge(formatBlockedType(item.blockedType), "badge-warning")}</td>
      <td>
        ${escapeHtml(formatNumber(item.used))}
        / ${escapeHtml(formatNumber(item.limit))}
      </td>
      <td>${escapeHtml(formatDate(item.createdAt))}</td>
      <td style="text-align:right">
        <button
          class="button button-small button-secondary"
          type="button"
          data-open-limit-user="${escapeHtml(item.userId)}"
        >
          Open user
        </button>
      </td>
    </tr>
  `;
}

function formatBlockedType(value) {
  const labels = {
    ai_messages_daily: "AI messages/day",
    ai_images_daily: "AI images/day",
    proxy_requests_minute: "Proxy/minute",
    proxy_requests_daily: "Proxy/day",
  };

  return labels[value] || value || "Unknown limit";
}
