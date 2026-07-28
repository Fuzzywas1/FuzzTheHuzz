(() => {
  "use strict";

  const proxyGrid = document.querySelector("[data-home-proxy-grid]");
  const bookmarkContainer = document.getElementById("home-bookmarks");
  const recentContainer = document.getElementById("home-recents");

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function refreshProxyCards() {
    const selected = window.FuzzProxy?.getEngine?.() || "scramjet";
    proxyGrid?.querySelectorAll("[data-home-engine]").forEach((card) => {
      card.classList.toggle("is-selected", card.dataset.homeEngine === selected);
    });
  }

  function openEntry(url, engine = window.FuzzProxy?.getEngine?.() || "scramjet") {
    window.FuzzProxy?.openTabs?.(url, engine);
  }

  function renderEntries(container, entries, emptyLabel) {
    if (!container) return;
    if (!entries.length) {
      container.innerHTML = `<div class="home-library-empty">${escapeHtml(emptyLabel)}</div>`;
      return;
    }

    container.innerHTML = entries.slice(0, 6).map((entry) => `
      <button class="home-library-item" type="button" data-home-open="${escapeHtml(entry.url)}" data-home-open-engine="${escapeHtml(entry.engine || "scramjet")}">
        <span class="home-library-icon">${escapeHtml((entry.title || "S").slice(0, 1).toUpperCase())}</span>
        <span><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(new URL(entry.url).hostname.replace(/^www\./, ""))}</small></span>
      </button>
    `).join("");

    container.querySelectorAll("[data-home-open]").forEach((button) => {
      button.addEventListener("click", () => openEntry(button.dataset.homeOpen, button.dataset.homeOpenEngine));
    });
  }

  async function refreshLibrary() {
    if (!window.FuzzBrowserData) return;
    const { bookmarks } = await window.FuzzBrowserData.listBookmarks();
    const pinned = bookmarks.filter((bookmark) => bookmark.pinned);
    renderEntries(bookmarkContainer, pinned.length ? pinned : bookmarks, "Save bookmarks from Tabs and they will appear here.");
    renderEntries(recentContainer, window.FuzzBrowserData.getRecents(), "Your recently opened sites will appear here.");
  }

  proxyGrid?.querySelectorAll("[data-home-engine]").forEach((card) => {
    card.addEventListener("click", () => {
      window.FuzzProxy?.setEngine?.(card.dataset.homeEngine);
      refreshProxyCards();
    });
  });

  window.addEventListener("fuzz:proxy-engine-change", refreshProxyCards);
  window.addEventListener("fuzz:bookmarks-changed", refreshLibrary);
  window.addEventListener("fuzz:browser-data-changed", refreshLibrary);
  refreshProxyCards();
  refreshLibrary();
})();
