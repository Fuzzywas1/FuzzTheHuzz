const content = document.getElementById("account-content");
const modalRoot = document.getElementById("account-modal-root");
const toastRoot = document.getElementById("account-toast-root");
const statusChip = document.getElementById("account-status-chip");

const state = {
  route: "overview",
  overview: null,
  preferences: null,
  ai: { page: 1, search: "" },
  proxy: { page: 1, search: "" },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function formatDuration(ms) {
  if (!Number.isFinite(Number(ms))) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.hash)}`;
    throw new Error("Your login session expired.");
  }

  if (response.status === 423) {
    window.location.href = "/suspended";
    throw new Error("This account is suspended.");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function loading(label = "Loading…") {
  content.innerHTML = `<div class="account-loading"><span></span><p>${escapeHtml(label)}</p></div>`;
}

function errorState(message) {
  content.innerHTML = `
    <div class="account-error">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <h3>Something went wrong</h3>
      <p>${escapeHtml(message)}</p>
      <button class="account-button" data-retry type="button">Try again</button>
    </div>`;
  content.querySelector("[data-retry]")?.addEventListener("click", renderRoute);
}

function emptyState(title, message, icon = "fa-inbox") {
  return `<div class="account-empty"><i class="fa-solid ${icon}"></i><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div>`;
}

function toast(message, type = "success") {
  const node = document.createElement("div");
  node.className = `account-toast ${type}`;
  node.textContent = message;
  toastRoot.appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

function badge(label, kind = "") {
  return `<span class="account-badge ${kind}">${escapeHtml(label)}</span>`;
}

function panel(title, subtitle, body, actions = "") {
  return `
    <section class="account-panel">
      <header class="account-panel-header">
        <div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div>
        ${actions}
      </header>
      <div class="account-panel-body">${body}</div>
    </section>`;
}

function metric(label, value, caption) {
  return `<article class="account-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(caption)}</small></article>`;
}

function usageRow(label, used, limit) {
  const numericLimit = Number(limit || 0);
  const percent = numericLimit > 0 ? Math.min(100, Math.round((Number(used || 0) / numericLimit) * 100)) : 0;
  const value = numericLimit > 0 ? `${formatNumber(used)} / ${formatNumber(numericLimit)}` : `${formatNumber(used)} / Unlimited`;
  return `<div><div class="account-usage-head"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div><div class="account-progress"><span style="width:${percent}%"></span></div></div>`;
}

function setRoute(route, push = true) {
  const allowed = new Set(["overview", "security", "ai", "privacy", "preferences"]);
  state.route = allowed.has(route) ? route : "overview";
  if (push) history.pushState({}, "", `#${state.route}`);
  document.querySelectorAll("[data-account-route]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.accountRoute === state.route);
  });
  renderRoute();
}

async function loadOverview(force = false) {
  if (!state.overview || force) {
    state.overview = await request("/api/account/overview");
    state.preferences = state.overview.preferences;
  }
  return state.overview;
}

