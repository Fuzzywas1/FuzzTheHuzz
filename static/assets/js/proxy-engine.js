(() => {
  "use strict";

  const STORAGE_KEY = "fuzz_proxy_engine";
  const DEFAULT_ENGINE = "scramjet";
  const ENGINES = Object.freeze({
    scramjet: {
      id: "scramjet",
      name: "Scramjet",
      shortName: "Scramjet",
      description: "Recommended for modern websites",
    },
    ultraviolet: {
      id: "ultraviolet",
      name: "Ultraviolet",
      shortName: "UV",
      description: "Legacy compatibility fallback",
    },
  });

  let controller = null;
  let connection = null;
  let initPromise = null;

  function normalizeEngine(value) {
    const clean = String(value || "").trim().toLowerCase();
    if (clean === "uv") return "ultraviolet";
    if (clean === "sj") return "scramjet";
    return ENGINES[clean] ? clean : DEFAULT_ENGINE;
  }

  function getEngine() {
    try {
      return normalizeEngine(localStorage.getItem(STORAGE_KEY));
    } catch {
      return DEFAULT_ENGINE;
    }
  }

  async function syncEngine(engine) {
    try {
      await fetch("/api/account/preferences/proxy-technology", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyTechnology: engine }),
      });
    } catch {
      // The local choice still works if account sync is unavailable.
    }
  }

  function updateSelectors(engine) {
    document.querySelectorAll("[data-proxy-engine-select]").forEach((select) => {
      if (select.value !== engine) select.value = engine;
    });

    document.querySelectorAll("[data-proxy-engine-label]").forEach((label) => {
      label.textContent = ENGINES[engine].name;
    });
  }

  function setEngine(value, { sync = true } = {}) {
    const engine = normalizeEngine(value);

    try {
      localStorage.setItem(STORAGE_KEY, engine);
      // Remove the old Dynamic beta override so it cannot steal routing.
      localStorage.setItem("dy", "false");
      localStorage.setItem("uv", String(engine === "ultraviolet"));
    } catch {}

    updateSelectors(engine);
    window.dispatchEvent(new CustomEvent("fuzz:proxy-engine-change", {
      detail: { engine },
    }));

    if (sync) void syncEngine(engine);
    return engine;
  }

  function bindSelector(select) {
    if (!select || select.dataset.proxyEngineBound === "true") return;
    select.dataset.proxyEngineBound = "true";
    select.value = getEngine();
    select.addEventListener("change", () => setEngine(select.value));
  }

  function bindSelectors(root = document) {
    root.querySelectorAll("[data-proxy-engine-select]").forEach(bindSelector);
    updateSelectors(getEngine());
  }

  function isUrl(value = "") {
    const clean = String(value).trim();
    return (
      /^https?:\/\//i.test(clean) ||
      /^(localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/i.test(clean) ||
      /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:\/|$)/i.test(clean)
    );
  }

  function normalizeInput(value) {
    let input = String(value || "").trim();
    if (!input) return "";

    if (!isUrl(input)) {
      const searchEngine =
        localStorage.getItem("engine") ||
        "https://duckduckgo.com/?q=";
      return `${searchEngine}${encodeURIComponent(input)}`;
    }

    if (!/^https?:\/\//i.test(input)) input = `https://${input}`;
    return input;
  }

  function wispUrl() {
    return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`;
  }

  async function registerScramjetWorker() {
    if (!("serviceWorker" in navigator)) {
      throw new Error("This browser does not support service workers.");
    }

    const registration = await navigator.serviceWorker.register(
      "/scramjet-sw.js?v=1",
      { scope: "/" },
    );

    if (registration.installing) {
      await new Promise((resolve, reject) => {
        const worker = registration.installing;
        const timeout = window.setTimeout(resolve, 12000);
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") {
            window.clearTimeout(timeout);
            resolve();
          } else if (worker.state === "redundant") {
            window.clearTimeout(timeout);
            reject(new Error("Scramjet service worker installation failed."));
          }
        });
      });
    }

    return registration;
  }

  async function initScramjet() {
    if (controller && connection) return { controller, connection };
    if (initPromise) return initPromise;

    initPromise = (async () => {
      if (typeof window.$scramjetLoadController !== "function") {
        throw new Error("Scramjet client files did not load.");
      }
      if (!window.BareMux?.BareMuxConnection) {
        throw new Error("BareMux client files did not load.");
      }

      const { ScramjetController } = window.$scramjetLoadController();
      controller = new ScramjetController({
        files: {
          wasm: "/scram/scramjet.wasm.wasm",
          all: "/scram/scramjet.all.js",
          sync: "/scram/scramjet.sync.js",
        },
      });

      await controller.init();
      await registerScramjetWorker();

      connection = new window.BareMux.BareMuxConnection("/baremux/worker.js");
      const transport = await connection.getTransport();

      if (transport !== "/libcurl/index.mjs") {
        await connection.setTransport("/libcurl/index.mjs", [
          { websocket: wispUrl() },
        ]);
      }

      return { controller, connection };
    })().catch((error) => {
      controller = null;
      connection = null;
      initPromise = null;
      throw error;
    });

    return initPromise;
  }

  async function ensureUltravioletWorker() {
    if (!("serviceWorker" in navigator)) return;
    await navigator.serviceWorker.register("/sw.js?v=2025-04-15", {
      scope: "/a/",
    });
  }

  function createPlainIframe() {
    const iframe = document.createElement("iframe");
    iframe.setAttribute(
      "sandbox",
      "allow-same-origin allow-scripts allow-forms allow-pointer-lock allow-modals allow-orientation-lock allow-presentation allow-storage-access-by-user-activation allow-downloads",
    );
    iframe.setAttribute("allow", "fullscreen; autoplay; clipboard-read; clipboard-write; gamepad; microphone; camera");
    return iframe;
  }

  async function createView(container, rawUrl, requestedEngine = getEngine()) {
    const engine = normalizeEngine(requestedEngine);
    const url = normalizeInput(rawUrl);
    if (!url) throw new Error("Enter a URL or search first.");

    if (engine === "scramjet") {
      const { controller: scramjet } = await initScramjet();
      const frame = scramjet.createFrame();
      frame.frame.classList.add("fuzz-proxy-frame");
      frame.frame.dataset.proxyEngine = engine;
      container.appendChild(frame.frame);
      await frame.go(url);
      return {
        engine,
        url,
        element: frame.frame,
        frame,
        go: (nextUrl) => frame.go(normalizeInput(nextUrl)),
        destroy: () => frame.frame.remove(),
      };
    }

    await ensureUltravioletWorker();
    if (!window.__uv$config?.encodeUrl) {
      throw new Error("Ultraviolet client files did not load.");
    }

    const iframe = createPlainIframe();
    iframe.classList.add("fuzz-proxy-frame");
    iframe.dataset.proxyEngine = engine;
    iframe.src = `/a/${window.__uv$config.encodeUrl(url)}`;
    container.appendChild(iframe);

    return {
      engine,
      url,
      element: iframe,
      frame: null,
      go(nextUrl) {
        const normalized = normalizeInput(nextUrl);
        iframe.src = `/a/${window.__uv$config.encodeUrl(normalized)}`;
      },
      destroy: () => iframe.remove(),
    };
  }

  function savePending(url, engine = getEngine()) {
    sessionStorage.setItem("GoUrlRaw", normalizeInput(url));
    sessionStorage.setItem("GoProxyEngine", normalizeEngine(engine));
  }

  function openTabs(value, engine = getEngine()) {
    const url = normalizeInput(value);
    if (!url) return;
    savePending(url, engine);
    location.href = "/d";
  }

  function openStandalone(value, engine = getEngine()) {
    const url = normalizeInput(value);
    if (!url) return;
    savePending(url, engine);
    location.href = "/p";
  }

  function logNavigation(url, engine, query = "", source = "proxy-ui") {
    fetch("/api/proxy/log", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUrl: normalizeInput(url),
        query: String(query || ""),
        engine: normalizeEngine(engine),
        status: "success",
        source,
      }),
    }).catch(() => {});
  }

  window.FuzzProxy = Object.freeze({
    engines: ENGINES,
    getEngine,
    setEngine,
    bindSelectors,
    isUrl,
    normalizeInput,
    initScramjet,
    createView,
    savePending,
    openTabs,
    openStandalone,
    logNavigation,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => bindSelectors(), { once: true });
  } else {
    bindSelectors();
  }
})();
