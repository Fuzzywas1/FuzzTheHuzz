(() => {
  "use strict";

  const drawer = document.getElementById("browser-library");
  const drawerContent = document.getElementById("browser-library-content");
  const drawerTitle = document.getElementById("browser-library-title");
  const bookmarkButton = document.getElementById("bookmark-button");
  const importInput = document.getElementById("bookmark-import-file");
  let section = "bookmarks";

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function activeTab() {
    return window.FuzzTabsApi?.getActive?.() || null;
  }

  function openEntry(entry, newTab = false) {
    if (!entry?.url) return;
    if (newTab) {
      window.FuzzTabsApi?.createTab?.({
        url: entry.url,
        engine: entry.engine || window.FuzzProxy.getEngine(),
        start: false,
      });
    } else {
      window.FuzzTabsApi?.navigateActive?.(entry.url, entry.engine || window.FuzzProxy.getEngine());
    }
    closeDrawer();
  }

  function siteLabel(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  function entryMarkup(entry, kind) {
    const controls = kind === "bookmarks"
      ? `<button type="button" data-library-pin="${escapeHtml(entry.id)}" title="${entry.pinned ? "Unpin" : "Pin"}">${entry.pinned ? "◆" : "◇"}</button><button type="button" data-library-delete="${escapeHtml(entry.id)}" title="Delete">×</button>`
      : `<button type="button" data-library-newtab="${escapeHtml(entry.url)}" data-library-engine="${escapeHtml(entry.engine || "scramjet")}" title="Open in new tab">↗</button>`;

    return `
      <article class="browser-library-entry">
        <button class="browser-library-open" type="button" data-library-open="${escapeHtml(entry.url)}" data-library-engine="${escapeHtml(entry.engine || "scramjet")}">
          <span class="browser-library-entry-icon">${escapeHtml((entry.title || "S").slice(0, 1).toUpperCase())}</span>
          <span class="browser-library-entry-copy"><strong>${escapeHtml(entry.title || siteLabel(entry.url))}</strong><small>${escapeHtml(siteLabel(entry.url))}</small></span>
        </button>
        <div class="browser-library-entry-actions">${controls}</div>
      </article>
    `;
  }

  async function renderDrawer() {
    if (!drawerContent) return;
    drawerContent.innerHTML = `<div class="browser-library-loading"><span></span>Loading…</div>`;

    let entries = [];
    if (section === "bookmarks") {
      const payload = await window.FuzzBrowserData.listBookmarks();
      entries = payload.bookmarks;
      drawerTitle.textContent = payload.source === "account" ? "Bookmarks · Synced" : "Bookmarks · This browser";
    } else if (section === "recent") {
      entries = window.FuzzBrowserData.getRecents();
      drawerTitle.textContent = "Recently visited";
    } else {
      entries = window.FuzzBrowserData.getClosed();
      drawerTitle.textContent = "Recently closed";
    }

    document.querySelectorAll("[data-library-section]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.librarySection === section);
    });

    if (!entries.length) {
      drawerContent.innerHTML = `<div class="browser-library-empty"><strong>Nothing here yet</strong><span>${section === "bookmarks" ? "Use the star button to save the current page." : section === "recent" ? "Sites you open will appear here." : "Closed tabs will appear here."}</span></div>`;
      return;
    }

    drawerContent.innerHTML = entries.map((entry) => entryMarkup(entry, section)).join("");

    drawerContent.querySelectorAll("[data-library-open]").forEach((button) => {
      button.addEventListener("click", () => openEntry({ url: button.dataset.libraryOpen, engine: button.dataset.libraryEngine }));
    });
    drawerContent.querySelectorAll("[data-library-newtab]").forEach((button) => {
      button.addEventListener("click", () => openEntry({ url: button.dataset.libraryNewtab, engine: button.dataset.libraryEngine }, true));
    });
    drawerContent.querySelectorAll("[data-library-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        await window.FuzzBrowserData.deleteBookmark(button.dataset.libraryDelete);
        renderDrawer();
      });
    });
    drawerContent.querySelectorAll("[data-library-pin]").forEach((button) => {
      button.addEventListener("click", async () => {
        const payload = await window.FuzzBrowserData.listBookmarks();
        const bookmark = payload.bookmarks.find((item) => item.id === button.dataset.libraryPin);
        if (!bookmark) return;
        await window.FuzzBrowserData.updateBookmark(bookmark.id, { pinned: !bookmark.pinned });
        renderDrawer();
      });
    });
  }

  function openDrawer(nextSection = section) {
    section = nextSection;
    drawer.hidden = false;
    requestAnimationFrame(() => drawer.classList.add("is-open"));
    renderDrawer();
  }

  function closeDrawer() {
    drawer.classList.remove("is-open");
    window.setTimeout(() => {
      if (!drawer.classList.contains("is-open")) drawer.hidden = true;
    }, 180);
  }

  async function saveActiveBookmark() {
    const tab = activeTab();
    if (!tab?.url) {
      window.FuzzTabsApi?.toast?.("Open a website before bookmarking it.");
      return;
    }

    await window.FuzzBrowserData.createBookmark({
      url: tab.url,
      title: tab.title || siteLabel(tab.url),
      engine: tab.engine,
      pinned: false,
    });
    bookmarkButton?.classList.add("is-saved");
    window.FuzzTabsApi?.toast?.("Bookmark saved.");
  }

  async function updateBookmarkButton() {
    const tab = activeTab();
    if (!bookmarkButton || !tab?.url) {
      bookmarkButton?.classList.remove("is-saved");
      return;
    }
    const payload = await window.FuzzBrowserData.listBookmarks();
    bookmarkButton.classList.toggle("is-saved", payload.bookmarks.some((bookmark) => bookmark.url === tab.url));
  }

  function engineCard(engine, title, description) {
    const selected = window.FuzzProxy.getEngine() === engine;
    return `<button class="start-proxy-card ${selected ? "is-selected" : ""}" type="button" data-start-proxy="${engine}"><span class="start-proxy-radio"></span><span><strong>${title}</strong><small>${description}</small></span></button>`;
  }

  function enhanceStartPage(root) {
    const page = root.matches?.(".browser-start-page") ? root : root.querySelector?.(".browser-start-page");
    if (!page || page.dataset.fuzzEnhanced === "true") return;
    page.dataset.fuzzEnhanced = "true";
    const search = page.querySelector(".start-search");
    if (!search) return;

    const chooser = document.createElement("section");
    chooser.className = "start-proxy-chooser";
    chooser.innerHTML = `
      <div class="start-proxy-heading"><strong>Choose a proxy</strong><span>Your choice is remembered</span></div>
      <div class="start-proxy-grid">
        ${engineCard("scramjet", "Scramjet", "Recommended for modern websites")}
        ${engineCard("ultraviolet", "Ultraviolet", "Compatibility fallback")}
      </div>
      <p class="start-proxy-help">When Scramjet fails, the error screen can retry the page with Ultraviolet.</p>
    `;
    search.insertAdjacentElement("afterend", chooser);

    chooser.querySelectorAll("[data-start-proxy]").forEach((button) => {
      button.addEventListener("click", () => {
        window.FuzzProxy.setEngine(button.dataset.startProxy);
        chooser.querySelectorAll("[data-start-proxy]").forEach((card) => {
          card.classList.toggle("is-selected", card === button);
        });
      });
    });

    const settings = window.FuzzUI?.getSettings?.();
    if (settings?.showNewTabShortcuts === false) {
      page.querySelector(".start-shortcuts")?.remove();
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) enhanceStartPage(node);
      });
    }
  });
  observer.observe(document.getElementById("frame-container"), { childList: true, subtree: true });
  document.querySelectorAll(".browser-start-page").forEach(enhanceStartPage);

  bookmarkButton?.addEventListener("click", saveActiveBookmark);
  document.getElementById("library-close")?.addEventListener("click", closeDrawer);
  document.querySelectorAll("[data-library-section]").forEach((button) => {
    button.addEventListener("click", () => {
      section = button.dataset.librarySection;
      renderDrawer();
    });
  });
  document.getElementById("library-add-current")?.addEventListener("click", saveActiveBookmark);
  document.getElementById("library-export")?.addEventListener("click", async () => {
    const payload = await window.FuzzBrowserData.exportBookmarks();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fuzz-bookmarks-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById("library-import")?.addEventListener("click", () => importInput?.click());
  importInput?.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const imported = await window.FuzzBrowserData.importBookmarks(payload.bookmarks || payload);
      window.FuzzTabsApi?.toast?.(`Imported ${imported} bookmark${imported === 1 ? "" : "s"}.`);
      renderDrawer();
    } catch (error) {
      window.FuzzTabsApi?.toast?.(`Import failed: ${error.message}`);
    } finally {
      importInput.value = "";
    }
  });

  document.getElementById("browser-menu")?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-menu-action]")?.dataset.menuAction;
    if (action === "bookmarks") openDrawer("bookmarks");
    if (action === "recent") openDrawer("recent");
    if (action === "closed") openDrawer("closed");
    if (action === "status") location.href = "/status";
    if (action === "changelog") window.FuzzUI?.loadRelease?.().then(window.FuzzUI.showChangelog).catch(() => {});
    if (action === "clear-browsing-data") {
      if (confirm("Clear recently visited sites, recently closed tabs, and the saved tab session?")) {
        window.FuzzBrowserData.clearRecents();
        window.FuzzBrowserData.clearClosed();
        window.FuzzTabsApi?.clearSession?.();
        window.FuzzTabsApi?.toast?.("Browsing session cleared.");
      }
    }
  }, true);

  window.addEventListener("fuzz:active-tab-change", updateBookmarkButton);
  window.addEventListener("fuzz:bookmarks-changed", () => {
    updateBookmarkButton();
    if (!drawer.hidden && section === "bookmarks") renderDrawer();
  });
  window.addEventListener("fuzz:browser-data-changed", () => {
    if (!drawer.hidden && section !== "bookmarks") renderDrawer();
  });
  updateBookmarkButton();
})();
