(() => {
  "use strict";

  const SETTINGS_KEY = "fuzz_ui_settings_v1";
  const ONBOARDING_KEY = "fuzz_onboarding_complete_v1";
  const SEEN_RELEASE_KEY = "fuzz_seen_release";

  const DEFAULTS = Object.freeze({
    accent: "violet",
    density: "comfortable",
    motion: "system",
    background: "stars",
    showNewTabShortcuts: true,
    showUpdateNotices: true,
  });

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function getSettings() {
    const stored = readJson(SETTINGS_KEY, {});
    return {
      ...DEFAULTS,
      ...(stored && typeof stored === "object" ? stored : {}),
    };
  }

  function normalize(settings = {}) {
    const next = { ...getSettings(), ...settings };
    const allowedAccent = new Set(["violet", "cyan", "green", "rose", "amber"]);
    const allowedDensity = new Set(["comfortable", "compact"]);
    const allowedMotion = new Set(["system", "reduced"]);
    const allowedBackground = new Set(["stars", "quiet"]);

    return {
      accent: allowedAccent.has(next.accent) ? next.accent : DEFAULTS.accent,
      density: allowedDensity.has(next.density) ? next.density : DEFAULTS.density,
      motion: allowedMotion.has(next.motion) ? next.motion : DEFAULTS.motion,
      background: allowedBackground.has(next.background) ? next.background : DEFAULTS.background,
      showNewTabShortcuts: next.showNewTabShortcuts !== false,
      showUpdateNotices: next.showUpdateNotices !== false,
    };
  }

  function applySettings(settings = getSettings()) {
    const safe = normalize(settings);
    const root = document.documentElement;
    root.dataset.fuzzAccent = safe.accent;
    root.dataset.fuzzDensity = safe.density;
    root.dataset.fuzzMotion = safe.motion;
    root.dataset.fuzzBackground = safe.background;
    root.dataset.fuzzNewTabShortcuts = String(safe.showNewTabShortcuts);
    window.dispatchEvent(new CustomEvent("fuzz:ui-settings-applied", {
      detail: { settings: safe },
    }));
    return safe;
  }

  function saveSettings(settings) {
    const safe = normalize(settings);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(safe));
    } catch {}
    applySettings(safe);
    return safe;
  }

  function resetSettings() {
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch {}
    return applySettings(DEFAULTS);
  }

  function closeModal(node) {
    node?.remove();
  }

  function showChangelog(release) {
    const existing = document.getElementById("fuzz-changelog-modal");
    existing?.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "fuzz-changelog-modal";
    backdrop.className = "fuzz-modal-backdrop";
    const items = Array.isArray(release?.items) ? release.items : [];

    backdrop.innerHTML = `
      <section class="fuzz-modal" role="dialog" aria-modal="true" aria-labelledby="fuzz-changelog-title">
        <header class="fuzz-modal-header">
          <div>
            <h2 id="fuzz-changelog-title">Fuzz ${escapeHtml(release?.version || "Update")}</h2>
          </div>
          <button class="fuzz-modal-close" type="button" aria-label="Close">×</button>
        </header>
        <div class="fuzz-modal-body">
          <p style="margin:0 0 15px;color:#8993ad;font-size:10px;line-height:1.6">${escapeHtml(release?.summary || "The latest Fuzz improvements.")}</p>
          <ul class="fuzz-changelog-list">
            ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No release notes are available.</li>"}
          </ul>
        </div>
      </section>
    `;

    backdrop.querySelector(".fuzz-modal-close")?.addEventListener("click", () => closeModal(backdrop));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeModal(backdrop);
    });
    document.body.appendChild(backdrop);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function loadRelease() {
    const response = await fetch("/api/release", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Release information is unavailable.");
    return response.json();
  }

  async function maybeShowReleaseBanner() {
    const settings = getSettings();
    if (
      !settings.showUpdateNotices ||
      location.pathname === "/d" ||
      location.pathname === "/p" ||
      (location.pathname === "/" && !onboardingComplete())
    ) return;

    try {
      const release = await loadRelease();
      if (!release?.version) return;
      const seen = localStorage.getItem(SEEN_RELEASE_KEY);
      if (seen === release.version) return;

      const banner = document.createElement("aside");
      banner.className = "fuzz-release-banner";
      banner.innerHTML = `
        <strong>Fuzz was updated · ${escapeHtml(release.version)}</strong>
        <p>${escapeHtml(release.summary || "New improvements are ready.")}</p>
        <div class="fuzz-release-actions">
          <button type="button" data-release-details>What's new</button>
          <button type="button" data-release-dismiss>Dismiss</button>
        </div>
      `;
      banner.querySelector("[data-release-details]")?.addEventListener("click", () => showChangelog(release));
      banner.querySelector("[data-release-dismiss]")?.addEventListener("click", () => {
        localStorage.setItem(SEEN_RELEASE_KEY, release.version);
        banner.remove();
      });
      document.body.appendChild(banner);
    } catch {
      // Release notices are supplemental.
    }
  }

  function onboardingComplete() {
    try {
      return localStorage.getItem(ONBOARDING_KEY) === "true";
    } catch {
      return true;
    }
  }

  function markOnboardingComplete() {
    try {
      localStorage.setItem(ONBOARDING_KEY, "true");
    } catch {}
  }

  function resetOnboarding() {
    try {
      localStorage.removeItem(ONBOARDING_KEY);
    } catch {}
  }

  function showOnboarding({ force = false } = {}) {
    if (!force && onboardingComplete()) return;
    document.getElementById("fuzz-onboarding-modal")?.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "fuzz-onboarding-modal";
    backdrop.className = "fuzz-modal-backdrop";
    let step = 0;
    let draft = getSettings();
    let selectedProxy = window.FuzzProxy?.getEngine?.() || "scramjet";

    const steps = [
      {
        title: "Welcome to Fuzz",
        text: "Set up browsing, appearance, and shortcuts. You can change everything later from My Account.",
        body: `<div class="fuzz-onboarding-options"><button class="fuzz-onboarding-option is-selected" type="button"><strong>One connected workspace</strong><small>Browse, open Apps, use Fuzz AI, and manage your account from one place.</small></button><button class="fuzz-onboarding-option" type="button"><strong>Private account controls</strong><small>Your saved account data and preferences remain tied to your signed-in profile.</small></button></div>`,
      },
      {
        title: "Choose your default proxy",
        text: "Scramjet is recommended. Ultraviolet remains available as a compatibility fallback.",
        body: () => `<div class="fuzz-onboarding-options"><button class="fuzz-onboarding-option ${selectedProxy === "scramjet" ? "is-selected" : ""}" type="button" data-onboarding-proxy="scramjet"><strong>Scramjet</strong><small>Recommended for modern and JavaScript-heavy websites.</small></button><button class="fuzz-onboarding-option ${selectedProxy === "ultraviolet" ? "is-selected" : ""}" type="button" data-onboarding-proxy="ultraviolet"><strong>Ultraviolet</strong><small>Legacy fallback for sites that behave differently.</small></button></div>`,
      },
      {
        title: "Make Fuzz yours",
        text: "Pick an accent and spacing. These choices stay on this browser.",
        body: () => `<div class="fuzz-onboarding-options"><button class="fuzz-onboarding-option ${draft.accent === "violet" ? "is-selected" : ""}" data-onboarding-accent="violet" type="button"><strong>Violet</strong><small>Classic Fuzz appearance.</small></button><button class="fuzz-onboarding-option ${draft.accent === "cyan" ? "is-selected" : ""}" data-onboarding-accent="cyan" type="button"><strong>Cyan</strong><small>Cooler and brighter highlights.</small></button><button class="fuzz-onboarding-option ${draft.density === "comfortable" ? "is-selected" : ""}" data-onboarding-density="comfortable" type="button"><strong>Comfortable spacing</strong><small>Roomier cards and controls.</small></button><button class="fuzz-onboarding-option ${draft.density === "compact" ? "is-selected" : ""}" data-onboarding-density="compact" type="button"><strong>Compact spacing</strong><small>Fit more information on screen.</small></button></div>`,
      },
      {
        title: "You're ready",
        text: "Fuzz will remember your setup. The Status page can diagnose future proxy or account issues.",
        body: `<div class="fuzz-onboarding-options"><a class="fuzz-onboarding-option" href="/d" style="text-decoration:none"><strong>Open Tabs</strong><small>Start browsing with your selected proxy.</small></a><a class="fuzz-onboarding-option" href="/status" style="text-decoration:none"><strong>View Status</strong><small>Check server, proxy assets, and your browser.</small></a></div>`,
      },
    ];

    function render() {
      const current = steps[step];
      const body = typeof current.body === "function" ? current.body() : current.body;
      backdrop.innerHTML = `
        <section class="fuzz-modal" role="dialog" aria-modal="true" aria-labelledby="fuzz-onboarding-title">
          <div class="fuzz-modal-body fuzz-onboarding">
            <div class="fuzz-onboarding-progress">${steps.map((_, index) => `<span class="${index <= step ? "is-active" : ""}"></span>`).join("")}</div>
            <div><h3 id="fuzz-onboarding-title">${escapeHtml(current.title)}</h3><p style="margin-top:9px">${escapeHtml(current.text)}</p></div>
            ${body}
            <footer class="fuzz-onboarding-footer">
              <button type="button" data-onboarding-back ${step === 0 ? "disabled" : ""}>Back</button>
              <button class="fuzz-onboarding-primary" type="button" data-onboarding-next>${step === steps.length - 1 ? "Finish" : "Continue"}</button>
            </footer>
          </div>
        </section>
      `;

      backdrop.querySelector("[data-onboarding-back]")?.addEventListener("click", () => {
        step = Math.max(0, step - 1);
        render();
      });
      backdrop.querySelector("[data-onboarding-next]")?.addEventListener("click", () => {
        if (step === steps.length - 1) {
          window.FuzzProxy?.setEngine?.(selectedProxy);
          saveSettings(draft);
          markOnboardingComplete();
          closeModal(backdrop);
          return;
        }
        step += 1;
        render();
      });
      backdrop.querySelectorAll("[data-onboarding-proxy]").forEach((button) => {
        button.addEventListener("click", () => {
          selectedProxy = button.dataset.onboardingProxy;
          render();
        });
      });
      backdrop.querySelectorAll("[data-onboarding-accent]").forEach((button) => {
        button.addEventListener("click", () => {
          draft = { ...draft, accent: button.dataset.onboardingAccent };
          applySettings(draft);
          render();
        });
      });
      backdrop.querySelectorAll("[data-onboarding-density]").forEach((button) => {
        button.addEventListener("click", () => {
          draft = { ...draft, density: button.dataset.onboardingDensity };
          applySettings(draft);
          render();
        });
      });
    }

    document.body.appendChild(backdrop);
    render();
  }

  function bindGlobalActions() {
    document.addEventListener("click", async (event) => {
      if (event.target.closest("[data-fuzz-reset-onboarding]")) {
        resetOnboarding();
        location.href = "/";
      }

      if (event.target.closest("[data-fuzz-open-changelog]")) {
        try {
          showChangelog(await loadRelease());
        } catch {}
      }
    });
  }

  applySettings();
  window.FuzzUI = Object.freeze({
    defaults: DEFAULTS,
    getSettings,
    saveSettings,
    resetSettings,
    applySettings,
    showOnboarding,
    resetOnboarding,
    loadRelease,
    showChangelog,
  });

  const initialize = () => {
    bindGlobalActions();
    if (location.pathname === "/") {
      window.setTimeout(() => showOnboarding(), 250);
    }
    window.setTimeout(maybeShowReleaseBanner, 550);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
