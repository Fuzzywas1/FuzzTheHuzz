(() => {
  "use strict";

  const tabList = document.getElementById("tab-list");
  const frameContainer = document.getElementById("frame-container");
  const addTabButton = document.getElementById("add-tab");
  const form = document.getElementById("fv");
  const input = document.getElementById("input");
  const engineSelect = document.getElementById("tabs-proxy-engine");

  const tabs = new Map();
  let activeId = null;
  let nextId = 1;

  function activeTab() {
    return tabs.get(activeId) || null;
  }

  function selectedEngine() {
    return window.FuzzProxy.getEngine();
  }

  function setActive(id) {
    if (!tabs.has(id)) return;
    activeId = id;

    for (const tab of tabs.values()) {
      const active = tab.id === id;
      tab.button.classList.toggle("active", active);
      tab.host.classList.toggle("active", active);
    }

    const tab = activeTab();
    input.value = tab?.url || "";
    if (engineSelect) engineSelect.value = tab?.engine || selectedEngine();
  }

  function updateTitle(tab) {
    const frame = tab.view?.element;
    if (!frame) return;

    try {
      const title = frame.contentDocument?.title?.trim();
      if (title) tab.title.textContent = title.slice(0, 32);
    } catch {
      tab.title.textContent = new URL(tab.url).hostname.replace(/^www\./, "");
    }
  }

  async function mountView(tab, url, engine) {
    tab.view?.destroy?.();
    tab.host.innerHTML = "";
    tab.host.classList.add("is-loading");
    tab.title.textContent = "Loading…";

    try {
      tab.view = await window.FuzzProxy.createView(tab.host, url, engine);
      tab.url = tab.view.url;
      tab.engine = tab.view.engine;
      tab.view.element.addEventListener("load", () => updateTitle(tab));
      tab.title.textContent = new URL(tab.url).hostname.replace(/^www\./, "");
      tab.host.classList.remove("has-error");
    } catch (error) {
      console.error(error);
      tab.host.classList.add("has-error");
      tab.host.innerHTML = `
        <div class="tabs-error-card">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <h2>${engine === "scramjet" ? "Scramjet could not open this page" : "Ultraviolet could not open this page"}</h2>
          <p>${String(error.message || error)}</p>
          ${engine === "scramjet" ? '<button type="button" data-retry-ultraviolet>Retry with Ultraviolet</button>' : ""}
        </div>`;
      tab.host.querySelector("[data-retry-ultraviolet]")?.addEventListener("click", () => {
        window.FuzzProxy.setEngine("ultraviolet");
        mountView(tab, url, "ultraviolet");
      });
      tab.title.textContent = "Failed";
    } finally {
      tab.host.classList.remove("is-loading");
      if (tab.id === activeId) {
        input.value = tab.url || url;
        if (engineSelect) engineSelect.value = tab.engine || engine;
      }
    }
  }

  function createTab(rawUrl = "", engine = selectedEngine()) {
    const id = String(nextId++);
    const item = document.createElement("li");
    item.dataset.tabId = id;
    item.draggable = true;

    const title = document.createElement("span");
    title.className = "t";
    title.textContent = rawUrl ? "Loading…" : "New tab";

    const close = document.createElement("button");
    close.className = "close-tab";
    close.type = "button";
    close.innerHTML = "&#10005;";
    close.setAttribute("aria-label", "Close tab");

    item.append(title, close);
    tabList.appendChild(item);

    const host = document.createElement("section");
    host.className = "proxy-tab-host";
    host.dataset.tabId = id;
    frameContainer.appendChild(host);

    const tab = { id, button: item, title, close, host, view: null, url: "", engine };
    tabs.set(id, tab);

    item.addEventListener("click", () => setActive(id));
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(id);
    });

    setActive(id);

    if (rawUrl) {
      void mountView(tab, rawUrl, engine);
    } else {
      const iframe = document.createElement("iframe");
      iframe.src = "/";
      iframe.className = "fuzz-proxy-frame";
      host.appendChild(iframe);
      tab.view = { element: iframe, destroy: () => iframe.remove(), engine: "local", url: "/" };
      tab.url = "";
      tab.engine = engine;
    }

    return tab;
  }

  function closeTab(id) {
    const tab = tabs.get(id);
    if (!tab) return;
    const ids = [...tabs.keys()];
    const index = ids.indexOf(id);
    tab.view?.destroy?.();
    tab.button.remove();
    tab.host.remove();
    tabs.delete(id);

    if (tabs.size === 0) {
      createTab();
      return;
    }

    if (activeId === id) {
      setActive(ids[index + 1] || ids[index - 1] || [...tabs.keys()][0]);
    }
  }

  async function navigateActive(value, engine = selectedEngine()) {
    const tab = activeTab() || createTab();
    const url = window.FuzzProxy.normalizeInput(value);
    if (!url) return;
    window.FuzzProxy.logNavigation(url, engine, window.FuzzProxy.isUrl(value) ? "" : value, "tabs-address-bar");
    await mountView(tab, url, engine);
  }

  window.fuzzNavigateActiveTab = navigateActive;

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void navigateActive(input.value, selectedEngine());
  });

  addTabButton?.addEventListener("click", () => createTab());

  engineSelect?.addEventListener("change", () => {
    const engine = window.FuzzProxy.setEngine(engineSelect.value);
    const tab = activeTab();
    if (tab?.url) void mountView(tab, tab.url, engine);
  });

  window.Home = () => {
    const tab = activeTab();
    if (!tab) return;
    tab.view?.destroy?.();
    tab.host.innerHTML = '<iframe class="fuzz-proxy-frame" src="/"></iframe>';
    const iframe = tab.host.querySelector("iframe");
    tab.view = { element: iframe, destroy: () => iframe.remove(), engine: "local", url: "/" };
    tab.url = "";
    tab.title.textContent = "Home";
    input.value = "";
  };

  window.reload = () => {
    const frame = activeTab()?.view?.element;
    try { frame?.contentWindow?.location.reload(); } catch { if (activeTab()?.url) void mountView(activeTab(), activeTab().url, activeTab().engine); }
  };
  window.goBack = () => { try { activeTab()?.view?.element?.contentWindow?.history.back(); } catch {} };
  window.goForward = () => { try { activeTab()?.view?.element?.contentWindow?.history.forward(); } catch {} };
  window.FS = () => document.body.classList.toggle("fullscreen");
  window.popout = () => {
    const tab = activeTab();
    if (!tab?.url) return;
    window.FuzzProxy.savePending(tab.url, tab.engine);
    window.open("/p", "_blank", "noopener");
  };
  window.eToggle = () => window.alert("Inspect tools are not available for proxied pages.");

  document.getElementById("fullscreen-button")?.addEventListener("click", window.FS);
  document.getElementById("popout-button")?.addEventListener("click", window.popout);
  document.getElementById("tabs-button")?.addEventListener("click", () => {
    document.body.classList.toggle("tabs-collapsed");
  });

  let dragged = null;
  tabList.addEventListener("dragstart", (event) => { dragged = event.target.closest("li"); });
  tabList.addEventListener("dragover", (event) => {
    event.preventDefault();
    const target = event.target.closest("li");
    if (!dragged || !target || dragged === target) return;
    const rect = target.getBoundingClientRect();
    tabList.insertBefore(dragged, event.clientX < rect.left + rect.width / 2 ? target : target.nextSibling);
  });
  tabList.addEventListener("dragend", () => { dragged = null; });

  const pendingUrl = sessionStorage.getItem("GoUrlRaw");
  const pendingEngine = sessionStorage.getItem("GoProxyEngine") || selectedEngine();
  sessionStorage.removeItem("GoUrlRaw");
  sessionStorage.removeItem("GoProxyEngine");
  // Remove legacy encoded state so it cannot create a malformed first tab.
  sessionStorage.removeItem("GoUrl");

  createTab(pendingUrl || "", pendingEngine);
})();
