(() => {
  "use strict";

  const state = {
    config: null,
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
      const error = new Error(payload.error || "Fuzz Cloud could not be loaded.");
      error.status = response.status;
      throw error;
    }

    return payload;
  }

  function setStatus(stateName, message) {
    elements.status.dataset.state = stateName;
    elements.status.querySelector("span:last-child").textContent = message;
  }

  function showError(message) {
    state.config = null;
    elements.launch.disabled = true;
    elements.message.textContent = message;
    elements.description.textContent =
      "Open Fuzz Control to verify that Cloud is enabled and the MeshCentral server URL and node ID are saved.";
    setStatus("error", "Unavailable");
  }

  function renderReady(config) {
    state.config = config;
    elements.name.textContent = config.name || "Gaming PC";
    elements.launch.disabled = false;
    elements.message.textContent = "";
    elements.description.textContent = config.interfaceHidden
      ? "Launches directly into the remote desktop page with MeshCentral navigation hidden."
      : "Launches directly into your computer's remote desktop page.";
    setStatus("ready", "Ready to connect");
  }

  async function load() {
    try {
      const config = await request("/api/cloud/config");
      renderReady(config);
    } catch (error) {
      showError(error.message);
    }
  }

  function launch() {
    if (state.launching || !state.config?.launchUrl) return;

    state.launching = true;
    elements.launch.disabled = true;
    elements.launch.classList.add("is-launching");
    elements.launch.querySelector(".cloud-launch-icon i").className =
      "fa-solid fa-circle-notch";
    elements.launch.querySelector(".cloud-launch-copy strong").textContent =
      "Opening in Fuzz…";
    elements.launch.querySelector(".cloud-launch-copy small").textContent =
      "Loading the desktop through Fuzz Proxy";
    elements.message.textContent = "";

    window.setTimeout(() => {
      try {
        sessionStorage.setItem("GoUrlRaw", state.config.launchUrl);
        sessionStorage.setItem(
          "GoProxyEngine",
          window.FuzzProxy?.getEngine?.() || "scramjet",
        );
        window.location.assign("/proxy");
      } catch {
        window.location.assign(state.config.launchUrl);
      }
    }, 520);
  }

  document.addEventListener("DOMContentLoaded", () => {
    elements.name = document.getElementById("cloud-device-name");
    elements.status = document.getElementById("cloud-status");
    elements.description = document.getElementById("cloud-description");
    elements.launch = document.getElementById("cloud-launch");
    elements.message = document.getElementById("cloud-message");

    elements.launch.addEventListener("click", launch);
    load();
  });
})();
