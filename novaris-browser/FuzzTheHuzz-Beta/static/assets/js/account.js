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
            ${usageRow("Novaris AI messages", totals.aiMessagesToday, policy.aiMessagesDaily)}
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
  loading("Loading saved Novaris AI chats…");
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
        ${metric("Saved chats", formatNumber(pagination.total), "Your Novaris AI conversations")}
        ${metric("Messages today", formatNumber(totals.aiMessagesToday), policy.aiMessagesDaily ? `of ${formatNumber(policy.aiMessagesDaily)}` : "Unlimited")}
        ${metric("Images today", formatNumber(totals.aiImagesToday), policy.aiImagesDaily ? `of ${formatNumber(policy.aiImagesDaily)}` : "Unlimited")}
        ${metric("Response style", state.preferences?.aiBehavior || "balanced", "Change under Preferences")}
      </section>

      ${panel("Saved conversations", "Open, rename, export, or delete your chats", `
        <form id="ai-search-form" class="account-toolbar" style="margin-bottom:12px">
          <div class="account-toolbar-group"><input class="account-field" id="ai-search" type="search" value="${escapeHtml(state.ai.search)}" placeholder="Search chat titles…" style="width:260px" /><button class="account-button" type="submit">Search</button>${state.ai.search ? `<button class="account-button" id="clear-ai-search" type="button">Clear</button>` : ""}</div>
          <button class="account-button danger" id="delete-all-ai" type="button">Delete all AI history</button>
        </form>
        ${chats.length ? `<div class="account-table-wrap"><table class="account-table"><thead><tr><th>Chat</th><th>Messages</th><th>Updated</th><th></th></tr></thead><tbody>${chats.map((chat) => `<tr><td><div class="account-primary-copy"><strong>${escapeHtml(chat.title || "New chat")}</strong><span>${escapeHtml(chat.lastMessagePreview || "No saved messages")}</span></div></td><td>${badge(`${chat.messageCount || 0} messages`)}</td><td>${escapeHtml(formatDate(chat.updatedAt))}</td><td><div class="account-toolbar-group"><button class="account-button small" data-open-chat="${escapeHtml(chat.id)}" type="button">Open</button><button class="account-button small" data-rename-chat="${escapeHtml(chat.id)}" data-chat-title="${escapeHtml(chat.title || "New chat")}" type="button">Rename</button><button class="account-button small danger" data-delete-chat="${escapeHtml(chat.id)}" type="button">Delete</button></div></td></tr>`).join("")}</tbody></table></div><div class="account-toolbar" style="margin-top:12px"><span class="account-help">Page ${pagination.page} of ${pagination.totalPages}</span><div class="account-toolbar-group"><button class="account-button small" data-ai-page="previous" ${pagination.page <= 1 ? "disabled" : ""}>Previous</button><button class="account-button small" data-ai-page="next" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>Next</button></div></div>` : emptyState("No saved chats", "Start a conversation in Novaris AI and it will appear here.", "fa-robot")}
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
    modalRoot.innerHTML = `<div class="account-modal-backdrop" data-close-modal><section class="account-modal"><header class="account-modal-header"><div><h2>${escapeHtml(chat.title || "New chat")}</h2><p>${messages.length} messages · Updated ${escapeHtml(formatDate(chat.updated_at))}</p></div><div class="account-toolbar-group"><button class="account-button small" id="export-chat" type="button">Export</button><button class="account-button small" id="close-modal" type="button">Close</button></div></header><div class="account-modal-body"><div class="account-message-list">${messages.length ? messages.map((message) => `<article class="account-message ${message.role === "assistant" ? "assistant" : "user"}"><header><strong>${message.role === "assistant" ? "Novaris AI" : "You"}</strong><time>${escapeHtml(formatDate(message.created_at))}</time></header>${message.has_image ? badge(`Image attached${message.image_name ? ` · ${message.image_name}` : ""}`) : ""}<pre>${escapeHtml(message.content || "")}</pre></article>`).join("") : emptyState("Empty chat", "This conversation has no saved messages.")}</div></div></section></div>`;
    const close = () => { modalRoot.innerHTML = ""; };
    modalRoot.querySelector("#close-modal")?.addEventListener("click", close);
    modalRoot.querySelector("[data-close-modal]")?.addEventListener("mousedown", (event) => { if (event.target.dataset.closeModal !== undefined) close(); });
    modalRoot.querySelector("#export-chat")?.addEventListener("click", () => {
      const transcript = [`Novaris AI Conversation: ${chat.title || "New chat"}`, `Exported: ${new Date().toISOString()}`, "", ...messages.map((message) => `[${message.role === "assistant" ? "Novaris AI" : "You"}] ${formatDate(message.created_at)}\n${message.content || ""}\n`)].join("\n");
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

const SETTINGS_CLOAK_PRESETS = Object.freeze({
  Classroom: {
    label: "Google Classroom",
    title: "Home",
    icon: "/assets/media/favicon/classroom.png",
  },
  Google: {
    label: "Google",
    title: "Google",
    icon: "/assets/media/favicon/google.png",
  },
  Drive: {
    label: "Google Drive",
    title: "My Drive - Google Drive",
    icon: "/assets/media/favicon/drive.png",
  },
  Gmail: {
    label: "Gmail",
    title: "Gmail",
    icon: "/assets/media/favicon/gmail.png",
  },
  Canvas: {
    label: "Canvas",
    title: "Dashboard",
    icon: "/assets/media/favicon/canvas.png",
  },
  IXL: {
    label: "IXL",
    title: "IXL | Dashboard",
    icon: "/assets/media/favicon/ixl.png",
  },
  Fuzz: {
    label: "Novaris",
    title: "Novaris",
    icon: "/favicon.png",
  },
});

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function readBrowserSettings() {
  const storedKeys = readJsonStorage("eventKey", null);
  const panicKeys =
    localStorage.getItem("eventKeyRaw") ||
    (Array.isArray(storedKeys) ? storedKeys.join(",") : "Ctrl,E");

  return {
    aboutBlank: localStorage.getItem("ab") !== "false",
    panicKeys,
    panicLink:
      localStorage.getItem("pLink") ||
      "https://classroom.google.com/",
    cloakPreset:
      localStorage.getItem("selectedOption") ||
      "Classroom",
    backgroundImage:
      localStorage.getItem("backgroundImage") || "",
    proxyMode:
      ["scramjet", "ultraviolet"].includes(
        localStorage.getItem("fuzz_proxy_engine"),
      )
        ? localStorage.getItem("fuzz_proxy_engine")
        : "scramjet",
    particles:
      localStorage.getItem("Particles") === "true" ||
      localStorage.getItem("particles") === "true",
    ui:
      window.FuzzUI?.getSettings?.() || {
        accent: "violet",
        density: "comfortable",
        motion: "system",
        background: "stars",
        showNewTabShortcuts: true,
        showUpdateNotices: true,
      },
  };
}

function normalizePanicKeys(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function setCloakPreset(value) {
  const preset =
    SETTINGS_CLOAK_PRESETS[value] ||
    SETTINGS_CLOAK_PRESETS.Classroom;

  localStorage.setItem("selectedOption", value);
  localStorage.setItem("name", preset.title);
  localStorage.setItem("icon", preset.icon);
  localStorage.removeItem("CustomName");
  localStorage.removeItem("CustomIcon");

  document.title = preset.title;
  const favicon =
    document.querySelector('link[rel~="icon"]') ||
    document.querySelector('link[rel="shortcut icon"]');
  favicon?.setAttribute("href", preset.icon);
}

function saveBrowserSettings(values) {
  const keys = normalizePanicKeys(values.panicKeys);
  if (keys.length === 0) {
    throw new Error("Enter at least one panic key.");
  }

  let panicUrl;
  try {
    panicUrl = new URL(values.panicLink);
  } catch {
    throw new Error("Enter a valid panic-link URL, including https://.");
  }

  if (!["http:", "https:"].includes(panicUrl.protocol)) {
    throw new Error("The panic link must use http:// or https://.");
  }

  localStorage.setItem("ab", String(values.aboutBlank === true));
  localStorage.setItem("eventKey", JSON.stringify(keys));
  localStorage.setItem("eventKeyRaw", keys.join(","));
  localStorage.setItem("pLink", panicUrl.toString());
  localStorage.setItem("backgroundImage", values.backgroundImage || "");

  const proxyMode =
    values.proxyMode === "ultraviolet"
      ? "ultraviolet"
      : "scramjet";
  localStorage.setItem("fuzz_proxy_engine", proxyMode);
  localStorage.setItem("uv", String(proxyMode === "ultraviolet"));
  localStorage.setItem("dy", "false");

  localStorage.setItem("Particles", String(values.particles === true));
  localStorage.setItem("particles", String(values.particles === true));

  setCloakPreset(values.cloakPreset);

  if (values.backgroundImage) {
    document.body.style.backgroundImage = `url('${values.backgroundImage.replaceAll("'", "%27")}')`;
  } else {
    document.body.style.removeProperty("background-image");
  }
}

function openAboutBlankWindow() {
  const popup = window.open("about:blank", "_blank");
  if (!popup || popup.closed) {
    throw new Error("The popup was blocked. Allow popups for this site and try again.");
  }

  const doc = popup.document;
  const iframe = doc.createElement("iframe");
  const favicon = doc.createElement("link");

  doc.title = localStorage.getItem("name") || "My Drive - Google Drive";
  favicon.rel = "icon";
  favicon.href =
    localStorage.getItem("icon") ||
    "https://ssl.gstatic.com/docs/doclist/images/drive_2022q3_32dp.png";

  iframe.src = window.location.origin;
  Object.assign(iframe.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    border: "0",
    outline: "0",
  });

  doc.head.appendChild(favicon);
  doc.body.style.margin = "0";
  doc.body.appendChild(iframe);
}