async function renderOverview() {
  loading("Loading account overview…");
  const payload = await loadOverview(true);
  const account = payload.account || {};
  const stats = payload.stats || {};
  const usage = payload.usage || {};
  const totals = usage.totals || {};
  const policy = usage.policy || {};
  const suspension = account.suspension;

  statusChip.textContent = suspension?.active ? "Suspended" : `${account.role || "user"} · Active`;

  const suspensionCallout = suspension?.active
    ? `<div class="account-callout warning"><strong>Account suspended</strong><br>${escapeHtml(suspension.reason || "No reason provided.")}<br>Ends: ${escapeHtml(formatDate(suspension.suspendedUntil))}</div>`
    : "";

  content.innerHTML = `
    <div class="account-section">
      ${suspensionCallout}
      <section class="account-metrics">
        ${metric("AI chats", formatNumber(stats.aiChats), `${formatNumber(stats.aiMessages)} saved messages`)}
        ${metric("Proxy requests", formatNumber(stats.proxyRequests), "Detailed history stored")}
        ${metric("Active sessions", formatNumber(stats.activeSessions), "Devices active recently")}
        ${metric("Account role", account.role || "user", account.emailVerified ? "Email verified" : "Email not verified")}
      </section>

      <div class="account-grid-2">
        ${panel("Account details", "Your identity and account status", `
          <div class="account-details">
            <div class="account-detail"><span>Username</span><strong>${escapeHtml(account.username)}</strong></div>
            <div class="account-detail"><span>Email</span><strong>${escapeHtml(account.email)}</strong></div>
            <div class="account-detail"><span>Email verification</span><strong>${account.emailVerified ? "Verified" : "Not verified"}</strong></div>
            <div class="account-detail"><span>Created</span><strong>${escapeHtml(formatDate(account.createdAt))}</strong></div>
            <div class="account-detail"><span>Last sign-in</span><strong>${escapeHtml(formatDate(account.lastSignInAt))}</strong></div>
            <div class="account-detail"><span>Invite code used</span><strong>${escapeHtml(payload.invite?.code || "Unavailable")}</strong></div>
            <div class="account-detail"><span>User ID</span><strong title="${escapeHtml(account.id)}">${escapeHtml(account.id)}</strong></div>
          </div>
        `)}

        ${panel("Today's usage", "Limits reset according to the server's UTC day", `
          <div class="account-usage-list">
            ${usageRow("Fuzz AI messages", totals.aiMessagesToday, policy.aiMessagesDaily)}
            ${usageRow("AI image uploads", totals.aiImagesToday, policy.aiImagesDaily)}
            ${usageRow("Proxy requests today", totals.proxyRequestsToday, policy.proxyRequestsDaily)}
            ${usageRow("Proxy requests this minute", totals.proxyRequestsMinute, policy.proxyRequestsMinute)}
          </div>
        `)}
      </div>

      ${payload.deletionRequest ? `<div class="account-callout danger">An account-deletion request is pending from ${escapeHtml(formatDate(payload.deletionRequest.requested_at))}. You can cancel it from Privacy.</div>` : ""}
    </div>`;
}

async function renderSecurity() {
  loading("Loading security information…");
  const payload = await request("/api/account/security");
  const sessions = payload.sessions || [];
  const activity = payload.activity || [];

  content.innerHTML = `
    <div class="account-section">
      <section class="account-metrics">
        ${metric("Active sessions", formatNumber(payload.summary?.activeSessions), "Seen within the active window")}
        ${metric("Known devices", formatNumber(payload.summary?.knownDevices), "Tracked browser/device signatures")}
        ${metric("Known IPs", formatNumber(payload.summary?.knownIps), "Network addresses recorded")}
        ${metric("Security events", formatNumber(activity.length), "Most recent activity shown")}
      </section>

      ${panel("Logged-in devices", "Revoke a device you do not recognize", sessions.length ? `
        <div class="account-toolbar" style="margin-bottom:12px"><div></div><button class="account-button warning" id="revoke-other-sessions" type="button"><i class="fa-solid fa-right-from-bracket"></i>Sign out other devices</button></div>
        <div class="account-table-wrap"><table class="account-table"><thead><tr><th>Device</th><th>IP address</th><th>Last active</th><th>Status</th><th></th></tr></thead><tbody>
          ${sessions.map((session) => `<tr><td><div class="account-primary-copy"><strong>${escapeHtml(session.browser || "Unknown browser")} · ${escapeHtml(session.operatingSystem || "Unknown OS")}</strong><span>${escapeHtml(session.deviceType || "Unknown device")}${session.current ? " · This device" : ""}</span></div></td><td>${escapeHtml(session.ipAddress || "Unknown")}</td><td>${escapeHtml(formatDate(session.lastSeenAt))}</td><td>${session.current ? badge("Current", "success") : session.active ? badge("Active", "success") : session.revokedAt ? badge("Revoked", "danger") : badge("Expired")}</td><td>${!session.current && !session.revokedAt ? `<button class="account-button small danger" data-revoke-session="${escapeHtml(session.id)}" type="button">Revoke</button>` : ""}</td></tr>`).join("")}
        </tbody></table></div>
      ` : emptyState("No tracked devices", "Your current login will appear after the next security heartbeat.", "fa-shield"))}

      <div class="account-grid-2">
        ${panel("Change password", "Your current password is required", `
          <form id="password-form" class="account-form">
            <label class="account-label">Current password<input class="account-field" id="current-password" type="password" autocomplete="current-password" required /></label>
            <label class="account-label">New password<input class="account-field" id="new-password" type="password" minlength="8" autocomplete="new-password" required /></label>
            <label class="account-label">Confirm new password<input class="account-field" id="confirm-password" type="password" minlength="8" autocomplete="new-password" required /></label>
            <p class="account-help">Changing your password signs out every other tracked device.</p>
            <div><button class="account-button primary" type="submit">Change password</button></div>
          </form>
        `)}

        ${panel("Recent security activity", "Sign-ins, new devices, IP changes, and session actions", activity.length ? `<div class="account-details">${activity.slice(0,12).map((item) => `<div class="account-detail"><span>${escapeHtml(formatDate(item.created_at))}</span><strong title="${escapeHtml(item.description)}">${escapeHtml(item.description || item.action)}</strong></div>`).join("")}</div>` : emptyState("No recent security events", "Security activity will appear here after account events.", "fa-shield-halved"))}
      </div>
    </div>`;

  content.querySelectorAll("[data-revoke-session]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Sign out this device?")) return;
      button.disabled = true;
      try {
        await request(`/api/account/security/sessions/${encodeURIComponent(button.dataset.revokeSession)}/revoke`, { method: "POST", body: "{}" });
        toast("Device signed out.");
        renderSecurity();
      } catch (error) { toast(error.message, "error"); button.disabled = false; }
    });
  });

  content.querySelector("#revoke-other-sessions")?.addEventListener("click", async (event) => {
    if (!confirm("Sign out every other tracked device?")) return;
    event.currentTarget.disabled = true;
    try {
      const result = await request("/api/account/security/revoke-others", { method: "POST", body: "{}" });
      toast(`${result.revokedCount || 0} other session(s) signed out.`);
      renderSecurity();
    } catch (error) { toast(error.message, "error"); event.currentTarget.disabled = false; }
  });

  content.querySelector("#password-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentPassword = content.querySelector("#current-password").value;
    const newPassword = content.querySelector("#new-password").value;
    const confirmPassword = content.querySelector("#confirm-password").value;
    if (newPassword !== confirmPassword) { toast("The new passwords do not match.", "error"); return; }
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const result = await request("/api/account/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      event.currentTarget.reset();
      toast(result.message || "Password changed.");
    } catch (error) { toast(error.message, "error"); }
    finally { button.disabled = false; }
  });
}

