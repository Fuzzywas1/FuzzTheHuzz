(() => {
  "use strict";

  const state = {
    config: null,
    launching: false,
    expanded: false,
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

  function resetLaunchButton() {
    state.launching = false;
    elements.launch.disabled = !state.config;
    elements.launch.classList.remove("is-launching");

    const icon = elements.launch.querySelector(".cloud-launch-icon i");
    const title = elements.launch.querySelector(".cloud-launch-copy strong");
    const subtitle = elements.launch.querySelector(".cloud-launch-copy small");

    icon.className = "fa-solid fa-display";
    title.textContent = "Connect to PC";
    subtitle.textContent = "Open your Windows desktop";
  }

  function showError(message) {
    state.config = null;
    resetLaunchButton();
    elements.launch.disabled = true;
    elements.direct.disabled = true;
    elements.message.textContent = message;
    elements.description.textContent =
      "Open Fuzz Control and verify the noVNC address in Fuzz Cloud settings.";
    setStatus("error", "Unavailable");
  }

  function renderReady(config) {
    if (!config?.launchUrl) {
      showError("Fuzz Cloud does not have a valid noVNC launch URL.");
      return;
    }

    state.config = config;
    elements.name.textContent = config.name || "Gaming PC";
    elements.desktopTitle.textContent = config.name || "Gaming PC";
    elements.direct.disabled = false;
    elements.message.textContent = "";
    elements.description.textContent =
      "Connect straight to your Windows PC with noVNC. No Guacamole login screen or extra proxy layer.";
    setStatus("ready", "Ready to connect");
    resetLaunchButton();
  }

  async function load() {
    try {
      renderReady(await request("/api/cloud/config"));
    } catch (error) {
      showError(error.message);
    }
  }

  function openDirect() {
    if (!state.config?.launchUrl) return;
    window.open(state.config.launchUrl, "_blank", "noopener,noreferrer");
  }

  function showWorkspace() {
    if (!state.config?.launchUrl) return;

    elements.workspace.hidden = false;
    elements.desktopState.hidden = false;
    elements.frame.hidden = true;
    elements.frame.src = state.config.launchUrl;
    elements.workspace.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function launch() {
    if (state.launching || !state.config) return;

    state.launching = true;
    elements.launch.disabled = true;
    elements.launch.classList.add("is-launching");

    const icon = elements.launch.querySelector(".cloud-launch-icon i");
    const title = elements.launch.querySelector(".cloud-launch-copy strong");
    const subtitle = elements.launch.querySelector(".cloud-launch-copy small");

    icon.className = "fa-solid fa-circle-notch fa-spin";
    title.textContent = "Opening desktop…";
    subtitle.textContent = state.config.embedded === false
      ? "Opening noVNC"
      : "Starting remote workspace";

    if (state.config.embedded === false) {
      window.setTimeout(() => {
        openDirect();
        resetLaunchButton();
      }, 180);
      return;
    }

    window.setTimeout(() => {
      showWorkspace();
      resetLaunchButton();
    }, 180);
  }

  function reloadDesktop() {
    if (!state.config?.launchUrl) return;
    elements.desktopState.hidden = false;
    elements.frame.hidden = true;
    elements.frame.src = "about:blank";
    requestAnimationFrame(() => {
      elements.frame.src = state.config.launchUrl;
    });
  }

  function setExpanded(enabled) {
    state.expanded = Boolean(enabled);
    document.body.classList.toggle("cloud-workspace-expanded", state.expanded);
    const icon = elements.expand.querySelector("i");
    icon.className = state.expanded
      ? "fa-solid fa-down-left-and-up-right-to-center"
      : "fa-solid fa-up-right-and-down-left-from-center";
    elements.expand.title = state.expanded
      ? "Restore desktop workspace"
      : "Expand desktop workspace";
  }

  function closeWorkspace() {
    setExpanded(false);
    elements.frame.src = "about:blank";
    elements.frame.hidden = true;
    elements.desktopState.hidden = false;
    elements.workspace.hidden = true;
    elements.launch.focus();
  }

  document.addEventListener("DOMContentLoaded", () => {
    elements.name = document.getElementById("cloud-device-name");
    elements.status = document.getElementById("cloud-status");
    elements.description = document.getElementById("cloud-description");
    elements.launch = document.getElementById("cloud-launch");
    elements.direct = document.getElementById("cloud-direct");
    elements.message = document.getElementById("cloud-message");
    elements.workspace = document.getElementById("cloud-workspace");
    elements.desktopTitle = document.getElementById("cloud-desktop-title");
    elements.desktopState = document.getElementById("cloud-desktop-state");
    elements.frame = document.getElementById("cloud-desktop-frame");
    elements.reload = document.getElementById("cloud-desktop-reload");
    elements.expand = document.getElementById("cloud-desktop-expand");
    elements.close = document.getElementById("cloud-desktop-close");

    elements.launch.addEventListener("click", launch);
    elements.direct.addEventListener("click", openDirect);
    elements.reload.addEventListener("click", reloadDesktop);
    elements.expand.addEventListener("click", () => setExpanded(!state.expanded));
    elements.close.addEventListener("click", closeWorkspace);

    elements.frame.addEventListener("load", () => {
      if (!elements.frame.src || elements.frame.src === "about:blank") return;
      elements.desktopState.hidden = true;
      elements.frame.hidden = false;
      setStatus("ready", "Desktop viewer loaded");
    });

    addEventListener("pageshow", () => {
      if (state.config) resetLaunchButton();
    });

    void load();
  });
})();