function exportBrowserSettings() {
  const allowedKeys = [
    "ab",
    "eventKey",
    "eventKeyRaw",
    "pLink",
    "selectedOption",
    "name",
    "icon",
    "CustomName",
    "CustomIcon",
    "backgroundImage",
    "uv",
    "dy",
    "fuzz_proxy_engine",
    "Particles",
    "particles",
    "engine",
    "enginename",
    "theme",
    "fuzz_ui_settings_v1",
    "fuzz_onboarding_complete_v1",
    "fuzz_seen_release",
  ];

  const browserSettings = {};
  for (const key of allowedKeys) {
    const value = localStorage.getItem(key);
    if (value !== null) browserSettings[key] = value;
  }

  const payload = {
    product: "Novaris",
    type: "browser-settings",
    exportedAt: new Date().toISOString(),
    browserSettings,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `fuzz-browser-settings-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importBrowserSettings(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That settings file could not be read."));
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result || "{}"));
        const values = payload.browserSettings;
        if (!values || typeof values !== "object" || Array.isArray(values)) {
          throw new Error("That is not a valid Novaris browser-settings export.");
        }

        const allowedKeys = new Set([
          "ab",
          "eventKey",
          "eventKeyRaw",
          "pLink",
          "selectedOption",
          "name",
          "icon",
          "CustomName",
          "CustomIcon",
          "backgroundImage",
          "uv",
          "dy",
          "fuzz_proxy_engine",
          "Particles",
          "particles",
          "engine",
          "enginename",
          "theme",
          "fuzz_ui_settings_v1",
          "fuzz_onboarding_complete_v1",
          "fuzz_seen_release",
        ]);

        for (const [key, value] of Object.entries(values)) {
          if (allowedKeys.has(key) && typeof value === "string") {
            localStorage.setItem(key, value);
          }
        }

        resolve();
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsText(file);
  });
}


function customizationSettingsMarkup() {
  return `
    <section class="account-section account-customization-settings" data-fuzz-customization>
      <div class="account-settings-heading">
        <div>
          <span class="account-settings-kicker">Synced customization</span>
          <h2>Personalization</h2>
          <p>Wallpaper, sidebar, colors, spacing, and Home-page layout now live inside Settings.</p>
        </div>
        <div class="account-customization-actions">
          <button id="reset-settings" class="account-button" type="button"><i class="fa-solid fa-arrow-rotate-left"></i>Reset customization</button>
          <button id="save-settings" class="account-button primary" type="button"><i class="fa-solid fa-check"></i>Save customization</button>
        </div>
      </div>

      <div id="settings-message" class="settings-message" hidden></div>

      <div class="settings-layout">
        <div class="settings-column">
          <article class="settings-card wallpaper-card">
            <header><div><i class="fa-regular fa-image"></i><span><strong>Wallpaper</strong><small>Upload a PNG, JPEG, or WebP, or paste an image URL.</small></span></div></header>
            <div id="wallpaper-preview" class="wallpaper-preview"><span><i class="fa-regular fa-image"></i>No wallpaper selected</span></div>
            <div class="wallpaper-actions">
              <input id="wallpaper-file" type="file" accept="image/png,image/jpeg,image/webp" hidden />
              <button id="choose-wallpaper" type="button"><i class="fa-solid fa-upload"></i> Upload image</button>
              <button id="remove-wallpaper" type="button" class="danger"><i class="fa-regular fa-trash-can"></i> Remove</button>
            </div>
            <label class="settings-field full">
              <span>External image URL</span>
              <input id="wallpaper-url" type="url" placeholder="https://example.com/wallpaper.png" />
            </label>
            <div class="settings-grid three">
              <label class="settings-field"><span>Fit</span><select id="wallpaper-fit"><option value="cover">Cover</option><option value="contain">Contain</option><option value="auto">Original size</option><option value="100% 100%">Stretch</option></select></label>
              <label class="settings-field"><span>Position</span><select id="wallpaper-position"><option value="center">Center</option><option value="top">Top</option><option value="bottom">Bottom</option><option value="left">Left</option><option value="right">Right</option></select></label>
              <label class="settings-field"><span>Blur <output id="wallpaper-blur-output">0px</output></span><input id="wallpaper-blur" type="range" min="0" max="18" step="1" value="0" /></label>
            </div>
            <label class="settings-field full"><span>Dark overlay <output id="wallpaper-overlay-output">42%</output></span><input id="wallpaper-overlay" type="range" min="0" max="85" step="1" value="42" /></label>
          </article>

          <article class="settings-card">
            <header><div><i class="fa-solid fa-palette"></i><span><strong>Colors and surfaces</strong><small>Control the accent and glass appearance.</small></span></div></header>
            <div class="settings-grid two">
              <label class="settings-field color-field"><span>Accent color</span><input id="accent-color" type="color" value="#7c7cff" /></label>
              <label class="settings-field"><span>Glass opacity <output id="surface-opacity-output">78%</output></span><input id="surface-opacity" type="range" min="35" max="96" step="1" value="78" /></label>
              <label class="settings-field"><span>Corner radius <output id="border-radius-output">18px</output></span><input id="border-radius" type="range" min="8" max="30" step="1" value="18" /></label>
              <label class="settings-field"><span>Font size <output id="font-scale-output">100%</output></span><input id="font-scale" type="range" min="85" max="125" step="5" value="100" /></label>
            </div>
          </article>
        </div>

        <div class="settings-column">
          <article class="settings-card">
            <header><div><i class="fa-solid fa-bars-staggered"></i><span><strong>Sidebar and layout</strong><small>Choose how the main Novaris menu behaves.</small></span></div></header>
            <div class="settings-choice-grid">
              <label class="choice-card"><input type="radio" name="sidebar-mode" value="expanded" checked /><span><i class="fa-solid fa-rectangle-list"></i><strong>Expanded</strong><small>Icons and names</small></span></label>
              <label class="choice-card"><input type="radio" name="sidebar-mode" value="collapsed" /><span><i class="fa-solid fa-grip-lines-vertical"></i><strong>Compact</strong><small>Icons only</small></span></label>
            </div>
            <div class="settings-grid two">
              <label class="settings-field"><span>Page spacing</span><select id="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
              <label class="settings-field"><span>Default page</span><select id="default-page"><option value="/">Home</option><option value="/chat">Chat</option><option value="/ai">Novaris AI</option><option value="/b">Apps</option><option value="/d">Tabs</option></select></label>
            </div>
            <label class="settings-toggle"><span><strong>Reduce motion</strong><small>Minimize animations and transitions.</small></span><input id="reduced-motion" type="checkbox" /><span class="toggle-track"></span></label>
            <label class="settings-toggle"><span><strong>Show device status</strong><small>Display local time, date, connection, device type, and battery when supported.</small></span><input id="show-device-status" type="checkbox" checked /><span class="toggle-track"></span></label>
          </article>

          <article class="settings-card">
            <header><div><i class="fa-solid fa-house-chimney-window"></i><span><strong>Home page</strong><small>Choose what appears on your dashboard.</small></span></div></header>
            <label class="settings-toggle"><span><strong>Show quick links</strong><small>AI, Apps, Tabs, and Settings cards.</small></span><input id="show-quick-links" type="checkbox" checked /><span class="toggle-track"></span></label>
            <label class="settings-toggle"><span><strong>Show bookmarks</strong><small>Your synced and local bookmarks.</small></span><input id="show-bookmarks" type="checkbox" checked /><span class="toggle-track"></span></label>
            <label class="settings-toggle"><span><strong>Show recent sites</strong><small>Recently opened proxy pages.</small></span><input id="show-recents" type="checkbox" checked /><span class="toggle-track"></span></label>
          </article>

          <article class="settings-card">
            <header><div><i class="fa-solid fa-user-shield"></i><span><strong>Blocked users</strong><small>Manage people you blocked from direct messages.</small></span></div></header>
            <div id="blocked-users-list" class="blocked-users-list"><div class="blocked-users-empty"><span></span>Loading blocked users…</div></div>
          </article>

          <article class="settings-card settings-info-card">
            <i class="fa-solid fa-cloud-arrow-up"></i>
            <div><strong>Synced to your Novaris account</strong><p>These customization choices follow your account to another signed-in device. Your original account and browser settings remain above.</p></div>
          </article>
        </div>
      </div>
      <div id="settings-toast" class="settings-toast" hidden></div>
    </section>`;
}

async function renderPreferences() {
  loading("Loading settings…");
  const payload = await request("/api/account/preferences");
  state.preferences = payload.preferences || {};
  const p = state.preferences;
  const browser = readBrowserSettings();

  content.innerHTML = `
    <div class="account-section">
      <div class="account-callout">
        <strong>Settings are now part of My Account.</strong><br>
        Account preferences sync to your signed-in account. Browser settings apply only to this browser and device.
      </div>

      <form id="preferences-form" class="account-section">
        <div class="account-settings-heading">
          <div>
            <span class="account-settings-kicker">Synced settings</span>
            <h2>Account preferences</h2>
            <p>These preferences follow your account across signed-in devices.</p>
          </div>
          <span class="account-badge success">Account synced</span>
        </div>

        <div class="account-grid-2">
          ${panel("Site preferences", "How Novaris looks and behaves", `
            <div class="account-form">
              <label class="account-label">Appearance<select class="account-select" id="pref-appearance"><option value="space" ${p.appearance === "space" ? "selected" : ""}>Space</option><option value="midnight" ${p.appearance === "midnight" ? "selected" : ""}>Midnight</option><option value="dim" ${p.appearance === "dim" ? "selected" : ""}>Dim</option></select></label>
              <label class="account-label">Default search engine<select class="account-select" id="pref-engine">${Object.entries(payload.proxyEngines || {}).map(([key, engine]) => `<option value="${escapeHtml(key)}" ${p.defaultProxyEngine === key ? "selected" : ""}>${escapeHtml(engine.name)}</option>`).join("")}</select></label>
              <label class="account-label">Default proxy<select class="account-select" id="pref-proxy-technology"><option value="scramjet" ${p.proxyTechnology !== "ultraviolet" ? "selected" : ""}>Scramjet · Recommended</option><option value="ultraviolet" ${p.proxyTechnology === "ultraviolet" ? "selected" : ""}>Ultraviolet · Legacy fallback</option></select></label>
              <label class="account-label">Novaris AI response style<select class="account-select" id="pref-ai"><option value="balanced" ${p.aiBehavior === "balanced" ? "selected" : ""}>Balanced</option><option value="concise" ${p.aiBehavior === "concise" ? "selected" : ""}>Concise</option><option value="detailed" ${p.aiBehavior === "detailed" ? "selected" : ""}>Detailed</option><option value="creative" ${p.aiBehavior === "creative" ? "selected" : ""}>Creative</option></select></label>
            </div>
          `)}

          ${panel("Notifications and accessibility", "Optional interface and privacy features", `
            <div class="account-switch-row"><div class="account-switch-copy"><strong>Show site announcements</strong><span>Display active banners published by the owner.</span></div><label class="account-switch"><input id="pref-announcements" type="checkbox" ${p.announcementsEnabled !== false ? "checked" : ""} /><span></span></label></div>
            <div class="account-switch-row"><div class="account-switch-copy"><strong>Reduced motion</strong><span>Minimize interface animation and transitions.</span></div><label class="account-switch"><input id="pref-motion" type="checkbox" ${p.reducedMotion === true ? "checked" : ""} /><span></span></label></div>
            <div class="account-switch-row"><div class="account-switch-copy"><strong>Keep detailed proxy history</strong><span>Save future entered searches, URLs, and destination domains.</span></div><label class="account-switch"><input id="pref-proxy-history" type="checkbox" ${p.retainProxyHistory !== false ? "checked" : ""} /><span></span></label></div>
          `)}
        </div>

        <div class="account-toolbar account-settings-save-row"><span class="account-help">Saved account preferences are applied across your signed-in Novaris pages.</span><button class="account-button primary" type="submit"><i class="fa-solid fa-cloud-arrow-up"></i>Save account preferences</button></div>
      </form>

      <form id="browser-settings-form" class="account-section">
        <div class="account-settings-heading">
          <div>
            <span class="account-settings-kicker">This device</span>
            <h2>Browser settings</h2>
            <p>These options stay in this browser's local storage.</p>
          </div>
          <span class="account-badge">Browser only</span>
        </div>

        <div class="account-grid-2">
          ${panel("Privacy window", "About:blank and panic-key behavior", `
            <div class="account-switch-row"><div class="account-switch-copy"><strong>Open in about:blank automatically</strong><span>Use the site's existing about:blank startup behavior on supported browsers.</span></div><label class="account-switch"><input id="browser-about-blank" type="checkbox" ${browser.aboutBlank ? "checked" : ""} /><span></span></label></div>
            <div class="account-form" style="margin-top:13px">
              <label class="account-label">Panic keys<input class="account-field" id="browser-panic-keys" value="${escapeHtml(browser.panicKeys)}" placeholder="Ctrl,E or A,B,C" /></label>
              <label class="account-label">Panic link<input class="account-field" id="browser-panic-link" type="url" value="${escapeHtml(browser.panicLink)}" placeholder="https://classroom.google.com/" /></label>
              <button class="account-button" id="open-about-blank" type="button"><i class="fa-regular fa-window-restore"></i>Open about:blank window</button>
            </div>
          `)}

          ${panel("Tab and appearance", "Local tab cloak and background controls", `
            <div class="account-form">
              <label class="account-label">Tab cloak<select class="account-select" id="browser-cloak">${Object.entries(SETTINGS_CLOAK_PRESETS).map(([key, preset]) => `<option value="${escapeHtml(key)}" ${browser.cloakPreset === key ? "selected" : ""}>${escapeHtml(preset.label)}</option>`).join("")}</select></label>
              <label class="account-label">Background image URL<input class="account-field" id="browser-background" type="url" value="${escapeHtml(browser.backgroundImage)}" placeholder="https://example.com/background.jpg" /></label>
              <button class="account-button" id="reset-browser-background" type="button"><i class="fa-solid fa-rotate-left"></i>Reset background</button>
            </div>
          `)}

          ${panel("Workspace appearance", "Accent, spacing, motion, and New Tab controls", `
            <div class="account-form">
              <label class="account-label">Accent color<select class="account-select" id="browser-accent"><option value="violet" ${browser.ui.accent === "violet" ? "selected" : ""}>Violet</option><option value="cyan" ${browser.ui.accent === "cyan" ? "selected" : ""}>Cyan</option><option value="green" ${browser.ui.accent === "green" ? "selected" : ""}>Green</option><option value="rose" ${browser.ui.accent === "rose" ? "selected" : ""}>Rose</option><option value="amber" ${browser.ui.accent === "amber" ? "selected" : ""}>Amber</option></select></label>
              <label class="account-label">Interface density<select class="account-select" id="browser-density"><option value="comfortable" ${browser.ui.density === "comfortable" ? "selected" : ""}>Comfortable</option><option value="compact" ${browser.ui.density === "compact" ? "selected" : ""}>Compact</option></select></label>
              <label class="account-label">Animated background<select class="account-select" id="browser-ui-background"><option value="stars" ${browser.ui.background === "stars" ? "selected" : ""}>Stars and effects</option><option value="quiet" ${browser.ui.background === "quiet" ? "selected" : ""}>Quiet background</option></select></label>
              <div class="account-switch-row"><div class="account-switch-copy"><strong>Reduce interface motion locally</strong><span>Overrides animations on this browser without changing your synced account setting.</span></div><label class="account-switch"><input id="browser-ui-motion" type="checkbox" ${browser.ui.motion === "reduced" ? "checked" : ""} /><span></span></label></div>
              <div class="account-switch-row"><div class="account-switch-copy"><strong>Show New Tab shortcuts</strong><span>Display Home, Apps, Novaris AI, and Settings shortcuts under the proxy selector.</span></div><label class="account-switch"><input id="browser-new-tab-shortcuts" type="checkbox" ${browser.ui.showNewTabShortcuts !== false ? "checked" : ""} /><span></span></label></div>
              <div class="account-switch-row"><div class="account-switch-copy"><strong>Show update notices</strong><span>Display a small banner when a new Novaris version is installed.</span></div><label class="account-switch"><input id="browser-update-notices" type="checkbox" ${browser.ui.showUpdateNotices !== false ? "checked" : ""} /><span></span></label></div>
              <div class="account-toolbar-group"><button class="account-button" id="reset-interface-defaults" type="button"><i class="fa-solid fa-rotate-left"></i>Reset interface defaults</button><button class="account-button" type="button" data-fuzz-open-changelog><i class="fa-solid fa-sparkles"></i>View changelog</button><a class="account-button" href="/status"><i class="fa-solid fa-heart-pulse"></i>System status</a></div>
            </div>
          `)}

          ${panel("Effects", "Local visual effects for this browser", `
            <div class="account-form">
              <div class="account-switch-row"><div class="account-switch-copy"><strong>Particles</strong><span>Show the legacy particle effect on supported pages.</span></div><label class="account-switch"><input id="browser-particles" type="checkbox" ${browser.particles ? "checked" : ""} /><span></span></label></div>
            </div>
          `)}

          ${panel("Browser data", "Move local settings between browsers", `
            <div class="account-callout">This export contains browser preferences only. It does not include your password, login token, AI chats, or account data.</div>
            <div class="account-toolbar-group" style="margin-top:13px">
              <button class="account-button" id="export-browser-settings" type="button"><i class="fa-solid fa-download"></i>Export browser settings</button>
              <button class="account-button" id="import-browser-settings" type="button"><i class="fa-solid fa-upload"></i>Import browser settings</button>
              <input id="browser-settings-file" type="file" accept="application/json,.json" hidden />
            </div>
          `)}
        </div>

        <div class="account-toolbar account-settings-save-row"><span class="account-help">Some browser changes require a page reload before every part of the site updates.</span><button class="account-button primary" type="submit"><i class="fa-solid fa-floppy-disk"></i>Save browser settings</button></div>
      </form>
    </div>`;

  content.insertAdjacentHTML("beforeend", customizationSettingsMarkup());
  const customizationRoot = content.querySelector("[data-fuzz-customization]");
  if (window.FuzzCustomization?.init) {
    window.FuzzCustomization.init(customizationRoot);
  } else {
    window.addEventListener(
      "fuzz:customization-ready",
      () => window.FuzzCustomization?.init(customizationRoot),
      { once: true },
    );
  }

  content.querySelector("#preferences-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    const values = {
      announcementsEnabled: content.querySelector("#pref-announcements").checked,
      retainProxyHistory: content.querySelector("#pref-proxy-history").checked,
      defaultProxyEngine: content.querySelector("#pref-engine").value,
      proxyTechnology: content.querySelector("#pref-proxy-technology").value,
      aiBehavior: content.querySelector("#pref-ai").value,
      reducedMotion: content.querySelector("#pref-motion").checked,
      appearance: content.querySelector("#pref-appearance").value,
    };

    try {
      const result = await request("/api/account/preferences", {
        method: "PUT",
        body: JSON.stringify(values),
      });
      state.preferences = result.preferences;
      state.overview = null;
      toast("Account preferences saved. Reloading to apply them…");
      window.setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
    }
  });

  content.querySelector("#browser-settings-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      saveBrowserSettings({
        aboutBlank: content.querySelector("#browser-about-blank").checked,
        panicKeys: content.querySelector("#browser-panic-keys").value,
        panicLink: content.querySelector("#browser-panic-link").value,
        cloakPreset: content.querySelector("#browser-cloak").value,
        backgroundImage: content.querySelector("#browser-background").value.trim(),
        proxyMode: state.preferences?.proxyTechnology || browser.proxyMode,
        particles: content.querySelector("#browser-particles").checked,
      });
      window.FuzzUI?.saveSettings?.({
        accent: content.querySelector("#browser-accent").value,
        density: content.querySelector("#browser-density").value,
        background: content.querySelector("#browser-ui-background").value,
        motion: content.querySelector("#browser-ui-motion").checked ? "reduced" : "system",
        showNewTabShortcuts: content.querySelector("#browser-new-tab-shortcuts").checked,
        showUpdateNotices: content.querySelector("#browser-update-notices").checked,
      });
      toast("Browser settings saved. Reloading to apply them…");
      window.setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      toast(error.message, "error");
    }
  });

  content.querySelector("#open-about-blank")?.addEventListener("click", () => {
    try {
      openAboutBlankWindow();
      toast("Opened a new about:blank window.");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  content.querySelector("#reset-interface-defaults")?.addEventListener("click", () => {
    window.FuzzUI?.resetSettings?.();
    toast("Interface defaults restored. Reloading…");
    window.setTimeout(() => window.location.reload(), 450);
  });

  content.querySelector("#reset-browser-background")?.addEventListener("click", () => {
    const field = content.querySelector("#browser-background");
    field.value = "";
    localStorage.removeItem("backgroundImage");
    document.body.style.removeProperty("background-image");
    toast("Background reset. Save browser settings to keep the change.");
  });

  content.querySelector("#export-browser-settings")?.addEventListener("click", () => {
    exportBrowserSettings();
    toast("Browser settings exported.");
  });

  content.querySelector("#import-browser-settings")?.addEventListener("click", () => {
    content.querySelector("#browser-settings-file")?.click();
  });

  content.querySelector("#browser-settings-file")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await importBrowserSettings(file);
      toast("Browser settings imported. Reloading…");
      window.setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      event.target.value = "";
    }
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
window.addEventListener("hashchange", () => setRoute(window.location.hash.slice(1), false));
request("/api/account/me")
  .then((account) => {
    statusChip.textContent = `${account.role || "user"} · Active`;
  })
  .catch(() => {
    statusChip.textContent = "Account";
  });
setRoute(window.location.hash.slice(1), false);