async function renderAi() {
  loading("Loading saved Fuzz AI chats…");
  const params = new URLSearchParams({ page: String(state.ai.page), limit: "30" });
  if (state.ai.search) params.set("search", state.ai.search);
  const payload = await request(`/api/account/ai/chats?${params}`);
  const chats = payload.chats || [];
  const pagination = payload.pagination || { page: 1, totalPages: 1, total: 0 };
  const overview = await loadOverview();
  const totals = overview.usage?.totals || {};
  const policy = overview.usage?.policy || {};

  content.innerHTML = `
    <div class="account-section">
      <section class="account-metrics">
        ${metric("Saved chats", formatNumber(pagination.total), "Your Fuzz AI conversations")}
        ${metric("Messages today", formatNumber(totals.aiMessagesToday), policy.aiMessagesDaily ? `of ${formatNumber(policy.aiMessagesDaily)}` : "Unlimited")}
        ${metric("Images today", formatNumber(totals.aiImagesToday), policy.aiImagesDaily ? `of ${formatNumber(policy.aiImagesDaily)}` : "Unlimited")}
        ${metric("Response style", state.preferences?.aiBehavior || "balanced", "Change under Preferences")}
      </section>

      ${panel("Saved conversations", "Open, rename, export, or delete your chats", `
        <form id="ai-search-form" class="account-toolbar" style="margin-bottom:12px">
          <div class="account-toolbar-group"><input class="account-field" id="ai-search" type="search" value="${escapeHtml(state.ai.search)}" placeholder="Search chat titles…" style="width:260px" /><button class="account-button" type="submit">Search</button>${state.ai.search ? `<button class="account-button" id="clear-ai-search" type="button">Clear</button>` : ""}</div>
          <button class="account-button danger" id="delete-all-ai" type="button">Delete all AI history</button>
        </form>
        ${chats.length ? `<div class="account-table-wrap"><table class="account-table"><thead><tr><th>Chat</th><th>Messages</th><th>Updated</th><th></th></tr></thead><tbody>${chats.map((chat) => `<tr><td><div class="account-primary-copy"><strong>${escapeHtml(chat.title || "New chat")}</strong><span>${escapeHtml(chat.lastMessagePreview || "No saved messages")}</span></div></td><td>${badge(`${chat.messageCount || 0} messages`)}</td><td>${escapeHtml(formatDate(chat.updatedAt))}</td><td><div class="account-toolbar-group"><button class="account-button small" data-open-chat="${escapeHtml(chat.id)}" type="button">Open</button><button class="account-button small" data-rename-chat="${escapeHtml(chat.id)}" data-chat-title="${escapeHtml(chat.title || "New chat")}" type="button">Rename</button><button class="account-button small danger" data-delete-chat="${escapeHtml(chat.id)}" type="button">Delete</button></div></td></tr>`).join("")}</tbody></table></div><div class="account-toolbar" style="margin-top:12px"><span class="account-help">Page ${pagination.page} of ${pagination.totalPages}</span><div class="account-toolbar-group"><button class="account-button small" data-ai-page="previous" ${pagination.page <= 1 ? "disabled" : ""}>Previous</button><button class="account-button small" data-ai-page="next" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>Next</button></div></div>` : emptyState("No saved chats", "Start a conversation in Fuzz AI and it will appear here.", "fa-robot")}
      `)}
    </div>`;

  content.querySelector("#ai-search-form")?.addEventListener("submit", (event) => { event.preventDefault(); state.ai.search = content.querySelector("#ai-search").value.trim(); state.ai.page = 1; renderAi(); });
  content.querySelector("#clear-ai-search")?.addEventListener("click", () => { state.ai.search = ""; state.ai.page = 1; renderAi(); });
  content.querySelector("[data-ai-page=previous]")?.addEventListener("click", () => { state.ai.page = Math.max(1, state.ai.page - 1); renderAi(); });
  content.querySelector("[data-ai-page=next]")?.addEventListener("click", () => { state.ai.page += 1; renderAi(); });
  content.querySelectorAll("[data-open-chat]").forEach((button) => button.addEventListener("click", () => openChat(button.dataset.openChat)));
  content.querySelectorAll("[data-rename-chat]").forEach((button) => button.addEventListener("click", async () => {
    const title = prompt("New chat title:", button.dataset.chatTitle || "New chat");
    if (!title?.trim()) return;
    try { await request(`/api/ai/chats/${encodeURIComponent(button.dataset.renameChat)}`, { method: "PATCH", body: JSON.stringify({ title: title.trim() }) }); toast("Chat renamed."); renderAi(); } catch (error) { toast(error.message, "error"); }
  }));
  content.querySelectorAll("[data-delete-chat]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Delete this chat permanently?")) return;
    try { await request(`/api/ai/chats/${encodeURIComponent(button.dataset.deleteChat)}`, { method: "DELETE" }); toast("Chat deleted."); state.overview = null; renderAi(); } catch (error) { toast(error.message, "error"); }
  }));
  content.querySelector("#delete-all-ai")?.addEventListener("click", async () => {
    const confirmation = prompt("Type DELETE to permanently remove every saved AI chat and message:");
    if (confirmation !== "DELETE") return;
    try { const result = await request("/api/account/ai/history", { method: "DELETE", body: JSON.stringify({ confirm: confirmation }) }); toast(`Deleted ${result.deletedChats || 0} chats and ${result.deletedMessages || 0} messages.`); state.overview = null; renderAi(); } catch (error) { toast(error.message, "error"); }
  });
}

