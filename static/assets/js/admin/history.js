import { api } from "./api.js";
import { badge, emptyState, errorState, loadingState, panel } from "./components.js";
import { escapeHtml, formatDate, formatNumber, initials, statusClass } from "./utils.js";

let activeTab = "ai";
const aiState = { page: 1, limit: 30, search: "" };
const proxyState = { page: 1, limit: 50, search: "", status: "" };

export async function renderHistory(container) {
  container.innerHTML = loadingState("Loading owner history...");

  try {
    if (activeTab === "proxy") {
      const payload = await api.proxyHistory(proxyState);
      paintProxy(container, payload);
    } else {
      const payload = await api.aiHistory(aiState);
      paintAi(container, payload);
    }
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container.querySelector("[data-action='retry']")?.addEventListener("click", () => renderHistory(container));
  }
}

function tabs() {
  return `
    <div class="section-tabs">
      <button class="section-tab ${activeTab === "ai" ? "is-active" : ""}" data-history-tab="ai" type="button">AI Chats</button>
      <button class="section-tab ${activeTab === "proxy" ? "is-active" : ""}" data-history-tab="proxy" type="button">Proxy Searches</button>
    </div>
  `;
}

function bindTabs(container) {
  container.querySelectorAll("[data-history-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.historyTab;
      renderHistory(container);
    });
  });
}

function paintAi(container, payload) {
  const chats = payload.chats || [];
  const pagination = payload.pagination || { page: 1, totalPages: 1, total: chats.length };

  container.innerHTML = `
    <div class="page-section">
      <div class="toolbar">
        ${tabs()}
        ${badge("Owner only", "badge-info")}
      </div>

      <form class="toolbar" id="history-ai-form">
        <div class="toolbar-group">
          <input class="field search-field" id="history-ai-search" type="search" value="${escapeHtml(aiState.search)}" placeholder="Search username or chat title..." />
          <button class="button button-secondary" type="submit">Search</button>
          ${aiState.search ? '<button class="button button-ghost" id="history-ai-clear" type="button">Clear</button>' : ""}
        </div>
        ${badge(`${formatNumber(pagination.total)} chats`, "badge-info")}
      </form>

      ${panel({
        title: "Saved AI conversations",
        subtitle: "Open a chat to view every saved user and assistant message",
        flush: true,
        body: chats.length ? `
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>User</th><th>Chat</th><th>Messages</th><th>Latest message</th><th>Updated</th><th style="text-align:right">Action</th></tr></thead>
              <tbody>${chats.map(aiRow).join("")}</tbody>
            </table>
          </div>
          ${pager("ai", pagination)}
        ` : emptyState("No chats found", "Try another username or chat title."),
      })}
      <div id="history-modal-root"></div>
    </div>
  `;

  bindTabs(container);
  container.querySelector("#history-ai-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    aiState.page = 1;
    aiState.search = container.querySelector("#history-ai-search").value.trim();
    renderHistory(container);
  });
  container.querySelector("#history-ai-clear")?.addEventListener("click", () => {
    aiState.page = 1; aiState.search = ""; renderHistory(container);
  });
  bindPager(container, "ai", aiState);
  container.querySelectorAll("[data-open-chat]").forEach((button) => button.addEventListener("click", () => openChat(container, button.dataset.openChat)));
}

function aiRow(chat) {
  return `
    <tr>
      <td><div class="table-primary"><span class="table-avatar">${escapeHtml(initials(chat.username))}</span><span class="table-primary-copy"><strong>${escapeHtml(chat.username || "Unknown")}</strong><span>${escapeHtml(chat.userId || "")}</span></span></div></td>
      <td><span class="table-primary-copy"><strong>${escapeHtml(chat.title || "New chat")}</strong><span>${escapeHtml(formatDate(chat.createdAt))}</span></span></td>
      <td>${badge(`${chat.messageCount || 0} messages`, "badge-info")}</td>
      <td><span class="history-preview">${escapeHtml(chat.lastMessagePreview || "No messages")}</span></td>
      <td>${escapeHtml(formatDate(chat.updatedAt))}</td>
      <td style="text-align:right"><button class="button button-small button-secondary" data-open-chat="${escapeHtml(chat.id)}" type="button">Open</button></td>
    </tr>`;
}

async function openChat(container, chatId) {
  const root = container.querySelector("#history-modal-root");
  root.innerHTML = '<div class="history-modal-backdrop"><section class="history-modal"><div class="page-loading"><span class="spinner"></span><p>Loading conversation...</p></div></section></div>';

  try {
    const payload = await api.aiChatDetails(chatId);
    const chat = payload.chat || {};
    const messages = payload.messages || [];
    root.innerHTML = `
      <div class="history-modal-backdrop" data-modal-backdrop>
        <section class="history-modal">
          <header class="history-modal-header"><div><p class="eyebrow">${escapeHtml(chat.username || "Unknown")}</p><h2>${escapeHtml(chat.title || "New chat")}</h2><span>${messages.length} messages · ${escapeHtml(formatDate(chat.updatedAt))}</span></div><button class="icon-button" id="history-modal-close" type="button">×</button></header>
          <div class="history-message-list">${messages.length ? messages.map(messageRow).join("") : emptyState("No messages", "This chat is empty.")}</div>
        </section>
      </div>`;
    root.querySelector("#history-modal-close")?.addEventListener("click", () => root.innerHTML = "");
    root.querySelector("[data-modal-backdrop]")?.addEventListener("mousedown", (event) => { if (event.target.dataset.modalBackdrop !== undefined) root.innerHTML = ""; });
  } catch (error) {
    root.innerHTML = `<div class="history-modal-backdrop"><section class="history-modal"><div class="page-error"><h3>Conversation unavailable</h3><p>${escapeHtml(error.message)}</p><button class="button button-secondary" id="history-error-close" type="button">Close</button></div></section></div>`;
    root.querySelector("#history-error-close")?.addEventListener("click", () => root.innerHTML = "");
  }
}

