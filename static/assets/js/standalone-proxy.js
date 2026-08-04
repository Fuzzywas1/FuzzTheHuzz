(() => {
  "use strict";
  const host = document.getElementById("proxy-frame-host");
  const form = document.getElementById("proxy-address-form");
  const input = document.getElementById("proxy-address");
  const select = document.getElementById("proxy-engine-select");
  let view = null;
  let currentUrl = sessionStorage.getItem("GoUrlRaw") || "";
  let currentEngine = sessionStorage.getItem("GoProxyEngine") || window.FuzzProxy.getEngine();
  const startFocused = sessionStorage.getItem("GoProxyFocus") === "1";
  sessionStorage.removeItem("GoUrlRaw");
  sessionStorage.removeItem("GoProxyEngine");
  sessionStorage.removeItem("GoProxyFocus");

  function setFocusMode(enabled) {
    document.body.classList.toggle("proxy-focus", enabled);
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      // Browser or device policy may block full-screen mode.
    }
  }

  function reload() {
    try { view?.element?.contentWindow?.location.reload(); }
    catch { if (currentUrl) void open(currentUrl, currentEngine); }
  }

  async function open(url, engine = currentEngine) {
    currentUrl = window.FuzzProxy.normalizeInput(url);
    currentEngine = engine;
    input.value = currentUrl;
    select.value = engine;
    view?.destroy?.();
    host.innerHTML = '<div class="proxy-loading"><span></span><strong>Opening Fuzz Cloud…</strong></div>';
    try {
      host.innerHTML = "";
      view = await window.FuzzProxy.createView(host, currentUrl, currentEngine);
      window.FuzzProxy.logNavigation(currentUrl, currentEngine, "", "standalone-proxy");
    } catch (error) {
      host.innerHTML = `<section class="proxy-error"><i class="fa-solid fa-triangle-exclamation"></i><h1>Page could not open</h1><p>${String(error.message || error)}</p>${currentEngine === "scramjet" ? '<button id="retry-uv" type="button">Retry with Ultraviolet</button>' : ""}</section>`;
      document.getElementById("retry-uv")?.addEventListener("click", () => {
        window.FuzzProxy.setEngine("ultraviolet");
        void open(currentUrl, "ultraviolet");
      });
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void open(input.value, window.FuzzProxy.getEngine());
  });
  select.addEventListener("change", () => {
    const engine = window.FuzzProxy.setEngine(select.value);
    if (currentUrl) void open(currentUrl, engine);
  });
  document.getElementById("proxy-back-home").addEventListener("click", () => { location.href = "/"; });
  document.getElementById("proxy-reload").addEventListener("click", reload);
  document.getElementById("proxy-fullscreen").addEventListener("click", toggleFullscreen);
  document.getElementById("proxy-focus-home").addEventListener("click", () => { location.href = "/cloud"; });
  document.getElementById("proxy-focus-reload").addEventListener("click", reload);
  document.getElementById("proxy-focus-fullscreen").addEventListener("click", toggleFullscreen);
  document.getElementById("proxy-exit-focus").addEventListener("click", () => setFocusMode(false));

  document.addEventListener("fullscreenchange", () => {
    const icon = document.fullscreenElement ? "fa-solid fa-compress" : "fa-solid fa-expand";
    document.querySelectorAll("#proxy-fullscreen i,#proxy-focus-fullscreen i").forEach((node) => { node.className = icon; });
  });

  setFocusMode(startFocused);
  if (currentUrl) void open(currentUrl, currentEngine);
  else location.replace("/");
})();
