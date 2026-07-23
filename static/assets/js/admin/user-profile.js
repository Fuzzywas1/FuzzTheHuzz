import { api } from "./api.js";
import {
  activityList,
  badge,
  emptyState,
  errorState,
  loadingState,
  metricCard,
  panel,
} from "./components.js";
import { navigate } from "./router.js";
import { showToast } from "./toast.js";
import {
  activityIcon,
  copyText,
  escapeHtml,
  formatDate,
  formatNumber,
  initials,
  setButtonBusy,
  statusClass,
} from "./utils.js";

let loadedUserId = null;
let profilePayload = null;
let activeTab = "overview";

const tabStates = {
  ai: { page: 1, limit: 20 },
  proxy: { page: 1, limit: 50, search: "", status: "" },
  activity: { page: 1, limit: 50, category: "", status: "" },
  usage: { loaded: false },
  security: { loaded: false },
};

export async function renderUserProfile(container, _options = {}, params = {}) {
  const userId = params.userId;

  if (!userId) {
    container.innerHTML = errorState("No user ID was supplied.");
    return;
  }

  if (loadedUserId !== userId) {
    loadedUserId = userId;
    profilePayload = null;
    activeTab = "overview";
    resetTabStates();
  }

  container.innerHTML = loadingState("Loading user profile...");

  try {
    profilePayload = await api.userProfile(userId);
    await paint(container);
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container.querySelector("[data-action='retry']")?.addEventListener("click", () => {
      renderUserProfile(container, {}, { userId });
    });
  }
}

function resetTabStates() {
  tabStates.ai.page = 1;
  tabStates.proxy.page = 1;
  tabStates.proxy.search = "";
  tabStates.proxy.status = "";
  tabStates.activity.page = 1;
  tabStates.activity.category = "";
  tabStates.activity.status = "";
  tabStates.usage.loaded = false;
  tabStates.security.loaded = false;
}

async function paint(container) {
  const user = profilePayload.user;

  document.getElementById("page-title").textContent = user.username || "User Profile";
  document.getElementById("page-subtitle").textContent =
    `${user.email || "No email"} · ${user.role}`;

  let tabBody = "";

  if (activeTab === "ai") {
    tabBody = await loadAiTab();
  } else if (activeTab === "proxy") {
    tabBody = await loadProxyTab();
  } else if (activeTab === "activity") {
    tabBody = await loadActivityTab();
  } else if (activeTab === "usage") {
    tabBody = await loadUsageTab();
  } else if (activeTab === "security") {
    tabBody = await loadSecurityTab();
  } else {
    tabBody = overviewTab();
  }

  container.innerHTML = `
    <div class="page-section">
      ${profileHeader()}

      <div class="profile-tabs" role="tablist" aria-label="User profile sections">
        ${profileTab("overview", "Overview")}
        ${profileTab("ai", "AI Chats")}
        ${profileTab("proxy", "Proxy History")}
        ${profileTab("activity", "Activity")}
        ${profileTab("usage", "Usage")}
        ${profileTab("security", "Security")}
      </div>

      <div class="profile-tab-content">
        ${tabBody}
      </div>

      <div id="profile-modal-root"></div>
    </div>
  `;

  bindCommonEvents(container);
  bindTabEvents(container);
}

function profileHeader() {
  const user = profilePayload.user;
  const permissions = profilePayload.permissions || {};
  const roleOptions = ["user", "moderator", "admin", "owner"]
    .map(
      (role) => `
        <option value="${role}" ${user.role === role ? "selected" : ""}>
          ${role}
        </option>
      `,
    )
    .join("");

  return `
    <section class="profile-hero">
      <div class="profile-hero-main">
        <button class="button button-small button-ghost" id="profile-back" type="button">
          ← Users
        </button>

        <div class="profile-identity">
          <span class="profile-avatar">${escapeHtml(initials(user.username || user.email))}</span>

          <div class="profile-identity-copy">
            <div class="profile-name-line">
              <h2>${escapeHtml(user.username || "No username")}</h2>
              ${user.banned
                ? badge("Banned", "badge-danger")
                : user.suspended
                  ? badge("Suspended", "badge-warning")
                  : badge("Active", "badge-success")}
              ${user.emailVerified ? badge("Verified", "badge-success") : badge("Unverified", "badge-warning")}
            </div>

            <p>${escapeHtml(user.email || "No email address")}</p>
            <span>Created ${escapeHtml(formatDate(user.createdAt))}</span>
          </div>
        </div>
      </div>

      <div class="profile-actions">
        <button class="button button-secondary" id="copy-user-id" type="button">
          Copy user ID
        </button>

        <select
          class="select-field"
          id="profile-role-select"
          ${permissions.canChangeRole ? "" : "disabled"}
        >
          ${roleOptions}
        </select>

        <button
          class="button button-warning"
          id="profile-suspend-button"
          type="button"
          ${permissions.canSuspend ? "" : "disabled"}
        >
          ${user.suspended ? "Manage suspension" : "Suspend account"}
        </button>

        <button
          class="button ${user.banned ? "button-secondary" : "button-danger"}"
          id="profile-ban-button"
          type="button"
          ${permissions.canBan ? "" : "disabled"}
        >
          ${user.banned ? "Unban account" : "Ban account"}
        </button>
      </div>
    </section>
  `;
}

