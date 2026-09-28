import { api } from "./api.js";
import {
  badge,
  emptyState,
  errorState,
  loadingState,
  metricCard,
  panel,
} from "./components.js";
import { openUserProfile } from "./router.js";
import { showToast } from "./toast.js";
import {
  escapeHtml,
  formatDate,
  formatNumber,
  initials,
  setButtonBusy,
  statusClass,
} from "./utils.js";

let activeTab = "alerts";

const alertState = {
  page: 1,
  limit: 40,
  filter: "open",
  severity: "",
};

const sessionState = {
  page: 1,
  limit: 50,
  search: "",
  status: "active",
};

const auditState = {
  page: 1,
  limit: 50,
  search: "",
  category: "",
  status: "",
};

export async function renderSecurityCenter(container) {
  container.innerHTML = loadingState("Loading security center...");

  try {
    if (activeTab === "sessions") {
      await renderSessions(container);
    } else if (activeTab === "audit") {
      await renderAudit(container);
    } else {
      await renderAlerts(container);
    }
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container.querySelector("[data-action='retry']")?.addEventListener("click", () => {
      renderSecurityCenter(container);
    });
  }
}

function tabs() {
  return `
    <div class="section-tabs" role="tablist" aria-label="Security center sections">
      ${tabButton("alerts", "Notifications")}
      ${tabButton("sessions", "Sessions")}
      ${tabButton("audit", "Audit Log")}
    </div>
  `;
}

