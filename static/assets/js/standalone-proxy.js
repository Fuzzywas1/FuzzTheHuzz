(() => {
  "use strict";

  const host = document.getElementById("proxy-frame-host");
  const form = document.getElementById("proxy-address-form");
  const input = document.getElementById("proxy-address");
  const select = document.getElementById("proxy-engine-select");
  const fullscreenButton = document.getElementById("proxy-fullscreen");

  let view = null;
  const localGameUrl = sessionStorage.getItem("GoLocalGame") || "";
  const localGameTitle = sessionStorage.getItem("GoLocalGameTitle") || "Game";
  const requestedReturnPath =
    sessionStorage.getItem("GoProxyReturnPath") || "/";
  const returnPath =
    /^\/(?!\/)/.test(requestedReturnPath)
      ? requestedReturnPath
      : "/";
  const localMode = Boolean(localGameUrl);
  let currentUrl = sessionStorage.getItem("GoUrlRaw") || "";
  let currentEngine =
    sessionStorage.getItem("GoProxyEngine") ||
    window.FuzzProxy.getEngine();

  const startFullscreen =
    sessionStorage.getItem("GoProxyFullscreen") === "1";

  sessionStorage.removeItem("GoUrlRaw");
  sessionStorage.removeItem("GoProxyEngine");
  sessionStorage.removeItem("GoProxyFullscreen");
  sessionStorage.removeItem("GoLocalGame");
  sessionStorage.removeItem("GoLocalGameTitle");
  sessionStorage.removeItem("GoProxyReturnPath");

  function syncFullscreenButton(enabled = window.FuzzFullscreen?.isActive?.()) {
    const active = Boolean(enabled);

    const icon = fullscreenButton?.querySelector("i");
    if (icon) {
      icon.className = active
        ? "fa-solid fa-compress"
        : "fa-solid fa-expand";
    }

    if (fullscreenButton) {
      fullscreenButton.title = active
        ? "Exit game fullscreen"
        : "Game fullscreen";
      fullscreenButton.setAttribute(
        "aria-label",
        active ? "Exit game fullscreen" : "Game fullscreen",
      );
    }
  }

  function toggleFullscreen() {
    if (!window.FuzzFullscreen) {
      document.body.classList.toggle("fullscreen-browser");
      syncFullscreenButton();
      return;
    }

    void window.FuzzFullscreen.toggle();
  }

  function reload() {
    if (localMode) {
      const frame = view?.element;

      if (frame) {
        // Reassigning the local URL is reliable even if a game changed the
        // iframe's internal history or contentWindow access is restricted.
        frame.src = localGameUrl;
      }

      return;
    }

    try {
      view?.element?.contentWindow?.location.reload();
    } catch {
      if (currentUrl) void open(currentUrl, currentEngine);
    }
  }


  function openLocalGame(url, title = "Game") {
    currentUrl = url;
    input.value = title;
    input.readOnly = true;
    select.disabled = true;
    host.innerHTML = "";

    const frame = document.createElement("iframe");
    frame.className = "proxy-frame local-game-frame";
    frame.src = url;
    frame.title = title;
    frame.allow =
      "autoplay; fullscreen; gamepad; clipboard-read; clipboard-write";
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute(
      "sandbox",
      "allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-pointer-lock allow-downloads allow-presentation allow-orientation-lock allow-storage-access-by-user-activation",
    );

    host.appendChild(frame);

    view = {
      element: frame,
      destroy() {
        frame.remove();
      },
    };
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

  const backButton = document.getElementById("proxy-back-home");

  if (returnPath === "/a") {
    backButton.title = "Back to Games";
    backButton.setAttribute("aria-label", "Back to Games");
  }

  backButton.addEventListener("click", () => {
    location.href = returnPath;
  });

  document
    .getElementById("proxy-reload")
    .addEventListener("click", reload);

  fullscreenButton?.addEventListener("click", toggleFullscreen);

  window.addEventListener("fuzz:fullscreenchange", (event) => {
    syncFullscreenButton(event.detail?.active);
  });

  syncFullscreenButton();

  // A page cannot enter native fullscreen automatically without a user
  // gesture. Preserve the old popout behavior as CSS immersive mode until
  // the user presses the fullscreen button.
  if (startFullscreen) {
    if (window.FuzzFullscreen) {
      void window.FuzzFullscreen.enter({ native: false });
    } else {
      document.body.classList.add("fullscreen-browser");
      syncFullscreenButton(true);
    }
  }

  if (localGameUrl) openLocalGame(localGameUrl, localGameTitle);
  else if (currentUrl) void open(currentUrl, currentEngine);
  else location.replace("/");
})();