function profileTab(id, label) {
  return `
    <button
      class="profile-tab ${activeTab === id ? "is-active" : ""}"
      type="button"
      data-profile-tab="${id}"
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function overviewTab() {
  const { user, stats, invite, recentClient, recentActivity } = profilePayload;

  return `
    <section class="metric-grid profile-metric-grid">
      ${metricCard("AI chats", formatNumber(stats.aiChats), "Saved conversations")}
      ${metricCard("AI messages", formatNumber(stats.aiMessages), "User and assistant messages")}
      ${metricCard("Proxy requests", formatNumber(stats.proxyRequests), "Logged searches and destinations")}
      ${metricCard("Activity events", formatNumber(stats.activityLogs), "Events connected to this account")}
    </section>

    <section class="dashboard-grid">
      ${panel({
        title: "Account details",
        subtitle: "Authentication and signup information",
        body: `
          <div class="profile-detail-list">
            ${detailRow("Username", user.username || "Not set")}
            ${detailRow("Email", user.email || "Not set")}
            ${detailRow("Role", user.role)}
            ${detailRow("Account status", user.banned ? "Banned" : user.suspended ? "Suspended" : "Active")}
            ${user.suspended ? detailRow("Suspended until", formatDate(user.suspendedUntil)) : ""}
            ${user.suspended ? detailRow("Suspension reason", user.suspensionReason || "Not recorded") : ""}
            ${detailRow("Last sign-in", formatDate(user.lastSignInAt))}
            ${detailRow("Account created", formatDate(user.createdAt))}
            ${detailRow("Invite code", invite?.code || "Not recorded", true)}
            ${detailRow("User ID", user.id, true)}
          </div>
        `,
      })}

      ${panel({
        title: "Recent device",
        subtitle: "Latest client recorded in activity logs",
        body: recentClient
          ? `
            <div class="profile-detail-list">
              ${detailRow("Browser", recentClient.browser || "Unknown")}
              ${detailRow("Operating system", recentClient.operatingSystem || "Unknown")}
              ${detailRow("Device", recentClient.deviceType || "Unknown")}
              ${detailRow("IP address", recentClient.ipAddress || "Unknown", true)}
              ${detailRow("Last seen", formatDate(recentClient.lastSeenAt))}
            </div>
          `
          : emptyState("No device history", "No client information has been logged for this user."),
      })}
    </section>

    <div style="height:14px"></div>

    ${panel({
      title: "Recent activity",
      subtitle: "Latest events connected to this account",
      body: activityList(recentActivity || [], 12),
    })}
  `;
}

function detailRow(label, value, monospace = false) {
  return `
    <div class="profile-detail-row">
      <span>${escapeHtml(label)}</span>
      <strong class="${monospace ? "profile-monospace" : ""}" title="${escapeHtml(value)}">
        ${escapeHtml(value)}
      </strong>
    </div>
  `;
}

async function loadAiTab() {
  try {
    const payload = await api.userAiChats(loadedUserId, tabStates.ai);
    const chats = payload.chats || [];
    const pagination = payload.pagination || { page: 1, totalPages: 1, total: chats.length };

    return panel({
      title: "AI conversations",
      subtitle: `Saved chats belonging to ${profilePayload.user.username}`,
      flush: true,
      body: chats.length
        ? `
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Chat</th>
                  <th>Messages</th>
                  <th>Latest message</th>
                  <th>Updated</th>
                  <th style="text-align:right">Action</th>
                </tr>
              </thead>
              <tbody>${chats.map(aiChatRow).join("")}</tbody>
            </table>
          </div>
          ${profilePager("ai", pagination)}
        `
        : emptyState("No AI chats", "This user has not saved any AI conversations."),
    });
  } catch (error) {
    return errorState(error.message);
  }
}

function aiChatRow(chat) {
  return `
    <tr>
      <td>
        <span class="table-primary-copy">
          <strong>${escapeHtml(chat.title || "New chat")}</strong>
          <span>${escapeHtml(formatDate(chat.createdAt))}</span>
        </span>
      </td>
      <td>${badge(`${chat.messageCount || 0} messages`, "badge-info")}</td>
      <td><span class="history-preview">${escapeHtml(chat.lastMessagePreview || "No messages")}</span></td>
      <td>${escapeHtml(formatDate(chat.updatedAt))}</td>
      <td style="text-align:right">
        <button class="button button-small button-secondary" data-profile-open-chat="${escapeHtml(chat.id)}" type="button">
          Open
        </button>
      </td>
    </tr>
  `;
}

async function loadProxyTab() {
  try {
    const payload = await api.userProxyHistory(loadedUserId, tabStates.proxy);
    const logs = payload.logs || [];
    const pagination = payload.pagination || { page: 1, totalPages: 1, total: logs.length };

    return `
      <form class="toolbar profile-filter" id="profile-proxy-form">
        <div class="toolbar-group">
          <input class="field search-field" id="profile-proxy-search" type="search" value="${escapeHtml(tabStates.proxy.search)}" placeholder="Search query, URL or domain..." />
          <select class="select-field" id="profile-proxy-status">
            <option value="">All statuses</option>
            <option value="success" ${tabStates.proxy.status === "success" ? "selected" : ""}>Success</option>
            <option value="failure" ${tabStates.proxy.status === "failure" ? "selected" : ""}>Failure</option>
          </select>
          <button class="button button-secondary" type="submit">Filter</button>
        </div>
        ${badge(`${formatNumber(pagination.total)} requests`, "badge-info")}
      </form>

      ${panel({
        title: "Proxy history",
        subtitle: `Searches and destinations recorded for ${profilePayload.user.username}`,
        flush: true,
        body: logs.length
          ? `
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Search or URL</th><th>Domain</th><th>Engine</th><th>Status</th><th>Time</th></tr></thead>
                <tbody>${logs.map(proxyRow).join("")}</tbody>
              </table>
            </div>
            ${profilePager("proxy", pagination)}
          `
          : emptyState("No proxy history", "No proxy searches have been logged for this user."),
      })}
    `;
  } catch (error) {
    return errorState(error.message);
  }
}

function proxyRow(log) {
  const main = log.proxyQuery || log.proxyTargetUrl || "No query or URL recorded";
  const detail = log.proxyQuery && log.proxyTargetUrl ? log.proxyTargetUrl : log.action || "proxy.navigation";

  return `
    <tr>
      <td>
        <span class="table-primary-copy history-wide-cell">
          <strong>${escapeHtml(main)}</strong>
          <span title="${escapeHtml(detail)}">${escapeHtml(detail)}</span>
        </span>
      </td>
      <td>${escapeHtml(log.proxyTargetDomain || "Unknown")}</td>
      <td>${badge(log.proxyEngine || "bare", "badge-info")}</td>
      <td>${badge(log.status || "unknown", statusClass(log.status))}</td>
      <td>${escapeHtml(formatDate(log.createdAt))}</td>
    </tr>
  `;
}



async function loadUsageTab() {
  try {
    const payload = await api.userUsage(loadedUserId);
    const effective = payload.effective || {};
    const usage = payload.usage?.totals || {};
    const override = payload.override || {};
    const violations = payload.usage?.recentViolations || [];

    return `
      <section class="metric-grid profile-metric-grid">
        ${usageMetric("AI messages today", usage.aiMessagesToday, effective.aiMessagesDaily)}
        ${usageMetric("AI images today", usage.aiImagesToday, effective.aiImagesDaily)}
        ${usageMetric("Proxy requests today", usage.proxyRequestsToday, effective.proxyRequestsDaily)}
        ${usageMetric("Proxy requests/minute", usage.proxyRequestsMinute, effective.proxyRequestsMinute)}
      </section>

      <section class="dashboard-grid">
        ${panel({
          title: "Custom account limits",
          subtitle: "Leave a field blank to inherit the role policy. Enter 0 for unlimited.",
          body: `
            <form class="usage-override-form" id="profile-usage-form">
              <div class="usage-override-grid">
                ${overrideField("AI messages / day", "usage-ai-messages", override.aiMessagesDaily, effective.aiMessagesDaily)}
                ${overrideField("AI images / day", "usage-ai-images", override.aiImagesDaily, effective.aiImagesDaily)}
                ${overrideField("Proxy requests / minute", "usage-proxy-minute", override.proxyRequestsMinute, effective.proxyRequestsMinute)}
                ${overrideField("Proxy requests / day", "usage-proxy-day", override.proxyRequestsDaily, effective.proxyRequestsDaily)}
                ${overrideField("Suspend after violations", "usage-auto-after", override.autoSuspendAfterViolations, effective.autoSuspendAfterViolations)}
                ${overrideField("Automatic suspension minutes", "usage-auto-minutes", override.autoSuspendMinutes, effective.autoSuspendMinutes, 5)}
              </div>

              <div class="modal-actions usage-actions">
                <button class="button button-secondary" id="profile-clear-usage" type="button">
                  Restore role limits
                </button>
                <button class="button button-ghost" id="profile-reset-usage" type="button">
                  Reset today's counters
                </button>
                <button class="button button-primary" id="profile-save-usage" type="submit">
                  Save custom limits
                </button>
              </div>
            </form>
          `,
        })}

        ${panel({
          title: "Effective policy",
          subtitle: `Role policy: ${profilePayload.user.role}`,
          body: `
            <div class="profile-detail-list">
              ${detailRow("AI messages/day", limitText(effective.aiMessagesDaily))}
              ${detailRow("AI images/day", limitText(effective.aiImagesDaily))}
              ${detailRow("Proxy requests/minute", limitText(effective.proxyRequestsMinute))}
              ${detailRow("Proxy requests/day", limitText(effective.proxyRequestsDaily))}
              ${detailRow("Violation window", `${effective.violationWindowMinutes || 60} minutes`)}
              ${detailRow("Automatic suspension", effective.autoSuspendAfterViolations > 0 ? `${effective.autoSuspendAfterViolations} violations → ${effective.autoSuspendMinutes} minutes` : "Disabled")}
            </div>
          `,
        })}
      </section>

      <div style="height:14px"></div>

      ${panel({
        title: "Recent usage violations",
        subtitle: "Blocked requests for this account",
        flush: true,
        body: violations.length
          ? `
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Limit</th><th>Usage</th><th>Requested</th><th>Time</th></tr></thead>
                <tbody>${violations.map(usageViolationRow).join("")}</tbody>
              </table>
            </div>
          `
          : emptyState("No usage violations", "This account has not triggered a usage limit."),
      })}
    `;
  } catch (error) {
    return errorState(error.message);
  }
}

function usageMetric(label, used, limit) {
  const normalizedLimit = Number(limit || 0);
  const subtitle = normalizedLimit > 0
    ? `${formatNumber(used || 0)} of ${formatNumber(normalizedLimit)}`
    : `${formatNumber(used || 0)} used · unlimited`;

  return metricCard(label, formatNumber(used || 0), subtitle);
}

function limitText(value) {
  return Number(value || 0) === 0 ? "Unlimited" : formatNumber(value);
}

function overrideField(label, id, value, inherited, minimum = 0) {
  return `
    <label class="form-field compact-field">
      <span>${escapeHtml(label)}</span>
      <input
        class="field"
        id="${escapeHtml(id)}"
        type="number"
        min="${minimum}"
        step="1"
        value="${value === null || value === undefined ? "" : escapeHtml(value)}"
        placeholder="Inherit (${escapeHtml(limitText(inherited))})"
      />
    </label>
  `;
}

function optionalNumberValue(container, selector) {
  const raw = container.querySelector(selector)?.value.trim() || "";
  return raw === "" ? null : Number(raw);
}

function usageViolationRow(item) {
  const metadata = item.metadata || {};
  const labels = {
    ai_messages_daily: "AI messages/day",
    ai_images_daily: "AI images/day",
    proxy_requests_minute: "Proxy/minute",
    proxy_requests_daily: "Proxy/day",
  };

  return `
    <tr>
      <td>${badge(labels[metadata.blockedType] || metadata.blockedType || "Unknown", "badge-warning")}</td>
      <td>${escapeHtml(formatNumber(metadata.used))} / ${escapeHtml(formatNumber(metadata.limit))}</td>
      <td>${escapeHtml(formatNumber(metadata.requested))}</td>
      <td>${escapeHtml(formatDate(item.created_at))}</td>
    </tr>
  `;
}

async function loadSecurityTab() {
  try {
    const payload = await api.userSecuritySessions(loadedUserId);
    const sessions = payload.sessions || [];
    const summary = payload.summary || {};

    return `
      <section class="metric-grid profile-metric-grid">
        ${metricCard("Active sessions", formatNumber(summary.activeSessions), "Seen within 15 minutes")}
        ${metricCard("Known devices", formatNumber(summary.knownDevices), "Distinct device fingerprints")}
        ${metricCard("Known IPs", formatNumber(summary.knownIps), "Distinct recorded addresses")}
        ${metricCard("Revoked sessions", formatNumber(summary.revokedSessions), "Blocked sessions")}
      </section>

      <div class="toolbar profile-security-toolbar">
        <p class="profile-security-note">
          Multiple sessions can be normal. A warning becomes stronger when different devices are active at the same time.
        </p>
        <button class="button button-danger" id="profile-revoke-all-sessions" type="button">
          Revoke all sessions
        </button>
      </div>

      ${panel({
        title: "Login sessions",
        subtitle: `Tracked app sessions for ${profilePayload.user.username}`,
        flush: true,
        body: sessions.length
          ? `
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Device</th><th>IP address</th><th>First seen</th><th>Last seen</th><th>Status</th><th style="text-align:right">Action</th></tr></thead>
                <tbody>${sessions.map(profileSecuritySessionRow).join("")}</tbody>
              </table>
            </div>
          `
          : emptyState("No tracked sessions", "Sessions will appear after this user signs in again."),
      })}
    `;
  } catch (error) {
    return errorState(error.message);
  }
}

function profileSecuritySessionRow(session) {
  const status = session.revokedAt
    ? badge("revoked", "badge-danger")
    : session.active
      ? badge("active", "badge-success")
      : session.expired
        ? badge("expired", "badge-warning")
        : badge("inactive", "badge-info");

  return `
    <tr class="${session.multipleDeviceActive ? "security-row-warning" : ""}">
      <td><span class="table-primary-copy"><strong>${escapeHtml(session.browser || "Unknown browser")}</strong><span>${escapeHtml(`${session.operatingSystem || "Unknown OS"} · ${session.deviceType || "device"}`)}</span></span></td>
      <td><span class="profile-monospace">${escapeHtml(session.ipAddress || "Unknown")}</span></td>
      <td>${escapeHtml(formatDate(session.firstSeenAt))}</td>
      <td>${escapeHtml(formatDate(session.lastSeenAt))}</td>
      <td>${status}</td>
      <td style="text-align:right"><button class="button button-small button-danger" type="button" data-profile-revoke-session="${escapeHtml(session.id)}" ${session.revokedAt ? "disabled" : ""}>Revoke</button></td>
    </tr>
  `;
}

async function loadActivityTab() {
  try {
    const payload = await api.userActivity(loadedUserId, tabStates.activity);
    const logs = payload.logs || [];
    const pagination = payload.pagination || { page: 1, totalPages: 1, total: logs.length };

    return `
      <form class="toolbar profile-filter" id="profile-activity-form">
        <div class="toolbar-group">
          <select class="select-field" id="profile-activity-category">
            <option value="">All categories</option>
            ${["auth", "admin", "ai", "proxy", "page", "system"]
              .map((category) => `<option value="${category}" ${tabStates.activity.category === category ? "selected" : ""}>${category}</option>`)
              .join("")}
          </select>
          <select class="select-field" id="profile-activity-status">
            <option value="">All statuses</option>
            ${["success", "failure", "informational"]
              .map((status) => `<option value="${status}" ${tabStates.activity.status === status ? "selected" : ""}>${status}</option>`)
              .join("")}
          </select>
          <button class="button button-secondary" type="submit">Filter</button>
        </div>
        ${badge(`${formatNumber(pagination.total)} events`, "badge-info")}
      </form>

      ${panel({
        title: "Account activity",
        subtitle: "Events performed by, for or against this user",
        flush: true,
        body: logs.length
          ? `
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Event</th><th>Category</th><th>Status</th><th>Client</th><th>Time</th></tr></thead>
                <tbody>${logs.map(activityRow).join("")}</tbody>
              </table>
            </div>
            ${profilePager("activity", pagination)}
          `
          : emptyState("No activity found", "No matching account events were found."),
      })}
    `;
  } catch (error) {
    return errorState(error.message);
  }
}

function activityRow(log) {
  return `
    <tr>
      <td>
        <div class="table-primary">
          <span class="table-avatar">${escapeHtml(activityIcon(log.category, log.action))}</span>
          <span class="table-primary-copy">
            <strong>${escapeHtml(log.description || log.action || "Activity event")}</strong>
            <span>${escapeHtml(log.action || "unknown")}</span>
          </span>
        </div>
      </td>
      <td>${badge(log.category || "unknown", "badge-info")}</td>
      <td>${badge(log.status || "unknown", statusClass(log.status))}</td>
      <td>
        <span class="table-primary-copy">
          <strong>${escapeHtml(log.browser || "Unknown browser")}</strong>
          <span>${escapeHtml(`${log.operatingSystem || "Unknown OS"} · ${log.deviceType || "device"}`)}</span>
        </span>
      </td>
      <td>${escapeHtml(formatDate(log.createdAt))}</td>
    </tr>
  `;
}

function profilePager(type, pagination) {
  return `
    <div class="pager">
      <span>Page ${pagination.page} of ${pagination.totalPages}</span>
      <div class="pager-actions">
        <button class="button button-small button-secondary" data-profile-page="previous" data-profile-page-type="${type}" type="button" ${pagination.page <= 1 ? "disabled" : ""}>Previous</button>
        <button class="button button-small button-secondary" data-profile-page="next" data-profile-page-type="${type}" type="button" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>Next</button>
      </div>
    </div>
  `;
}

function bindCommonEvents(container) {
  container.querySelector("#profile-back")?.addEventListener("click", () => navigate("users"));

  container.querySelector("#copy-user-id")?.addEventListener("click", async () => {
    try {
      await copyText(profilePayload.user.id);
      showToast("User ID copied to your clipboard.", "success", "Copied");
    } catch {
      showToast("The user ID could not be copied.", "error");
    }
  });

  const roleSelect = container.querySelector("#profile-role-select");
  roleSelect?.addEventListener("change", async () => {
    const previousRole = profilePayload.user.role;
    const nextRole = roleSelect.value;

    if (previousRole === nextRole) return;

    if (!window.confirm(`Change ${profilePayload.user.username}'s role from ${previousRole} to ${nextRole}?`)) {
      roleSelect.value = previousRole;
      return;
    }

    roleSelect.disabled = true;

    try {
      const result = await api.updateRole(loadedUserId, nextRole);
      profilePayload.user.role = result.profile.role;
      showToast(`${profilePayload.user.username} is now ${result.profile.role}.`, "success", "Role updated");
      await paint(container);
    } catch (error) {
      roleSelect.value = previousRole;
      roleSelect.disabled = false;
      showToast(error.message, "error");
    }
  });

  const suspendButton = container.querySelector("#profile-suspend-button");
  suspendButton?.addEventListener("click", () => {
    openProfileSuspensionModal(container);
  });

  const banButton = container.querySelector("#profile-ban-button");
  banButton?.addEventListener("click", async () => {
    const nextBanned = !profilePayload.user.banned;
    const verb = nextBanned ? "ban" : "unban";

    if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${profilePayload.user.username}?`)) {
      return;
    }

    setButtonBusy(banButton, true, nextBanned ? "Banning..." : "Unbanning...");

    try {
      const result = await api.updateBan(loadedUserId, nextBanned);
      profilePayload.user.banned = result.profile.banned;
      showToast(`${profilePayload.user.username} was ${nextBanned ? "banned" : "unbanned"}.`, "success", "Account updated");
      await paint(container);
    } catch (error) {
      showToast(error.message, "error");
      setButtonBusy(banButton, false);
    }
  });
}

function bindTabEvents(container) {
  container.querySelectorAll("[data-profile-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      activeTab = button.dataset.profileTab;
      container.innerHTML = loadingState(`Loading ${button.textContent.trim()}...`);
      await paint(container);
    });
  });

  container.querySelectorAll("[data-profile-page-type]").forEach((button) => {
    button.addEventListener("click", async () => {
      const type = button.dataset.profilePageType;
      const direction = button.dataset.profilePage;
      const state = tabStates[type];

      state.page = direction === "next" ? state.page + 1 : Math.max(1, state.page - 1);
      container.innerHTML = loadingState("Loading next page...");
      await paint(container);
    });
  });

  container.querySelector("#profile-proxy-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    tabStates.proxy.page = 1;
    tabStates.proxy.search = container.querySelector("#profile-proxy-search").value.trim();
    tabStates.proxy.status = container.querySelector("#profile-proxy-status").value;
    container.innerHTML = loadingState("Filtering proxy history...");
    await paint(container);
  });

  container.querySelector("#profile-activity-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    tabStates.activity.page = 1;
    tabStates.activity.category = container.querySelector("#profile-activity-category").value;
    tabStates.activity.status = container.querySelector("#profile-activity-status").value;
    container.innerHTML = loadingState("Filtering activity...");
    await paint(container);
  });

  container.querySelector("#profile-usage-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = container.querySelector("#profile-save-usage");
    setButtonBusy(button, true, "Saving...");

    try {
      await api.updateUserUsage(loadedUserId, {
        aiMessagesDaily: optionalNumberValue(container, "#usage-ai-messages"),
        aiImagesDaily: optionalNumberValue(container, "#usage-ai-images"),
        proxyRequestsMinute: optionalNumberValue(container, "#usage-proxy-minute"),
        proxyRequestsDaily: optionalNumberValue(container, "#usage-proxy-day"),
        autoSuspendAfterViolations: optionalNumberValue(container, "#usage-auto-after"),
        autoSuspendMinutes: optionalNumberValue(container, "#usage-auto-minutes"),
      });
      showToast("Custom usage limits were saved.", "success", "Limits updated");
      await paint(container);
    } catch (error) {
      showToast(error.message, "error");
      setButtonBusy(button, false);
    }
  });

  container.querySelector("#profile-clear-usage")?.addEventListener("click", async (event) => {
    if (!window.confirm(`Restore ${profilePayload.user.username}'s role-based limits?`)) return;
    const button = event.currentTarget;
    setButtonBusy(button, true, "Restoring...");
    try {
      await api.clearUserUsageOverride(loadedUserId);
      showToast("Role-based limits were restored.", "success", "Overrides cleared");
      await paint(container);
    } catch (error) {
      showToast(error.message, "error");
      setButtonBusy(button, false);
    }
  });

  container.querySelector("#profile-reset-usage")?.addEventListener("click", async (event) => {
    if (!window.confirm(`Reset today's AI and proxy counters for ${profilePayload.user.username}?`)) return;
    const button = event.currentTarget;
    setButtonBusy(button, true, "Resetting...");
    try {
      await api.resetUserUsage(loadedUserId);
      showToast("Today's usage counters were reset.", "success", "Usage reset");
      await paint(container);
    } catch (error) {
      showToast(error.message, "error");
      setButtonBusy(button, false);
    }
  });

  container.querySelectorAll("[data-profile-open-chat]").forEach((button) => {
    button.addEventListener("click", () => openChat(container, button.dataset.profileOpenChat));
  });

  container.querySelectorAll("[data-profile-revoke-session]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm(`Revoke this login session for ${profilePayload.user.username}?`)) return;
      setButtonBusy(button, true, "Revoking...");
      try {
        await api.revokeSecuritySession(button.dataset.profileRevokeSession);
        showToast("The login session was revoked.", "success", "Session blocked");
        await paint(container);
      } catch (error) {
        showToast(error.message, "error");
        setButtonBusy(button, false);
      }
    });
  });

  container.querySelector("#profile-revoke-all-sessions")?.addEventListener("click", async (event) => {
    if (!window.confirm(`Revoke every tracked login session for ${profilePayload.user.username}?`)) return;
    const button = event.currentTarget;
    setButtonBusy(button, true, "Revoking...");
    try {
      await api.revokeUserSessions(loadedUserId, false);
      showToast("All tracked sessions were revoked.", "success", "Account signed out");
      await paint(container);
    } catch (error) {
      showToast(error.message, "error");
      setButtonBusy(button, false);
    }
  });
}