async function openChat(chatId) {
  modalRoot.innerHTML = `<div class="account-modal-backdrop"><section class="account-modal"><div class="account-loading"><span></span><p>Loading conversation…</p></div></section></div>`;
  try {
    const payload = await request(`/api/ai/chats/${encodeURIComponent(chatId)}`);
    const chat = payload.chat || {};
    const messages = payload.messages || [];
    modalRoot.innerHTML = `<div class="account-modal-backdrop" data-close-modal><section class="account-modal"><header class="account-modal-header"><div><h2>${escapeHtml(chat.title || "New chat")}</h2><p>${messages.length} messages · Updated ${escapeHtml(formatDate(chat.updated_at))}</p></div><div class="account-toolbar-group"><button class="account-button small" id="export-chat" type="button">Export</button><button class="account-button small" id="close-modal" type="button">Close</button></div></header><div class="account-modal-body"><div class="account-message-list">${messages.length ? messages.map((message) => `<article class="account-message ${message.role === "assistant" ? "assistant" : "user"}"><header><strong>${message.role === "assistant" ? "Fuzz AI" : "You"}</strong><time>${escapeHtml(formatDate(message.created_at))}</time></header>${message.has_image ? badge(`Image attached${message.image_name ? ` · ${message.image_name}` : ""}`) : ""}<pre>${escapeHtml(message.content || "")}</pre></article>`).join("") : emptyState("Empty chat", "This conversation has no saved messages.")}</div></div></section></div>`;
    const close = () => { modalRoot.innerHTML = ""; };
    modalRoot.querySelector("#close-modal")?.addEventListener("click", close);
    modalRoot.querySelector("[data-close-modal]")?.addEventListener("mousedown", (event) => { if (event.target.dataset.closeModal !== undefined) close(); });
    modalRoot.querySelector("#export-chat")?.addEventListener("click", () => {
      const transcript = [`Fuzz AI Conversation: ${chat.title || "New chat"}`, `Exported: ${new Date().toISOString()}`, "", ...messages.map((message) => `[${message.role === "assistant" ? "Fuzz AI" : "You"}] ${formatDate(message.created_at)}\n${message.content || ""}\n`)].join("\n");
      const blob = new Blob([transcript], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${String(chat.title || "fuzz-ai-chat").replace(/[^A-Za-z0-9_-]+/g, "-")}.txt`; link.click(); URL.revokeObjectURL(url);
    });
  } catch (error) { modalRoot.innerHTML = ""; toast(error.message, "error"); }
}

async function renderPrivacy() {
  loading("Loading privacy controls…");
  const params = new URLSearchParams({ page: String(state.proxy.page), limit: "40" });
  if (state.proxy.search) params.set("search", state.proxy.search);
  const [historyPayload, deletionPayload, preferencePayload] = await Promise.all([
    request(`/api/account/proxy-history?${params}`),
    request("/api/account/deletion-request"),
    request("/api/account/preferences"),
  ]);
  const history = historyPayload.history || [];
  const pagination = historyPayload.pagination || { page: 1, totalPages: 1, total: 0 };
  state.preferences = preferencePayload.preferences || state.preferences;
  const deletionRequest = deletionPayload.request;

  content.innerHTML = `
    <div class="account-section">
      ${panel("Personal data", "Download a copy of the information connected to your account", `<div class="account-callout">The export can contain your email, AI chats, proxy history, activity, usage events, device details, and IP addresses. Keep it private.</div><div style="height:12px"></div><a class="account-button primary" href="/api/account/export"><i class="fa-solid fa-download"></i>Download my data</a>`)}

      ${panel("Proxy privacy", "Control future detailed logging and clear existing history", `
        <div class="account-switch-row"><div class="account-switch-copy"><strong>Keep detailed proxy history</strong><span>When disabled, future proxy events are counted without saving the entered query, URL, or destination domain.</span></div><label class="account-switch"><input id="privacy-proxy-retention" type="checkbox" ${state.preferences?.retainProxyHistory !== false ? "checked" : ""} /><span></span></label></div>
        <div style="height:12px"></div>
        <form id="proxy-search-form" class="account-toolbar"><div class="account-toolbar-group"><input class="account-field" id="proxy-search" type="search" value="${escapeHtml(state.proxy.search)}" placeholder="Search query, URL, or domain…" style="width:280px" /><button class="account-button" type="submit">Search</button>${state.proxy.search ? `<button class="account-button" id="clear-proxy-search" type="button">Clear search</button>` : ""}</div><button class="account-button danger" id="clear-proxy-history" type="button">Clear all proxy history</button></form>
        <div style="height:12px"></div>
        ${history.length ? `<div class="account-table-wrap"><table class="account-table"><thead><tr><th>Search or URL</th><th>Domain</th><th>Status</th><th>Time</th></tr></thead><tbody>${history.map((item) => `<tr><td><div class="account-primary-copy"><strong>${escapeHtml(item.query || item.targetUrl || "Private navigation")}</strong><span>${escapeHtml(item.targetUrl || item.action || "No detailed destination retained")}</span></div></td><td>${escapeHtml(item.targetDomain || "Private")}</td><td>${badge(item.status || "unknown", item.status === "failure" ? "danger" : "success")}</td><td>${escapeHtml(formatDate(item.createdAt))}</td></tr>`).join("")}</tbody></table></div><div class="account-toolbar" style="margin-top:12px"><span class="account-help">Page ${pagination.page} of ${pagination.totalPages} · ${formatNumber(pagination.total)} records</span><div class="account-toolbar-group"><button class="account-button small" data-proxy-page="previous" ${pagination.page <= 1 ? "disabled" : ""}>Previous</button><button class="account-button small" data-proxy-page="next" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>Next</button></div></div>` : emptyState("No proxy history", "Detailed searches and destinations will appear here when history retention is enabled.", "fa-user-secret")}
      `)}

      ${panel("Account deletion", "Submitting a request does not delete the account immediately", deletionRequest ? `<div class="account-callout danger"><strong>Deletion request pending</strong><br>Submitted ${escapeHtml(formatDate(deletionRequest.requested_at))}. An owner must review it.</div><div style="height:12px"></div><button class="account-button" id="cancel-deletion-request" type="button">Cancel deletion request</button>` : `<form id="deletion-request-form" class="account-form"><label class="account-label">Reason (optional)<textarea class="account-textarea" id="deletion-reason" maxlength="1000" placeholder="Tell us why you want the account removed."></textarea></label><label class="account-label">Type DELETE MY ACCOUNT to confirm<input class="account-field" id="deletion-confirm" autocomplete="off" required /></label><p class="account-help">The request creates an owner notification. Your account remains active until it is reviewed.</p><div><button class="account-button danger" type="submit">Request account deletion</button></div></form>`)}
    </div>`;

  content.querySelector("#privacy-proxy-retention")?.addEventListener("change", async (event) => {
    const next = { ...state.preferences, retainProxyHistory: event.target.checked };
    try { const result = await request("/api/account/preferences", { method: "PUT", body: JSON.stringify(next) }); state.preferences = result.preferences; state.overview = null; toast("Proxy privacy preference saved."); } catch (error) { event.target.checked = !event.target.checked; toast(error.message, "error"); }
  });
  content.querySelector("#proxy-search-form")?.addEventListener("submit", (event) => { event.preventDefault(); state.proxy.search = content.querySelector("#proxy-search").value.trim(); state.proxy.page = 1; renderPrivacy(); });
  content.querySelector("#clear-proxy-search")?.addEventListener("click", () => { state.proxy.search = ""; state.proxy.page = 1; renderPrivacy(); });
  content.querySelector("[data-proxy-page=previous]")?.addEventListener("click", () => { state.proxy.page = Math.max(1, state.proxy.page - 1); renderPrivacy(); });
  content.querySelector("[data-proxy-page=next]")?.addEventListener("click", () => { state.proxy.page += 1; renderPrivacy(); });
  content.querySelector("#clear-proxy-history")?.addEventListener("click", async () => {
    const confirmation = prompt("Type CLEAR to permanently remove your proxy history:");
    if (confirmation !== "CLEAR") return;
    try { const result = await request("/api/account/proxy-history", { method: "DELETE", body: JSON.stringify({ confirm: confirmation }) }); toast(`Cleared ${result.deletedRows || 0} proxy records.`); state.overview = null; renderPrivacy(); } catch (error) { toast(error.message, "error"); }
  });
  content.querySelector("#deletion-request-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector("button"); button.disabled = true;
    try { await request("/api/account/deletion-request", { method: "POST", body: JSON.stringify({ reason: content.querySelector("#deletion-reason").value.trim(), confirm: content.querySelector("#deletion-confirm").value.trim() }) }); toast("Deletion request submitted."); state.overview = null; renderPrivacy(); } catch (error) { toast(error.message, "error"); button.disabled = false; }
  });
  content.querySelector("#cancel-deletion-request")?.addEventListener("click", async () => {
    if (!confirm("Cancel your pending account-deletion request?")) return;
    try { await request("/api/account/deletion-request", { method: "DELETE" }); toast("Deletion request cancelled."); state.overview = null; renderPrivacy(); } catch (error) { toast(error.message, "error"); }
  });
}

async function renderPreferences() {
  loading("Loading preferences…");
  const payload = await request("/api/account/preferences");
  state.preferences = payload.preferences || {};
  const p = state.preferences;

  content.innerHTML = `
    <div class="account-section">
      <form id="preferences-form" class="account-section">
        <div class="account-grid-2">
          ${panel("Site preferences", "How Fuzz looks and behaves on this browser", `
            <div class="account-form">
              <label class="account-label">Appearance<select class="account-select" id="pref-appearance"><option value="space" ${p.appearance === "space" ? "selected" : ""}>Space</option><option value="midnight" ${p.appearance === "midnight" ? "selected" : ""}>Midnight</option><option value="dim" ${p.appearance === "dim" ? "selected" : ""}>Dim</option></select></label>
              <label class="account-label">Default search engine<select class="account-select" id="pref-engine">${Object.entries(payload.proxyEngines || {}).map(([key, engine]) => `<option value="${escapeHtml(key)}" ${p.defaultProxyEngine === key ? "selected" : ""}>${escapeHtml(engine.name)}</option>`).join("")}</select></label>
              <label class="account-label">Fuzz AI response style<select class="account-select" id="pref-ai"><option value="balanced" ${p.aiBehavior === "balanced" ? "selected" : ""}>Balanced</option><option value="concise" ${p.aiBehavior === "concise" ? "selected" : ""}>Concise</option><option value="detailed" ${p.aiBehavior === "detailed" ? "selected" : ""}>Detailed</option><option value="creative" ${p.aiBehavior === "creative" ? "selected" : ""}>Creative</option></select></label>
            </div>
          `)}

          ${panel("Notifications and accessibility", "Choose which optional interface features are enabled", `
            <div class="account-switch-row"><div class="account-switch-copy"><strong>Show site announcements</strong><span>Display active banners published by the owner.</span></div><label class="account-switch"><input id="pref-announcements" type="checkbox" ${p.announcementsEnabled !== false ? "checked" : ""} /><span></span></label></div>
            <div class="account-switch-row"><div class="account-switch-copy"><strong>Reduced motion</strong><span>Minimize interface animation and transitions.</span></div><label class="account-switch"><input id="pref-motion" type="checkbox" ${p.reducedMotion === true ? "checked" : ""} /><span></span></label></div>
            <div class="account-switch-row"><div class="account-switch-copy"><strong>Keep detailed proxy history</strong><span>Save future entered searches, URLs, and destination domains.</span></div><label class="account-switch"><input id="pref-proxy-history" type="checkbox" ${p.retainProxyHistory !== false ? "checked" : ""} /><span></span></label></div>
          `)}
        </div>
        <div class="account-toolbar"><span class="account-help">Saved preferences are applied across your signed-in Fuzz pages.</span><button class="account-button primary" type="submit"><i class="fa-solid fa-floppy-disk"></i>Save preferences</button></div>
      </form>
    </div>`;

  content.querySelector("#preferences-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector("button[type=submit]"); button.disabled = true;
    const values = { announcementsEnabled: content.querySelector("#pref-announcements").checked, retainProxyHistory: content.querySelector("#pref-proxy-history").checked, defaultProxyEngine: content.querySelector("#pref-engine").value, aiBehavior: content.querySelector("#pref-ai").value, reducedMotion: content.querySelector("#pref-motion").checked, appearance: content.querySelector("#pref-appearance").value };
    try { const result = await request("/api/account/preferences", { method: "PUT", body: JSON.stringify(values) }); state.preferences = result.preferences; state.overview = null; toast("Preferences saved. Reloading to apply them…"); window.setTimeout(() => window.location.reload(), 650); } catch (error) { toast(error.message, "error"); button.disabled = false; }
  });
}

async function renderRoute() {
  try {
    if (state.route === "security") return await renderSecurity();
    if (state.route === "ai") return await renderAi();
    if (state.route === "privacy") return await renderPrivacy();
    if (state.route === "preferences") return await renderPreferences();
    return await renderOverview();
  } catch (error) { errorState(error.message); }
}

document.querySelectorAll("[data-account-route]").forEach((button) => button.addEventListener("click", () => setRoute(button.dataset.accountRoute)));
window.addEventListener("popstate", () => setRoute(window.location.hash.slice(1), false));
request("/api/account/me")
  .then((account) => {
    statusChip.textContent = `${account.role || "user"} · Active`;
  })
  .catch(() => {
    statusChip.textContent = "Account";
  });
setRoute(window.location.hash.slice(1), false);
