(() => {
  "use strict";

  const SESSION_KEY = "fuzz_browser_tabs_v4";
  const MAX_RESTORED_TABS = 10;

  const elements = {
    tabList: document.getElementById("tab-list"),
    frameContainer: document.getElementById("frame-container"),
    addTab: document.getElementById("add-tab"),
    collapseTabs: document.getElementById("collapse-tabs"),
    brand: document.getElementById("browser-brand"),
    form: document.getElementById("fv"),
    input: document.getElementById("input"),
    clearAddress: document.getElementById("clear-address"),
    addressStatus: document.getElementById("address-status"),
    loadProgress: document.getElementById("load-progress"),
    engineSelect: document.getElementById("tabs-proxy-engine"),
    enginePicker: document.querySelector(".engine-picker"),
    engineLabel: document.getElementById("engine-label"),
    engineDescription: document.getElementById("engine-description"),
    home: document.getElementById("home-page"),
    back: document.getElementById("back-button"),
    forward: document.getElementById("forward-button"),
    reload: document.getElementById("reload-button"),
    popout: document.getElementById("popout-button"),
    fullscreen: document.getElementById("fullscreen-button"),
    more: document.getElementById("more-button"),
    menu: document.getElementById("browser-menu"),
    toastRegion: document.getElementById("browser-toast-region"),
  };

  const tabs = new Map();
  let activeId = null;
  let nextId = 1;
  let draggedTab = null;
  let saveTimer = null;

  const icons = {
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 8 8 8M16 8l-8 8" /></svg>`,
    search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>`,
    home: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8" /><path d="M5.5 10v10h13V10" /></svg>`,
    grid: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>`,
    spark: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" /></svg>`,
    settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" /></svg>`,
    warning: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2.8 20h18.4L12 4Z" /><path d="M12 9v5M12 17.3v.1" /></svg>`,
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function currentEngine() {
    return window.FuzzProxy.getEngine();
  }

  function activeTab() {
    return tabs.get(activeId) || null;
  }

  function tabOrder() {
    return [...elements.tabList.querySelectorAll(".browser-tab")]
      .map((node) => node.dataset.tabId)
      .filter((id) => tabs.has(id));
  }

  function setHostState(tab, ...classes) {
    tab.host.className = [
      "proxy-tab-host",
      ...classes.filter(Boolean),
      tab.id === activeId ? "is-active" : "",
    ].filter(Boolean).join(" ");
  }

  function engineDetails(engine) {
    return engine === "ultraviolet"
      ? { name: "Ultraviolet", description: "Compatibility" }
      : { name: "Scramjet", description: "Recommended" };
  }

  function updateEngineUi(engine = currentEngine()) {
    const details = engineDetails(engine);
    elements.engineSelect.value = engine;
    elements.engineLabel.textContent = details.name;
    elements.engineDescription.textContent = details.description;
    elements.enginePicker.classList.toggle("is-ultraviolet", engine === "ultraviolet");
  }

  function toast(message) {
    const node = document.createElement("div");
    node.className = "browser-toast";
    node.textContent = message;
    elements.toastRegion.appendChild(node);
    window.setTimeout(() => node.remove(), 3000);
  }

  function setAddressValue(value = "") {
    elements.input.value = value;
    elements.form.classList.toggle("has-value", Boolean(value));
    elements.clearAddress.hidden = !value;
  }

  function setPageState(state = "ready") {
    elements.addressStatus.classList.toggle("is-loading", state === "loading");
    elements.addressStatus.classList.toggle("is-error", state === "error");
    elements.addressStatus.title = state === "loading"
      ? "Loading"
      : state === "error"
        ? "Page failed to load"
        : "Ready";
  }

  function setLoading(tab, loading) {
    tab.loading = loading;
    if (tab.id !== activeId) return;

    document.body.classList.toggle("is-loading", loading);
    setPageState(loading ? "loading" : "ready");

    if (loading) {
      elements.loadProgress.classList.remove("is-finishing");
      elements.loadProgress.classList.add("is-active");
    } else {
      elements.loadProgress.classList.remove("is-active");
      elements.loadProgress.classList.add("is-finishing");
      window.setTimeout(() => elements.loadProgress.classList.remove("is-finishing"), 320);
    }
  }

  function scheduleSessionSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const order = tabOrder();
      const payload = {
        activeIndex: Math.max(0, order.indexOf(activeId)),
        tabs: order.slice(0, MAX_RESTORED_TABS).map((id) => {
          const tab = tabs.get(id);
          return {
            url: tab.url || "",
            engine: tab.engine || currentEngine(),
            title: tab.titleNode.textContent || "New tab",
            start: tab.isStart === true,
          };
        }),
      };
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload)); } catch {}
    }, 160);
  }

  function readSession() {
    try {
      const payload = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      return Array.isArray(payload?.tabs) ? payload : null;
    } catch {
      return null;
    }
  }

  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  }

  function fallbackTitle(url = "") {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "New tab"; }
  }

  function setFavicon(tab, source = "") {
    tab.favicon.innerHTML = "";
    if (!source) {
      const fallback = document.createElement("span");
      fallback.className = "tab-favicon-fallback";
      fallback.textContent = tab.isStart ? "F" : "•";
      tab.favicon.appendChild(fallback);
      return;
    }

    const image = document.createElement("img");
    image.alt = "";
    image.src = source;
    image.addEventListener("error", () => setFavicon(tab), { once: true });
    tab.favicon.appendChild(image);
  }

  function updateMetadata(tab) {
    const frame = tab.view?.element;
    if (!frame) return;

    let title = "";
    let icon = "";
    try {
      title = frame.contentDocument?.title?.trim() || "";
      icon = frame.contentDocument?.querySelector('link[rel~="icon"],link[rel="shortcut icon"]')?.href || "";
    } catch {}

    tab.titleNode.textContent = title.slice(0, 60) || fallbackTitle(tab.url);
    if (icon) setFavicon(tab, icon);
    scheduleSessionSave();
  }

  function syncActiveUi() {
    const tab = activeTab();
    if (!tab) return;

    for (const current of tabs.values()) {
      const active = current.id === tab.id;
      current.button.classList.toggle("is-active", active);
      current.button.setAttribute("aria-selected", String(active));
      current.button.tabIndex = active ? 0 : -1;
      current.host.classList.toggle("is-active", active);
    }

    setAddressValue(tab.url || "");
    updateEngineUi(tab.engine || currentEngine());
    setLoading(tab, tab.loading === true);
    tab.button.scrollIntoView({ block: "nearest", inline: "nearest" });

    window.dispatchEvent(new CustomEvent("fuzz:active-tab-change", {
      detail: {
        id: tab.id,
        url: tab.url,
        engine: tab.engine,
        title: tab.titleNode.textContent,
      },
    }));
  }

  function setActive(id) {
    if (!tabs.has(id)) return;
    activeId = id;
    syncActiveUi();
    scheduleSessionSave();
  }

  function createTabButton(tab) {
    const button = document.createElement("div");
    button.className = "browser-tab";
    button.dataset.tabId = tab.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.tabIndex = -1;
    button.draggable = true;

    const favicon = document.createElement("span");
    favicon.className = "tab-favicon";
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = "New tab";
    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.title = "Close tab";
    close.setAttribute("aria-label", "Close tab");
    close.innerHTML = icons.close;

    button.append(favicon, title, close);
    Object.assign(tab, { button, favicon, titleNode: title, closeButton: close });

    button.addEventListener("click", () => setActive(tab.id));
    button.addEventListener("keydown", (event) => {
      if (["Enter", " "].includes(event.key)) {
        event.preventDefault();
        setActive(tab.id);
      }
    });
    button.addEventListener("auxclick", (event) => {
      if (event.button === 1) closeTab(tab.id);
    });
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(tab.id);
    });

    elements.tabList.appendChild(button);
  }

  function startShortcut(label, description, href, icon) {
    return `<button class="start-shortcut" type="button" data-local-href="${href}"><span class="start-shortcut-icon">${icon}</span><span class="start-shortcut-copy"><strong>${label}</strong><span>${description}</span></span></button>`;
  }

  function showStartPage(tab) {
    tab.view?.destroy?.();
    tab.view = null;
    tab.url = "";
    tab.isStart = true;
    tab.loading = false;
    tab.engine = tab.engine || currentEngine();
    setHostState(tab, "browser-start-host");

    tab.host.innerHTML = `
      <section class="browser-start-page">
        <div class="start-content">
          <div class="start-logo">F</div>
          <h1>New tab</h1>
          <p>Search the web or jump back into Fuzz.</p>
          <form class="start-search" data-start-search>
            ${icons.search}
            <input type="text" placeholder="Search or enter a URL" aria-label="Search or enter a URL" autocomplete="off" spellcheck="false" />
            <button type="submit">Search</button>
          </form>
          <div class="start-shortcuts">
            ${startShortcut("Fuzz Home", "Return to the main page", "/", icons.home)}
            ${startShortcut("Apps", "Open your app library", "/b", icons.grid)}
            ${startShortcut("Fuzz AI", "Start an AI conversation", "/ai", icons.spark)}
            ${startShortcut("Settings", "Account and browser options", "/account#preferences", icons.settings)}
          </div>
        </div>
      </section>`;

    tab.titleNode.textContent = "New tab";
    setFavicon(tab);

    const form = tab.host.querySelector("[data-start-search]");
    const input = form.querySelector("input");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      navigateTab(tab, input.value, currentEngine());
    });
    tab.host.querySelectorAll("[data-local-href]").forEach((button) => {
      button.addEventListener("click", () => location.assign(button.dataset.localHref));
    });

    if (tab.id === activeId) {
      setAddressValue("");
      setPageState("ready");
      window.setTimeout(() => input.focus(), 40);
    }
    scheduleSessionSave();
  }

  function showError(tab, url, engine, error) {
    const otherEngine = engine === "scramjet" ? "ultraviolet" : "scramjet";
    const errorId = window.FuzzDiagnostics?.report?.(error, {
      prefix: "PX",
      component: "tabs",
      action: "proxy.navigation_failed",
      engine,
      targetUrl: url,
    }) || "";

    tab.view = null;
    tab.isStart = false;
    tab.url = url;
    tab.engine = engine;
    tab.loading = false;
    tab.titleNode.textContent = "Page failed";
    setFavicon(tab);
    setHostState(tab, "has-error");

    tab.host.innerHTML = `
      <section class="tabs-error-card">
        <div class="tabs-error-content">
          <div class="tabs-error-icon">${icons.warning}</div>
          <h2>${engine === "scramjet" ? "Scramjet" : "Ultraviolet"} could not open this page</h2>
          <p>${escapeHtml(error?.message || error || "The page could not be loaded.")}</p>
          ${errorId ? `<p><strong>Error ID: ${escapeHtml(errorId)}</strong></p>` : ""}
          <div class="tabs-error-actions">
            <button type="button" data-retry-current>Try again</button>
            <button type="button" data-retry-other>Try ${otherEngine === "scramjet" ? "Scramjet" : "Ultraviolet"}</button>
            <button type="button" data-open-start>New tab</button>
            <button type="button" data-open-status>Status</button>
          </div>
        </div>
      </section>`;

    tab.host.querySelector("[data-retry-current]")?.addEventListener("click", () => navigateTab(tab, url, engine, { log: false }));
    tab.host.querySelector("[data-retry-other]")?.addEventListener("click", () => {
      window.FuzzProxy.setEngine(otherEngine);
      navigateTab(tab, url, otherEngine, { log: false });
    });
    tab.host.querySelector("[data-open-start]")?.addEventListener("click", () => showStartPage(tab));
    tab.host.querySelector("[data-open-status]")?.addEventListener("click", () => location.assign("/status"));

    if (tab.id === activeId) {
      setPageState("error");
      setLoading(tab, false);
    }
    scheduleSessionSave();
  }

  async function navigateTab(tab, value, engine = currentEngine(), { log = true } = {}) {
    const url = window.FuzzProxy.normalizeInput(value);
    if (!url) return;

    tab.view?.destroy?.();
    tab.view = null;
    tab.url = url;
    tab.engine = engine;
    tab.isStart = false;
    tab.loading = true;
    setHostState(tab, "is-loading");
    tab.host.innerHTML = "";
    tab.titleNode.textContent = "Loading…";
    setFavicon(tab);

    if (tab.id === activeId) {
      setAddressValue(url);
      updateEngineUi(engine);
      setLoading(tab, true);
    }

    if (log) {
      window.FuzzProxy.logNavigation(
        url,
        engine,
        window.FuzzProxy.isUrl(value) ? "" : String(value || ""),
        "tabs-address-bar",
      );
    }

    try {
      const view = await window.FuzzProxy.createView(tab.host, url, engine);
      tab.view = view;
      tab.url = view.url;
      tab.engine = view.engine;
      tab.loading = false;
      setHostState(tab);
      tab.titleNode.textContent = fallbackTitle(tab.url);

      window.FuzzBrowserData?.recordRecent?.({
        url: tab.url,
        title: tab.titleNode.textContent,
        engine: tab.engine,
      });

      view.element.addEventListener("load", () => {
        tab.loading = false;
        updateMetadata(tab);
        window.FuzzBrowserData?.recordRecent?.({
          url: tab.url,
          title: tab.titleNode.textContent,
          engine: tab.engine,
        });
        if (tab.id === activeId) {
          setLoading(tab, false);
          setAddressValue(tab.url);
        }
      });

      if (tab.id === activeId) {
        setLoading(tab, false);
        setAddressValue(tab.url);
        updateEngineUi(tab.engine);
      }
      scheduleSessionSave();
      syncActiveUi();
    } catch (error) {
      console.error(error);
      window.FuzzProxy.logNavigation(url, engine, "", "tabs-failure", "failure");
      showError(tab, url, engine, error);
    }
  }

  function createTab({ url = "", engine = currentEngine(), activate = true, start = !url } = {}) {
    const id = String(nextId++);
    const host = document.createElement("section");
    host.className = "proxy-tab-host";
    host.dataset.tabId = id;
    elements.frameContainer.appendChild(host);

    const tab = {
      id,
      host,
      button: null,
      favicon: null,
      titleNode: null,
      closeButton: null,
      view: null,
      url: "",
      engine,
      isStart: true,
      loading: false,
    };

    tabs.set(id, tab);
    createTabButton(tab);
    if (activate) setActive(id);
    if (url && !start) navigateTab(tab, url, engine, { log: false });
    else showStartPage(tab);
    scheduleSessionSave();
    return tab;
  }

  function closeTab(id) {
    const tab = tabs.get(id);
    if (!tab) return;
    const order = tabOrder();
    const index = order.indexOf(id);

    if (tab.url) {
      window.FuzzBrowserData?.recordClosed?.({
        url: tab.url,
        title: tab.titleNode.textContent || fallbackTitle(tab.url),
        engine: tab.engine,
      });
    }

    tab.view?.destroy?.();
    tab.button.remove();
    tab.host.remove();
    tabs.delete(id);

    if (tabs.size === 0) {
      createTab();
      return;
    }

    if (activeId === id) {
      setActive(order[index + 1] || order[index - 1] || tabOrder()[0]);
    }
    scheduleSessionSave();
  }

  function navigateActive(value, engine = currentEngine()) {
    return navigateTab(activeTab() || createTab(), value, engine);
  }

  function reopenClosed() {
    const entry = window.FuzzBrowserData?.takeClosed?.();
    if (!entry) return toast("There are no recently closed tabs.");
    createTab({ url: entry.url, engine: entry.engine, start: false });
  }

  function reloadActive() {
    const tab = activeTab();
    if (!tab || tab.isStart) return;
    try {
      setLoading(tab, true);
      tab.view.element.contentWindow.location.reload();
      window.setTimeout(() => setLoading(tab, false), 8000);
    } catch {
      navigateTab(tab, tab.url, tab.engine, { log: false });
    }
  }

  function historyAction(direction) {
    try { activeTab()?.view?.element?.contentWindow?.history?.[direction]?.(); } catch {}
  }

  function popoutActive() {
    const tab = activeTab();
    if (!tab?.url) return toast("Open a website before using popout.");
    window.FuzzProxy.savePending(tab.url, tab.engine);
    window.open("/p", "_blank", "noopener");
  }

  function toggleFullscreen() {
    document.body.classList.toggle("fullscreen-browser");
    closeMenu();
  }

  function toggleTabStrip() {
    document.body.classList.toggle("tabs-compact");
    elements.collapseTabs.title = document.body.classList.contains("tabs-compact")
      ? "Show tab strip"
      : "Hide tab strip";
  }

  function openMenu() {
    elements.menu.hidden = false;
    elements.more.setAttribute("aria-expanded", "true");
  }

  function closeMenu() {
    elements.menu.hidden = true;
    elements.more.setAttribute("aria-expanded", "false");
  }

  function bindChrome() {
    elements.form.addEventListener("submit", (event) => {
      event.preventDefault();
      navigateActive(elements.input.value);
    });
    elements.input.addEventListener("input", () => setAddressValue(elements.input.value));
    elements.input.addEventListener("focus", () => window.setTimeout(() => elements.input.select(), 0));
    elements.clearAddress.addEventListener("click", () => {
      setAddressValue("");
      elements.input.focus();
    });
    elements.engineSelect.addEventListener("change", () => {
      const engine = window.FuzzProxy.setEngine(elements.engineSelect.value);
      updateEngineUi(engine);
      const tab = activeTab();
      if (tab?.url) navigateTab(tab, tab.url, engine, { log: false });
      else if (tab) tab.engine = engine;
    });
    elements.addTab.addEventListener("click", () => createTab());
    elements.home.addEventListener("click", () => location.assign("/"));
    elements.brand.addEventListener("click", () => location.assign("/"));
    elements.back.addEventListener("click", () => historyAction("back"));
    elements.forward.addEventListener("click", () => historyAction("forward"));
    elements.reload.addEventListener("click", reloadActive);
    elements.popout.addEventListener("click", popoutActive);
    elements.fullscreen.addEventListener("click", toggleFullscreen);
    elements.collapseTabs.addEventListener("click", toggleTabStrip);
    elements.more.addEventListener("click", (event) => {
      event.stopPropagation();
      elements.menu.hidden ? openMenu() : closeMenu();
    });
    document.addEventListener("click", (event) => {
      if (!elements.menu.hidden && !event.target.closest("#browser-menu,#more-button")) closeMenu();
    });
    elements.menu.addEventListener("click", (event) => {
      const action = event.target.closest("[data-menu-action]")?.dataset.menuAction;
      if (action === "new-tab") createTab();
      if (action === "home") location.assign("/");
      if (action === "popout") popoutActive();
      if (action === "fullscreen") toggleFullscreen();
      closeMenu();
    });
    window.addEventListener("fuzz:proxy-engine-change", (event) => updateEngineUi(event.detail?.engine));
  }

  function bindKeyboard() {
    document.addEventListener("keydown", (event) => {
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === "l") {
        event.preventDefault();
        elements.input.focus();
        elements.input.select();
      } else if (modifier && event.shiftKey && key === "t") {
        event.preventDefault();
        reopenClosed();
      } else if (modifier && key === "t") {
        event.preventDefault();
        createTab();
      } else if (modifier && key === "w") {
        event.preventDefault();
        if (activeId) closeTab(activeId);
      } else if (modifier && key === "r") {
        event.preventDefault();
        reloadActive();
      } else if (modifier && key === "b") {
        event.preventDefault();
        document.querySelector('[data-menu-action="bookmarks"]')?.click();
      } else if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        historyAction("back");
      } else if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        historyAction("forward");
      } else if (event.key === "F11") {
        event.preventDefault();
        toggleFullscreen();
      }
    });
  }

  function bindTabDragging() {
    elements.tabList.addEventListener("dragstart", (event) => {
      draggedTab = event.target.closest(".browser-tab");
      if (draggedTab) event.dataTransfer.effectAllowed = "move";
    });
    elements.tabList.addEventListener("dragover", (event) => {
      event.preventDefault();
      const target = event.target.closest(".browser-tab");
      if (!draggedTab || !target || draggedTab === target) return;
      const rect = target.getBoundingClientRect();
      elements.tabList.insertBefore(
        draggedTab,
        event.clientX < rect.left + rect.width / 2 ? target : target.nextSibling,
      );
    });
    elements.tabList.addEventListener("dragend", () => {
      draggedTab = null;
      scheduleSessionSave();
    });
  }

  function restoreInitialTabs() {
    const pendingUrl = sessionStorage.getItem("GoUrlRaw");
    const pendingEngine = sessionStorage.getItem("GoProxyEngine") || currentEngine();
    sessionStorage.removeItem("GoUrlRaw");
    sessionStorage.removeItem("GoProxyEngine");
    sessionStorage.removeItem("GoUrl");

    if (pendingUrl) {
      createTab({ url: pendingUrl, engine: pendingEngine, start: false });
      return;
    }

    const saved = readSession();
    if (!saved?.tabs?.length) {
      createTab();
      return;
    }

    const created = saved.tabs.slice(0, MAX_RESTORED_TABS).map((item) => createTab({
      url: item.start ? "" : String(item.url || ""),
      engine: item.engine || currentEngine(),
      activate: false,
      start: item.start === true || !item.url,
    }));
    const active = created[Math.min(Number(saved.activeIndex || 0), created.length - 1)] || created[0];
    setActive(active.id);
  }

  window.fuzzNavigateActiveTab = navigateActive;
  window.FuzzTabsApi = Object.freeze({
    createTab,
    closeTab,
    setActive,
    navigateActive,
    reopenClosed,
    clearSession,
    toast,
    getActive() {
      const tab = activeTab();
      return tab ? {
        id: tab.id,
        url: tab.url,
        engine: tab.engine,
        title: tab.titleNode?.textContent || fallbackTitle(tab.url),
        isStart: tab.isStart,
      } : null;
    },
  });
  window.Home = () => location.assign("/");
  window.reload = reloadActive;
  window.goBack = () => historyAction("back");
  window.goForward = () => historyAction("forward");
  window.FS = toggleFullscreen;
  window.popout = popoutActive;

  function init() {
    bindChrome();
    bindKeyboard();
    bindTabDragging();
    updateEngineUi(currentEngine());
    restoreInitialTabs();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