function tabButton(id, label) {
  return `
    <button
      class="section-tab ${activeTab === id ? "is-active" : ""}"
      type="button"
      data-security-tab="${id}"
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function bindTabs(container) {
  container.querySelectorAll("[data-security-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.securityTab;
      renderSecurityCenter(container);
    });
  });
}

async function renderAlerts(container) {
  const [overview, payload] = await Promise.all([
    api.securityOverview(),
    api.notifications(alertState),
  ]);

  const notifications = payload.notifications || [];
  const pagination = payload.pagination || { page: 1, totalPages: 1, total: 0 };

  container.innerHTML = `
    <div class="page-section">
      <div class="toolbar">
        ${tabs()}
        <span class="badge badge-info">Owner only</span>
      </div>

      <section class="metric-grid">
        ${metricCard("Unread alerts", formatNumber(payload.unreadCount), "Security and account events")}
        ${metricCard("Active sessions", formatNumber(overview.activeSessions), "Seen within 15 minutes")}
        ${metricCard("Multi-device accounts", formatNumber(overview.multipleDeviceAccounts), "Two or more active devices")}
        ${metricCard("New devices", formatNumber(overview.newDevices24h), "First seen in the last 24 hours")}
      </section>

      <form class="toolbar" id="notification-filter-form">
        <div class="toolbar-group">
          <select class="select-field" id="notification-filter">
            <option value="open" ${alertState.filter === "open" ? "selected" : ""}>Open notifications</option>
            <option value="unread" ${alertState.filter === "unread" ? "selected" : ""}>Unread only</option>
            <option value="all" ${alertState.filter === "all" ? "selected" : ""}>All notifications</option>
          </select>

          <select class="select-field" id="notification-severity">
            <option value="">All severities</option>
            ${["critical", "warning", "info"]
              .map((value) => `<option value="${value}" ${alertState.severity === value ? "selected" : ""}>${value}</option>`)
              .join("")}
          </select>

          <button class="button button-secondary" type="submit">Filter</button>
        </div>

        <button class="button button-ghost" id="mark-all-notifications" type="button">
          Mark all read
        </button>
      </form>

      ${panel({
        title: "Admin notifications",
        subtitle: "Multiple-login warnings are signals, not proof of account sharing. VPNs and mobile networks can change IP addresses.",
        body: notifications.length
          ? `<div class="notification-list">${notifications.map(notificationCard).join("")}</div>${pager("notifications", pagination)}`
          : emptyState("No matching notifications", "Security warnings and account alerts will appear here."),
      })}
    </div>
  `;

  bindTabs(container);
  bindAlertEvents(container);
}

function notificationCard(item) {
  const severity = ["critical", "warning", "info"].includes(item.severity)
    ? item.severity
    : "info";

  return `
    <article class="security-notification ${item.readAt ? "is-read" : "is-unread"}" data-severity="${severity}">
      <span class="security-notification-icon">${severity === "critical" ? "!" : severity === "warning" ? "△" : "i"}</span>

      <div class="security-notification-copy">
        <div class="security-notification-title">
          <strong>${escapeHtml(item.title || "Security notification")}</strong>
          ${badge(severity, severity === "critical" ? "badge-danger" : severity === "warning" ? "badge-warning" : "badge-info")}
          ${item.occurrenceCount > 1 ? badge(`${item.occurrenceCount} occurrences`, "badge-info") : ""}
        </div>

        <p>${escapeHtml(item.message || "")}</p>
        <span>${escapeHtml(formatDate(item.lastOccurredAt || item.createdAt))}</span>
      </div>

      <div class="security-notification-actions">
        ${item.targetUserId ? `<button class="button button-small button-secondary" type="button" data-notification-user="${escapeHtml(item.targetUserId)}">View user</button>` : ""}
        ${!item.readAt ? `<button class="button button-small button-ghost" type="button" data-notification-read="${escapeHtml(item.id)}">Mark read</button>` : ""}
        <button class="button button-small button-ghost" type="button" data-notification-dismiss="${escapeHtml(item.id)}">Dismiss</button>
      </div>
    </article>
  `;
}

function bindAlertEvents(container) {
  container.querySelector("#notification-filter-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    alertState.page = 1;
    alertState.filter = container.querySelector("#notification-filter").value;
    alertState.severity = container.querySelector("#notification-severity").value;
    renderSecurityCenter(container);
  });

  container.querySelector("#mark-all-notifications")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    setButtonBusy(button, true, "Marking...");
    try {
      await api.markAllNotificationsRead();
      window.dispatchEvent(new CustomEvent("fuzz:notifications-changed"));
      showToast("All notifications were marked as read.", "success", "Updated");
      await renderSecurityCenter(container);
    } catch (error) {
      showToast(error.message, "error");
      setButtonBusy(button, false);
    }
  });

  container.querySelectorAll("[data-notification-read]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api.markNotificationRead(button.dataset.notificationRead);
        window.dispatchEvent(new CustomEvent("fuzz:notifications-changed"));
        await renderSecurityCenter(container);
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });

  container.querySelectorAll("[data-notification-dismiss]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api.dismissNotification(button.dataset.notificationDismiss);
        window.dispatchEvent(new CustomEvent("fuzz:notifications-changed"));
        await renderSecurityCenter(container);
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });

  container.querySelectorAll("[data-notification-user]").forEach((button) => {
    button.addEventListener("click", () => openUserProfile(button.dataset.notificationUser));
  });

  bindPager(container, "notifications", alertState);
}

async function renderSessions(container) {
  const [overview, payload] = await Promise.all([
    api.securityOverview(),
    api.securitySessions(sessionState),
  ]);

  const sessions = payload.sessions || [];
  const pagination = payload.pagination || { page: 1, totalPages: 1, total: 0 };

  container.innerHTML = `
    <div class="page-section">
      <div class="toolbar">
        ${tabs()}
        <span class="badge badge-info">15-minute activity window</span>
      </div>

      <section class="metric-grid">
        ${metricCard("Active sessions", formatNumber(overview.activeSessions), "Recently seen sessions")}
        ${metricCard("Active users", formatNumber(overview.activeUsers), "Accounts currently active")}
        ${metricCard("Multi-device accounts", formatNumber(overview.multipleDeviceAccounts), "Potential account sharing")}
        ${metricCard("Revoked sessions", formatNumber(overview.revokedSessions), "Blocked by an owner")}
      </section>

      <form class="toolbar" id="session-filter-form">
        <div class="toolbar-group">
          <input class="field search-field" id="session-search" type="search" value="${escapeHtml(sessionState.search)}" placeholder="Search username, browser, device or IP..." />
          <select class="select-field" id="session-status">
            <option value="active" ${sessionState.status === "active" ? "selected" : ""}>Active recently</option>
            <option value="all" ${sessionState.status === "all" ? "selected" : ""}>All sessions</option>
            <option value="revoked" ${sessionState.status === "revoked" ? "selected" : ""}>Revoked</option>
            <option value="expired" ${sessionState.status === "expired" ? "selected" : ""}>Expired or inactive</option>
          </select>
          <button class="button button-secondary" type="submit">Search</button>
        </div>
        ${badge(`${formatNumber(pagination.total)} sessions`, "badge-info")}
      </form>

      ${panel({
        title: "Account sessions",
        subtitle: "Each login receives a separate app session. Revoking it blocks future authenticated requests from that login.",
        flush: true,
        body: sessions.length
          ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>User</th><th>Device</th><th>IP</th><th>First seen</th><th>Last seen</th><th>Status</th><th style="text-align:right">Action</th></tr></thead><tbody>${sessions.map(sessionRow).join("")}</tbody></table></div>${pager("sessions", pagination)}`
          : emptyState("No matching sessions", "No sessions matched these filters."),
      })}
    </div>
  `;

  bindTabs(container);
  bindSessionEvents(container);
}

function sessionRow(session) {
  return `
    <tr class="${session.multipleDeviceActive ? "security-row-warning" : ""}">
      <td>
        <button class="user-profile-link" type="button" data-session-user="${escapeHtml(session.userId)}">
          <span class="table-avatar">${escapeHtml(initials(session.username))}</span>
          <span class="table-primary-copy"><strong>${escapeHtml(session.username || "Unknown")}</strong><span>${session.multipleDeviceActive ? "Multiple active devices" : escapeHtml(session.userId || "")}</span></span>
        </button>
      </td>
      <td><span class="table-primary-copy"><strong>${escapeHtml(session.browser || "Unknown browser")}</strong><span>${escapeHtml(`${session.operatingSystem || "Unknown OS"} · ${session.deviceType || "device"}`)}</span></span></td>
      <td><span class="profile-monospace">${escapeHtml(session.ipAddress || "Unknown")}</span></td>
      <td>${escapeHtml(formatDate(session.firstSeenAt))}</td>
      <td>${escapeHtml(formatDate(session.lastSeenAt))}</td>
      <td>${sessionStatusBadge(session)}</td>
      <td style="text-align:right">
        <button class="button button-small button-danger" type="button" data-revoke-session="${escapeHtml(session.id)}" ${session.revokedAt ? "disabled" : ""}>Revoke</button>
      </td>
    </tr>
  `;
}

function sessionStatusBadge(session) {
  if (session.revokedAt) return badge("revoked", "badge-danger");
  if (session.active) return badge("active", "badge-success");
  if (session.expired) return badge("expired", "badge-warning");
  return badge("inactive", "badge-info");
}

function bindSessionEvents(container) {
  container.querySelector("#session-filter-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    sessionState.page = 1;
    sessionState.search = container.querySelector("#session-search").value.trim();
    sessionState.status = container.querySelector("#session-status").value;
    renderSecurityCenter(container);
  });

  container.querySelectorAll("[data-session-user]").forEach((button) => {
    button.addEventListener("click", () => openUserProfile(button.dataset.sessionUser));
  });

  container.querySelectorAll("[data-revoke-session]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Revoke this login session? That browser will be signed out on its next request.")) return;
      setButtonBusy(button, true, "Revoking...");
      try {
        await api.revokeSecuritySession(button.dataset.revokeSession);
        showToast("The session was revoked.", "success", "Session blocked");
        await renderSecurityCenter(container);
      } catch (error) {
        showToast(error.message, "error");
        setButtonBusy(button, false);
      }
    });
  });

  bindPager(container, "sessions", sessionState);
}

