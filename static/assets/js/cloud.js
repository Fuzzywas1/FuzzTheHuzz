(() => {
  "use strict";

  const state = {
    config: null,
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
    elements.direct.disabled = false;
    elements.message.textContent = "";
    elements.description.textContent =
      "Connect directly to your Windows PC through noVNC and Cloudflare.";
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

  function launch() {
    if (!state.config?.launchUrl) return;

    const icon = elements.launch.querySelector(".cloud-launch-icon i");
    const title = elements.launch.querySelector(".cloud-launch-copy strong");
    const subtitle = elements.launch.querySelector(".cloud-launch-copy small");

    elements.launch.disabled = true;
    elements.launch.classList.add("is-launching");
    icon.className = "fa-solid fa-circle-notch fa-spin";
    title.textContent = "Connecting…";
    subtitle.textContent = "Opening noVNC";

    // noVNC is hosted on its own Cloudflare hostname. Navigating directly
    // avoids cross-origin iframe restrictions and keeps its WebSocket
    // connection completely outside Fuzz's proxy/service-worker runtime.
    window.location.assign(state.config.launchUrl);
  }

  function openNewTab() {
    if (!state.config?.launchUrl) return;
    window.open(state.config.launchUrl, "_blank", "noopener,noreferrer");
  }

  document.addEventListener("DOMContentLoaded", () => {
    elements.name = document.getElementById("cloud-device-name");
    elements.status = document.getElementById("cloud-status");
    elements.description = document.getElementById("cloud-description");
    elements.launch = document.getElementById("cloud-launch");
    elements.direct = document.getElementById("cloud-direct");
    elements.message = document.getElementById("cloud-message");

    elements.launch.addEventListener("click", launch);
    elements.direct.addEventListener("click", openNewTab);

    // If the page is restored from browser back/forward cache, make sure
    // the Connect button never comes back stuck on "Connecting…".
    addEventListener("pageshow", () => {
      if (state.config) resetLaunchButton();
    });

    void load();
  });
})();
