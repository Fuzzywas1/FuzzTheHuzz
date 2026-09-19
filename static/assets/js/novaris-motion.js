(() => {
  "use strict";

  const state = { screen: null, timer: null };

  function ensureScreen() {
    if (state.screen?.isConnected) return state.screen;

    const screen = document.createElement("div");
    screen.className = "novaris-loading-screen";
    screen.setAttribute("aria-hidden", "true");
    screen.innerHTML = `
      <div class="novaris-loading-card" role="status" aria-live="polite">
        <img class="novaris-loading-logo" src="/assets/media/brand/novaris-mark.svg" alt="" aria-hidden="true" />
        <span class="novaris-loading-game-ring" aria-hidden="true"></span>
        <h2 class="novaris-loading-title">Loading Novaris</h2>
        <p class="novaris-loading-message">Please wait…</p>
        <div class="novaris-loading-bars" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span>
        </div>
      </div>
    `;
    document.body.appendChild(screen);
    state.screen = screen;
    return screen;
  }

  function show(title = "Loading Novaris", message = "Please wait…", kind = "page") {
    const screen = ensureScreen();
    clearTimeout(state.timer);
    screen.dataset.loadingKind = kind;
    screen.querySelector(".novaris-loading-title").textContent = title;
    screen.querySelector(".novaris-loading-message").textContent = message;
    screen.classList.add("is-visible");
    screen.setAttribute("aria-hidden", "false");
  }

  function hide() {
    const screen = state.screen;
    if (!screen) return;
    screen.classList.remove("is-visible");
    screen.setAttribute("aria-hidden", "true");
    clearTimeout(state.timer);
  }

  function showForNavigation(title, message) {
    show(title, message, "page");
  }

  function bindInternalLinks() {
    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (!link) return;
      if (event.defaultPrevented) return;
      if (link.target === "_blank" || link.hasAttribute("download")) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (link.dataset.noLoading === "true") return;

      let url;
      try { url = new URL(link.href, location.href); } catch { return; }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search && !url.hash) return;

      showForNavigation("Opening", link.getAttribute("aria-label") || link.textContent.trim() || "Opening page…");
    });
  }

  function init() {
    document.body.classList.add("novaris-motion-ready");
    bindInternalLinks();

    // Brief initial transition. It never blocks interaction.
    requestAnimationFrame(() => {
      window.setTimeout(hide, 220);
    });

    window.NovarisMotion = Object.freeze({
      show,
      hide,
      showForNavigation,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
