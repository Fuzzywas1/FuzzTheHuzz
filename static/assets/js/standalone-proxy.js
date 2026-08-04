(() => {
  "use strict";

  const host = document.getElementById("proxy-frame-host");
  const form = document.getElementById("proxy-address-form");
  const input = document.getElementById("proxy-address");
  const select = document.getElementById("proxy-engine-select");
  const fullscreenButton = document.getElementById("proxy-fullscreen");

  let view = null;
  let currentUrl = sessionStorage.getItem("GoUrlRaw") || "";
  let currentEngine =
    sessionStorage.getItem("GoProxyEngine") ||
    window.FuzzProxy.getEngine();

  const startFullscreen =
    sessionStorage.getItem("GoProxyFullscreen") === "1";

  sessionStorage.removeItem("GoUrlRaw");
  sessionStorage.removeItem("GoProxyEngine");
  sessionStorage.removeItem("GoProxyFullscreen");

  function setFullscreen(enabled) {
    document.body.classList.toggle("fullscreen-browser", enabled);

    const icon = fullscreenButton?.querySelector("i");
    if (icon) {
      icon.className = enabled
        ? "fa-solid fa-compress"
        : "fa-solid fa-expand";
    }

    if (fullscreenButton) {
      fullscreenButton.title = enabled
        ? "Exit fullscreen browser"
        : "Fullscreen browser";
    }
  }

  function toggleFullscreen() {
    setFullscreen(
      !document.body.classList.contains("fullscreen-browser"),
    );
  }

  function reload() {
    try {
      view?.element?.contentWindow?.location.reload();
    } catch {
      if (currentUrl) void open(currentUrl, currentEngine);
    }
  }

  async function open(url, engine = currentEngine) {
    currentUrl = window.FuzzProxy.normalizeInput(url);
    currentEngine = engine;
    input.value = currentUrl;
    select.value = engine;
    view?.destroy?.();

    host.innerHTML =
      '<div class="proxy-loading"><span></span><strong>Opening page…</strong></div>';

    try {
      host.innerHTML = "";
      view = await window.FuzzProxy.createView(
        host,
        currentUrl,
        currentEngine,
      );
      window.FuzzProxy.logNavigation(
        currentUrl,
        currentEngine,
        "",
        "standalone-proxy",
      );
    } catch (error) {
      host.innerHTML = `<section class="proxy-error"><i class="fa-solid fa-triangle-exclamation"></i><h1>Page could not open</h1><p>${String(error.message || error)}</p>${currentEngine === "scramjet" ? '<button id="retry-uv" type="button">Retry with Ultraviolet</button>' : ""}</section>`;

      document
        .getElementById("retry-uv")
        ?.addEventListener("click", () => {
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

  document
    .getElementById("proxy-back-home")
    .addEventListener("click", () => {
      location.href = "/";
    });

  document
    .getElementById("proxy-reload")
    .addEventListener("click", reload);

  fullscreenButton?.addEventListener("click", toggleFullscreen);

  document.addEventListener("keydown", (event) => {
    if (event.key === "F11") {
      event.preventDefault();
      toggleFullscreen();
    } else if (
      event.key === "Escape" &&
      document.body.classList.contains("fullscreen-browser")
    ) {
      setFullscreen(false);
    }
  });

  setFullscreen(startFullscreen);

  if (currentUrl) void open(currentUrl, currentEngine);
  else location.replace("/");
})();
