(() => {
  "use strict";

  const GUACAMOLE_URL =
    "https://guac.fuzzthehuzz-ebsfiygfhsvfbfesg.com/";

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
      throw new Error(payload.error || "Fuzz Cloud could not be loaded.");
    }

    return payload;
  }

  function setStatus(name, message) {
    elements.status.dataset.state = name;
    elements.status.querySelector("span:last-child").textContent = message;
  }

  function showError(message) {
    state.config = null;
    elements.launch.disabled = true;
    elements.direct.disabled = true;
    elements.message.textContent = message;
    elements.description.textContent =
      "Open Fuzz Control and verify that Fuzz Cloud is enabled.";
    setStatus("error", "Unavailable");
  }

  function renderReady(config) {
    state.config = config;
    elements.name.textContent = config.name || "Gaming PC";
    elements.launch.disabled = false;
    elements.direct.disabled = false;
    elements.message.textContent = "";
    elements.description.textContent =
      "Launch your Apache Guacamole desktop from Fuzz Cloud.";
    setStatus("ready", "Gateway ready");
  }

  async function load() {
    try {
      renderReady(await request("/api/cloud/config"));
    } catch (error) {
      showError(error.message);
    }
  }

  function launch() {
    if (state.launching || !state.config) return;

    state.launching = true;
    elements.launch.disabled = true;
    elements.launch.classList.add("is-launching");

    const icon = elements.launch.querySelector(".cloud-launch-icon i");
    const title = elements.launch.querySelector(".cloud-launch-copy strong");
    const subtitle = elements.launch.querySelector(".cloud-launch-copy small");

    icon.className = "fa-solid fa-circle-notch";
    title.textContent = "Opening desktop…";
    subtitle.textContent = "Connecting to Guacamole";

    window.setTimeout(() => {
      window.location.assign(GUACAMOLE_URL);
    }, 300);
  }

  document.addEventListener("DOMContentLoaded", () => {
    elements.name = document.getElementById("cloud-device-name");
    elements.status = document.getElementById("cloud-status");
    elements.description = document.getElementById("cloud-description");
    elements.launch = document.getElementById("cloud-launch");
    elements.direct = document.getElementById("cloud-direct");
    elements.message = document.getElementById("cloud-message");

    document.querySelectorAll('[data-cloud-tab="desktop"]').forEach((button) => {
      button.addEventListener("click", () => {
        if (state.config) window.location.assign(GUACAMOLE_URL);
      });
    });

    elements.launch.addEventListener("click", launch);
    elements.direct.addEventListener("click", () => {
      if (state.config) window.location.assign(GUACAMOLE_URL);
    });

    load();
  });
})();