async function renderAudit(container) {
  const payload = await api.activity(auditState);
  const logs = payload.logs || [];
  const pagination = payload.pagination || { page: 1, totalPages: 1, total: 0 };

  container.innerHTML = `
    <div class="page-section">
      <div class="toolbar">
        ${tabs()}
        <span class="badge badge-info">Permanent activity trail</span>
      </div>

      <form class="toolbar" id="audit-filter-form">
        <div class="toolbar-group">
          <input class="field search-field" id="audit-search" type="search" value="${escapeHtml(auditState.search)}" placeholder="Search action or description..." />
          <select class="select-field" id="audit-category">
            <option value="">All categories</option>
            ${["security", "auth", "admin", "ai", "proxy", "system"].map((value) => `<option value="${value}" ${auditState.category === value ? "selected" : ""}>${value}</option>`).join("")}
          </select>
          <select class="select-field" id="audit-status">
            <option value="">All statuses</option>
            ${["success", "failure", "informational", "warning"].map((value) => `<option value="${value}" ${auditState.status === value ? "selected" : ""}>${value}</option>`).join("")}
          </select>
          <button class="button button-secondary" type="submit">Filter</button>
        </div>
        ${badge(`${formatNumber(pagination.total)} events`, "badge-info")}
      </form>

      ${panel({
        title: "Security and admin audit log",
        subtitle: "Sensitive actions and account events from activity_logs",
        flush: true,
        body: logs.length
          ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Event</th><th>Category</th><th>Status</th><th>Client</th><th>IP</th><th>Time</th></tr></thead><tbody>${logs.map(auditRow).join("")}</tbody></table></div>${pager("audit", pagination)}`
          : emptyState("No matching audit events", "No activity matched these filters."),
      })}
    </div>
  `;

  bindTabs(container);

  container.querySelector("#audit-filter-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    auditState.page = 1;
    auditState.search = container.querySelector("#audit-search").value.trim();
    auditState.category = container.querySelector("#audit-category").value;
    auditState.status = container.querySelector("#audit-status").value;
    renderSecurityCenter(container);
  });

  bindPager(container, "audit", auditState);
}

function auditRow(log) {
  return `
    <tr>
      <td><span class="table-primary-copy"><strong>${escapeHtml(log.description || log.action || "Activity event")}</strong><span>${escapeHtml(log.action || "unknown")}</span></span></td>
      <td>${badge(log.category || "unknown", "badge-info")}</td>
      <td>${badge(log.status || "unknown", statusClass(log.status))}</td>
      <td><span class="table-primary-copy"><strong>${escapeHtml(log.browser || "Unknown")}</strong><span>${escapeHtml(`${log.operating_system || log.operatingSystem || "Unknown OS"} · ${log.device_type || log.deviceType || "device"}`)}</span></span></td>
      <td><span class="profile-monospace">${escapeHtml(log.ip_address || log.ipAddress || "Unknown")}</span></td>
      <td>${escapeHtml(formatDate(log.created_at || log.createdAt))}</td>
    </tr>
  `;
}

function pager(type, pagination) {
  return `
    <div class="pager">
      <span>Page ${pagination.page} of ${pagination.totalPages}</span>
      <div class="pager-actions">
        <button class="button button-small button-secondary" type="button" data-security-page-type="${type}" data-security-page="previous" ${pagination.page <= 1 ? "disabled" : ""}>Previous</button>
        <button class="button button-small button-secondary" type="button" data-security-page-type="${type}" data-security-page="next" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>Next</button>
      </div>
    </div>
  `;
}

function bindPager(container, type, state) {
  container.querySelectorAll(`[data-security-page-type="${type}"]`).forEach((button) => {
    button.addEventListener("click", () => {
      state.page = button.dataset.securityPage === "next"
        ? state.page + 1
        : Math.max(1, state.page - 1);
      renderSecurityCenter(container);
    });
  });
}
