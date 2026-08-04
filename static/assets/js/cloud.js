(() => {
  "use strict";

  const CLOUD_URL =
    "https://cloud.fuzzthehuzz-ebsfiygfhsvfbfesg.com/";

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
      "Open Fuzz Control and verify that Fuzz Cloud is enabled.";
    setStatus("error", "Unavailable");
  }

  function renderReady(config) {
    state.config = config;
    elements.name.textContent = config.name || "Gaming PC";
    elements.launch.disabled = false;
    elements.message.textContent = "";
    elements.description.textContent =
      "Opens the secure Fuzz Cloud portal through your selected Fuzz proxy engine.";
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

  function openThroughProxy(url) {
    const engine = window.FuzzProxy?.getEngine?.() || "scramjet";

    if (typeof window.FuzzProxy?.openStandalone === "function") {
      window.FuzzProxy.openStandalone(url, engine);
      return;
    }

    // Compatibility fallback. The actual standalone proxy route is /p.
    sessionStorage.setItem("GoUrlRaw", url);
    sessionStorage.setItem("GoProxyEngine", engine);
    window.location.assign("/p");
  }

  function launch() {
    if (state.launching || !state.config) return;

    state.launching = true;
    elements.launch.disabled = true;
    elements.launch.classList.add("is-launching");
    elements.launch.querySelector(".cloud-launch-icon i").className =
      "fa-solid fa-circle-notch";
    elements.launch.querySelector(".cloud-launch-copy strong").textContent =
      "Opening in Fuzz…";
    elements.launch.querySelector(".cloud-launch-copy small").textContent =
      "Loading Fuzz Cloud through the proxy";
    elements.message.textContent = "";

    window.setTimeout(() => {
      try {
        openThroughProxy(CLOUD_URL);
      } catch (error) {
        state.launching = false;
        elements.launch.disabled = false;
        elements.launch.classList.remove("is-launching");
        elements.launch.querySelector(".cloud-launch-icon i").className =
          "fa-solid fa-play";
        elements.launch.querySelector(".cloud-launch-copy strong").textContent =
          "Launch Desktop";
        elements.launch.querySelector(".cloud-launch-copy small").textContent =
          "Open your Windows session";
        elements.message.textContent =
          error?.message || "Fuzz Proxy could not open the Cloud URL.";
      }
    }, 350);
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
