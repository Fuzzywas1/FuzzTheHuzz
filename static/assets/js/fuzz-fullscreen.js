(() => {
  "use strict";

  const BODY_CLASS = "fullscreen-browser";
  const EXIT_ID = "fuzz-fullscreen-exit";
  const EVENT_NAME = "fuzz:fullscreenchange";

  let exitButton = null;
  let hideTimer = null;
  let keyboardLocked = false;
  let cssOnly = false;

  function isNativeFullscreen() {
    return Boolean(document.fullscreenElement);
  }

  function isActive() {
    return isNativeFullscreen() ||
      document.body.classList.contains(BODY_CLASS);
  }

  function emit() {
    window.dispatchEvent(
      new CustomEvent(EVENT_NAME, {
        detail: {
          active: isActive(),
          native: isNativeFullscreen(),
          keyboardLocked,
        },
      }),
    );
  }

  function ensureExitButton() {
    if (exitButton?.isConnected) return exitButton;

    exitButton = document.createElement("button");
    exitButton.id = EXIT_ID;
    exitButton.type = "button";
    exitButton.className = "fuzz-fullscreen-exit";
    exitButton.innerHTML =
      '<i class="fa-solid fa-compress" aria-hidden="true"></i>' +
      '<span>Exit fullscreen</span>';
    exitButton.title = "Exit fullscreen";
    exitButton.setAttribute("aria-label", "Exit fullscreen");

    exitButton.addEventListener("click", () => {
      void exit();
    });

    document.body.appendChild(exitButton);
    return exitButton;
  }

  function showExitControl() {
    if (!isActive()) return;

    const button = ensureExitButton();
    button.classList.add("is-visible");

    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      button.classList.remove("is-visible");
    }, 2200);
  }

  function setCssState(enabled) {
    document.body.classList.toggle(BODY_CLASS, enabled);

    if (enabled) {
      ensureExitButton();
      showExitControl();
    } else if (exitButton) {
      exitButton.classList.remove("is-visible");
    }
  }

  async function lockEscape() {
    keyboardLocked = false;

    if (!document.fullscreenElement) return false;

    // Newer Chromium can request browser-key forwarding as part of the
    // Fullscreen API. navigator.keyboard.lock() is retained as a second
    // attempt for Chromium versions that implement the older API shape.
    if (!navigator.keyboard?.lock) return false;

    try {
      await navigator.keyboard.lock(["Escape"]);
      keyboardLocked = true;
      return true;
    } catch {
      return false;
    }
  }

  function unlockKeyboard() {
    if (navigator.keyboard?.unlock) {
      try {
        navigator.keyboard.unlock();
      } catch {}
    }

    keyboardLocked = false;
  }

  async function requestNativeFullscreen() {
    const root = document.documentElement;

    if (!root.requestFullscreen) {
      return false;
    }

    // Chromium's current API can request forwarding of browser-reserved
    // keyboard keys while entering fullscreen. Unknown dictionary members
    // are ignored by browsers that do not implement keyboardLock yet.
    try {
      await root.requestFullscreen({
        navigationUI: "hide",
        keyboardLock: "browser",
      });
    } catch (firstError) {
      try {
        await root.requestFullscreen({
          navigationUI: "hide",
        });
      } catch {
        throw firstError;
      }
    }

    return Boolean(document.fullscreenElement);
  }

  async function enter(options = {}) {
    if (isActive()) return true;

    cssOnly = options.native === false;
    setCssState(true);

    if (cssOnly) {
      emit();
      return true;
    }

    try {
      const entered = await requestNativeFullscreen();

      if (entered) {
        await lockEscape();
      }
    } catch {
      // Keep the CSS immersive mode as a safe fallback if the browser blocks
      // the Fullscreen API or the request was not made during user activation.
      cssOnly = true;
    }

    setCssState(true);
    emit();
    return true;
  }

  async function exit() {
    unlockKeyboard();
    cssOnly = false;

    if (document.fullscreenElement && document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch {}
    }

    setCssState(false);
    emit();
  }

  async function toggle() {
    if (isActive()) {
      await exit();
    } else {
      await enter();
    }
  }

  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement) {
      cssOnly = false;
      setCssState(true);

      // This also catches fullscreen entered by content inside the active
      // proxy frame (for example a streaming service's own fullscreen button).
      void lockEscape().finally(emit);
    } else if (!cssOnly) {
      unlockKeyboard();
      setCssState(false);
      emit();
    }
  });

  document.addEventListener("fullscreenerror", () => {
    // A failed native request should never strand the interface. The caller
    // remains in the CSS immersive fallback and still has an exit control.
    emit();
  });

  // Plain Escape is deliberately NOT an exit shortcut for Novaris. In a
  // fullscreen game/remote app it belongs to the content. Shift+Escape is
  // Novaris's explicit keyboard escape hatch.
  document.addEventListener(
    "keydown",
    (event) => {
      if (!isActive()) return;

      if (event.key === "Escape" && event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void exit();
        return;
      }

      if (event.key === "Escape" && document.fullscreenElement) {
        // When Keyboard Lock is active this prevents Chromium's normal
        // fullscreen-exit action without stopping propagation to the app.
        event.preventDefault();
        return;
      }

      if (event.key === "F11") {
        event.preventDefault();
        void toggle();
      }
    },
    true,
  );

  for (const name of ["pointermove", "mousemove", "touchstart"]) {
    document.addEventListener(name, showExitControl, {
      passive: true,
      capture: true,
    });
  }

  window.FuzzFullscreen = Object.freeze({
    enter,
    exit,
    toggle,
    isActive,
    isNativeFullscreen,
    showExitControl,
  });
})();
