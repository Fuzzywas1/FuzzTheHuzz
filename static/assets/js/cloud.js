(() => {
  "use strict";

  const state = {
    config: null,
    view: null,
    activeTab: "overview",
    launching: false,
  };

  const elements = {};

  async function request(path) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Fuzz Cloud could not be loaded.");
    }
    return payload;
  }

  function setStatus(name, message) {
    elements.status.dataset.state = name;
    elements.status.querySelector("span:last-child").textContent = message;
  }

  function setTab(tab) {
    state.activeTab = tab;

    elements.tabs.forEach((button) => {
      const active = button.dataset.cloudTab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });

    elements.panels.forEach((panel) => {
      const active = panel.dataset.cloudPanel === tab;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });

    if (tab === "desktop") {
      window.setTimeout(() => elements.desktopHost?.focus(), 0);
    }
  }

  function showError(message) {
    state.config = null;
    elements.launch.disabled = true;
    elements.direct.disabled = true;
    elements.message.textContent = message;
    elements.description.textContent =
      "Open Fuzz Control and verify that Fuzz Cloud is enabled and the Guacamole URL is saved.";
    setStatus("error", "Unavailable");
  }

  function renderReady(config) {
    state.config = config;
    elements.name.textContent = config.name || "Gaming PC";
    elements.desktopTitle.textContent = config.name || "Gaming PC";
    elements.launch.disabled = false;
    elements.direct.disabled = false;
    elements.message.textContent = "";
    elements.description.textContent =
      "Opens Apache Guacamole inside the Fuzz Cloud Desktop tab while keeping your sidebar available.";
    setStatus("ready", "Gateway ready");
  }

  async function load() {
    try {
      renderReady(await request("/api/cloud/config"));
    } catch (error) {
      showError(error.message);
    }
  }

  function resetLaunchButton() {
    state.launching = false;
    elements.launch.disabled = !state.config;
    elements.launch.classList.remove("is-launching");
    elements.launch.querySelector(".cloud-launch-icon i").className =
      "fa-solid fa-play";
    elements.launch.querySelector(".cloud-launch-copy strong").textContent =
      "Launch Desktop";
    elements.launch.querySelector(".cloud-launch-copy small").textContent =
      "Open your Windows session";
  }

  async function openDesktop({ reload = false } = {}) {
    if (!state.config?.launchUrl || state.launching) return;

    state.launching = true;
    elements.launch.disabled = true;
    elements.launch.classList.add("is-launching");
    elements.launch.querySelector(".cloud-launch-icon i").className =
      "fa-solid fa-circle-notch";
    elements.launch.querySelector(".cloud-launch-copy strong").textContent =
      "Opening desktop…";
    elements.launch.querySelector(".cloud-launch-copy small").textContent =
      "Loading inside Fuzz Cloud";

    setTab("desktop");
    elements.desktopState.hidden = false;
    elements.desktopState.dataset.state = "loading";
    elements.desktopState.innerHTML =
      '<span class="cloud-desktop-spinner"></span><strong>Connecting to your desktop…</strong><small>Guacamole is opening through Fuzz Proxy.</small>';

    try {
      if (reload) state.view?.destroy?.();
      if (!state.view || reload) {
        elements.desktopHost.querySelectorAll(".fuzz-proxy-frame").forEach((frame) => frame.remove());
        state.view = await window.FuzzProxy.createView(
          elements.desktopHost,
          state.config.launchUrl,
          window.FuzzProxy.getEngine(),
        );
        window.FuzzProxy.logNavigation(
          state.config.launchUrl,
          state.view.engine,
          "",
          "fuzz-cloud",
        );
      }

      elements.desktopState.hidden = true;
      elements.desktopHost.classList.add("has-desktop");
      elements.desktopEngine.textContent =
        window.FuzzProxy.engines[state.view.engine]?.name || state.view.engine;
    } catch (error) {
      elements.desktopState.hidden = false;
      elements.desktopState.dataset.state = "error";
      elements.desktopState.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i><strong>Desktop could not open</strong><small>${String(error.message || error)}</small><button id="cloud-retry" type="button">Try again</button>`;
      document.getElementById("cloud-retry")?.addEventListener("click", () => {
        state.launching = false;
        void openDesktop({ reload: true });
      });
    } finally {
      resetLaunchButton();
    }
  }

  function openDirect() {
    if (!state.config?.launchUrl) return;
    window.open(state.config.launchUrl, "_blank", "noopener,noreferrer");
  }

  function toggleExpanded() {
    const expanded = document.body.classList.toggle("cloud-workspace-expanded");
    const icon = elements.expand.querySelector("i");
    icon.className = expanded
      ? "fa-solid fa-down-left-and-up-right-to-center"
      : "fa-solid fa-up-right-and-down-left-from-center";
    elements.expand.title = expanded
      ? "Restore desktop size"
      : "Expand desktop workspace";
  }

  document.addEventListener("DOMContentLoaded", () => {
    elements.name = document.getElementById("cloud-device-name");
    elements.status = document.getElementById("cloud-status");
    elements.description = document.getElementById("cloud-description");
    elements.launch = document.getElementById("cloud-launch");
    elements.direct = document.getElementById("cloud-direct");
    elements.message = document.getElementById("cloud-message");
    elements.tabs = [...document.querySelectorAll("[data-cloud-tab]")];
    elements.panels = [...document.querySelectorAll("[data-cloud-panel]")];
    elements.desktopHost = document.getElementById("cloud-desktop-host");
    elements.desktopState = document.getElementById("cloud-desktop-state");
    elements.desktopTitle = document.getElementById("cloud-desktop-title");
    elements.desktopEngine = document.getElementById("cloud-desktop-engine");
    elements.reload = document.getElementById("cloud-desktop-reload");
    elements.expand = document.getElementById("cloud-desktop-expand");

    elements.tabs.forEach((button) => {
      button.addEventListener("click", () => setTab(button.dataset.cloudTab));
    });

    elements.launch.addEventListener("click", () => void openDesktop());
    elements.direct.addEventListener("click", openDirect);
    elements.reload.addEventListener("click", () => void openDesktop({ reload: true }));
    elements.expand.addEventListener("click", toggleExpanded);

    setTab("overview");
    load();
  });
})();