function localDateTimeValue(value) {
  const date = value
    ? new Date(value)
    : new Date(Date.now() + 24 * 60 * 60 * 1000);

  if (!Number.isFinite(date.getTime())) return "";

  const shifted = new Date(
    date.getTime() - date.getTimezoneOffset() * 60 * 1000,
  );

  return shifted.toISOString().slice(0, 16);
}

function openProfileSuspensionModal(container) {
  const user = profilePayload.user;
  const root = container.querySelector("#profile-modal-root");

  root.innerHTML = `
    <div class="history-modal-backdrop" data-profile-suspension-backdrop>
      <section class="history-modal suspension-modal" role="dialog" aria-modal="true">
        <header class="history-modal-header">
          <div>
            <p class="eyebrow">Temporary account restriction</p>
            <h2>${escapeHtml(user.suspended ? "Manage suspension" : "Suspend account")}</h2>
            <span>${escapeHtml(user.username || user.email || "User")}</span>
          </div>
          <button class="icon-button" id="profile-suspension-close" type="button">×</button>
        </header>

        <form class="suspension-form" id="profile-suspension-form">
          ${user.suspended ? `
            <div class="suspension-current">
              <strong>Currently suspended</strong>
              <span>Until ${escapeHtml(formatDate(user.suspendedUntil))}</span>
              <p>${escapeHtml(user.suspensionReason || "No reason recorded.")}</p>
            </div>
          ` : ""}

          <label class="form-field">
            <span>Duration</span>
            <select class="select-field" id="profile-suspension-duration">
              <option value="15">15 minutes</option>
              <option value="60">1 hour</option>
              <option value="360">6 hours</option>
              <option value="1440" selected>1 day</option>
              <option value="4320">3 days</option>
              <option value="10080">7 days</option>
              <option value="43200">30 days</option>
              <option value="custom">Custom date and time</option>
            </select>
          </label>

          <label class="form-field is-hidden" id="profile-suspension-custom-wrap">
            <span>Suspended until</span>
            <input class="field" id="profile-suspension-custom" type="datetime-local" value="${escapeHtml(localDateTimeValue(user.suspendedUntil))}" />
          </label>

          <label class="form-field">
            <span>Reason</span>
            <textarea class="field textarea-field" id="profile-suspension-reason" maxlength="500" required placeholder="Explain why this account is being suspended...">${escapeHtml(user.suspensionReason || "")}</textarea>
          </label>

          <div class="modal-actions">
            ${user.suspended ? `<button class="button button-secondary" id="profile-unsuspend-now" type="button">Unsuspend now</button>` : ""}
            <button class="button button-ghost" id="profile-suspension-cancel" type="button">Cancel</button>
            <button class="button button-warning" id="profile-suspension-save" type="submit">${user.suspended ? "Update suspension" : "Suspend account"}</button>
          </div>
        </form>
      </section>
    </div>
  `;

  const close = () => { root.innerHTML = ""; };
  root.querySelector("#profile-suspension-close")?.addEventListener("click", close);
  root.querySelector("#profile-suspension-cancel")?.addEventListener("click", close);
  root.querySelector("[data-profile-suspension-backdrop]")?.addEventListener("mousedown", (event) => {
    if (event.target.dataset.profileSuspensionBackdrop !== undefined) close();
  });

  const duration = root.querySelector("#profile-suspension-duration");
  const customWrap = root.querySelector("#profile-suspension-custom-wrap");
  duration.addEventListener("change", () => {
    customWrap.classList.toggle("is-hidden", duration.value !== "custom");
  });

  root.querySelector("#profile-unsuspend-now")?.addEventListener("click", async (event) => {
    if (!window.confirm(`Unsuspend ${user.username} now?`)) return;
    const button = event.currentTarget;
    setButtonBusy(button, true, "Removing...");
    try {
      const result = await api.updateSuspension(loadedUserId, { suspendedUntil: null, reason: "" });
      applyProfileSuspension(result.profile);
      showToast(`${user.username} was unsuspended.`, "success", "Suspension removed");
      close();
      await paint(container);
    } catch (error) {
      showToast(error.message, "error");
      setButtonBusy(button, false);
    }
  });

  root.querySelector("#profile-suspension-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const reason = root.querySelector("#profile-suspension-reason").value.trim();
    let suspendedUntil;

    if (duration.value === "custom") {
      const parsed = new Date(root.querySelector("#profile-suspension-custom").value);
      if (!Number.isFinite(parsed.getTime())) {
        showToast("Choose a valid suspension expiration time.", "error");
        return;
      }
      suspendedUntil = parsed.toISOString();
    } else {
      suspendedUntil = new Date(Date.now() + Number(duration.value) * 60 * 1000).toISOString();
    }

    const button = root.querySelector("#profile-suspension-save");
    setButtonBusy(button, true, "Saving...");
    try {
      const result = await api.updateSuspension(loadedUserId, { suspendedUntil, reason });
      applyProfileSuspension(result.profile);
      showToast(`${user.username} is suspended until ${formatDate(suspendedUntil)}.`, "success", "Account suspended");
      close();
      await paint(container);
    } catch (error) {
      showToast(error.message, "error");
      setButtonBusy(button, false);
    }
  });
}