function messageRow(message) {
  const role = message.role === "assistant" ? "assistant" : "user";
  return `<article class="history-message history-message-${role}"><header><strong>${role === "assistant" ? "Fuzz AI" : "User"}</strong><time>${escapeHtml(formatDate(message.createdAt))}</time></header>${message.hasImage ? badge(`Image attached${message.imageName ? ` · ${message.imageName}` : ""}`, "badge-info") : ""}<pre>${escapeHtml(message.content || "")}</pre></article>`;
}

function paintProxy(container, payload) {
  const logs = payload.logs || [];
  const pagination = payload.pagination || { page: 1, totalPages: 1, total: logs.length };

  container.innerHTML = `
    <div class="page-section">
      <div class="toolbar">${tabs()}${badge("Owner only", "badge-info")}</div>
      <form class="toolbar" id="history-proxy-form">
        <div class="toolbar-group">
          <input class="field search-field" id="history-proxy-search" type="search" value="${escapeHtml(proxyState.search)}" placeholder="Search username, query, URL or domain..." />
          <select class="select-field" id="history-proxy-status"><option value="">All statuses</option><option value="success" ${proxyState.status === "success" ? "selected" : ""}>Success</option><option value="failure" ${proxyState.status === "failure" ? "selected" : ""}>Failure</option></select>
          <button class="button button-secondary" type="submit">Search</button>
          ${proxyState.search || proxyState.status ? '<button class="button button-ghost" id="history-proxy-clear" type="button">Clear</button>' : ""}
        </div>
        ${badge(`${formatNumber(pagination.total)} requests`, "badge-info")}
      </form>

      ${panel({
        title: "Proxy searches and destinations",
        subtitle: "Requests recorded by the proxy logging endpoint",
        flush: true,
        body: logs.length ? `
          <div class="table-wrap"><table class="data-table"><thead><tr><th>User</th><th>Search or URL</th><th>Domain</th><th>Engine</th><th>Status</th><th>Time</th></tr></thead><tbody>${logs.map(proxyRow).join("")}</tbody></table></div>
          ${pager("proxy", pagination)}
        ` : emptyState("No proxy history found", "Make sure the proxy UI sends requests to /api/proxy/log."),
      })}
    </div>`;

  bindTabs(container);
  container.querySelector("#history-proxy-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    proxyState.page = 1;
    proxyState.search = container.querySelector("#history-proxy-search").value.trim();
    proxyState.status = container.querySelector("#history-proxy-status").value;
    renderHistory(container);
  });
  container.querySelector("#history-proxy-clear")?.addEventListener("click", () => { proxyState.page = 1; proxyState.search = ""; proxyState.status = ""; renderHistory(container); });
  bindPager(container, "proxy", proxyState);
}

function proxyRow(log) {
  const main = log.proxyQuery || log.proxyTargetUrl || "No query or URL recorded";
  const detail = log.proxyQuery && log.proxyTargetUrl ? log.proxyTargetUrl : log.action || "proxy.navigation";
  return `<tr><td><div class="table-primary"><span class="table-avatar">${escapeHtml(initials(log.username))}</span><span class="table-primary-copy"><strong>${escapeHtml(log.username || "Unknown")}</strong><span>${escapeHtml(log.userId || "")}</span></span></div></td><td><span class="table-primary-copy history-wide-cell"><strong>${escapeHtml(main)}</strong><span>${escapeHtml(detail)}</span></span></td><td>${escapeHtml(log.proxyTargetDomain || "Unknown")}</td><td>${badge(log.proxyEngine || "bare", "badge-info")}</td><td>${badge(log.status || "unknown", statusClass(log.status))}</td><td>${escapeHtml(formatDate(log.createdAt))}</td></tr>`;
}

function pager(type, pagination) {
  return `<div class="pager"><span>Page ${pagination.page} of ${pagination.totalPages}</span><div class="pager-actions"><button class="button button-small button-secondary" data-history-page="previous" data-history-type="${type}" type="button" ${pagination.page <= 1 ? "disabled" : ""}>Previous</button><button class="button button-small button-secondary" data-history-page="next" data-history-type="${type}" type="button" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>Next</button></div></div>`;
}

function bindPager(container, type, state) {
  container.querySelectorAll(`[data-history-type='${type}']`).forEach((button) => button.addEventListener("click", () => {
    state.page = button.dataset.historyPage === "next" ? state.page + 1 : Math.max(1, state.page - 1);
    renderHistory(container);
  }));
}