function applyProfileSuspension(profile) {
  profilePayload.user.suspended = profile.suspended;
  profilePayload.user.suspendedUntil = profile.suspendedUntil;
  profilePayload.user.suspensionReason = profile.suspensionReason;
  profilePayload.user.suspensionSource = profile.suspensionSource;
}

async function openChat(container, chatId) {
  const root = container.querySelector("#profile-modal-root");
  root.innerHTML = '<div class="history-modal-backdrop"><section class="history-modal"><div class="page-loading"><span class="spinner"></span><p>Loading conversation...</p></div></section></div>';

  try {
    const payload = await api.aiChatDetails(chatId);
    const chat = payload.chat || {};
    const messages = payload.messages || [];

    root.innerHTML = `
      <div class="history-modal-backdrop" data-profile-modal-backdrop>
        <section class="history-modal">
          <header class="history-modal-header">
            <div>
              <p class="eyebrow">${escapeHtml(chat.username || profilePayload.user.username)}</p>
              <h2>${escapeHtml(chat.title || "New chat")}</h2>
              <span>${messages.length} messages · ${escapeHtml(formatDate(chat.updatedAt))}</span>
            </div>
            <button class="icon-button" id="profile-modal-close" type="button">×</button>
          </header>
          <div class="history-message-list">
            ${messages.length ? messages.map(messageRow).join("") : emptyState("No messages", "This chat is empty.")}
          </div>
        </section>
      </div>
    `;

    root.querySelector("#profile-modal-close")?.addEventListener("click", () => root.innerHTML = "");
    root.querySelector("[data-profile-modal-backdrop]")?.addEventListener("mousedown", (event) => {
      if (event.target.dataset.profileModalBackdrop !== undefined) root.innerHTML = "";
    });
  } catch (error) {
    root.innerHTML = `<div class="history-modal-backdrop"><section class="history-modal"><div class="page-error"><h3>Conversation unavailable</h3><p>${escapeHtml(error.message)}</p><button class="button button-secondary" id="profile-modal-error-close" type="button">Close</button></div></section></div>`;
    root.querySelector("#profile-modal-error-close")?.addEventListener("click", () => root.innerHTML = "");
  }
}

function messageRow(message) {
  const role = message.role === "assistant" ? "assistant" : "user";

  return `
    <article class="history-message history-message-${role}">
      <header>
        <strong>${role === "assistant" ? "Fuzz AI" : profilePayload.user.username}</strong>
        <time>${escapeHtml(formatDate(message.createdAt))}</time>
      </header>
      ${message.hasImage ? badge(`Image attached${message.imageName ? ` · ${message.imageName}` : ""}`, "badge-info") : ""}
      <pre>${escapeHtml(message.content || "")}</pre>
    </article>
  `;
}
