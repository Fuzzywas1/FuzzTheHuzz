(() => {
  "use strict";

  const state = { config: null, launching: false };
  const elements = {};

  async function request(path) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Fuzz Cloud could not be loaded.");
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
      "Open Fuzz Control and verify that Fuzz Cloud is enabled and the Guacamole URL is saved.";
    setStatus("error", "Unavailable");
  }

  function renderReady(config) {
    state.config = config;
    elements.name.textContent = config.name || "Gaming PC";
    elements.launch.disabled = false;
    elements.direct.disabled = false;
    elements.message.textContent = "";
    elements.description.textContent =
      "Launches Apache Guacamole through Fuzz Proxy. Fuzz fullscreen removes the browser controls while your desktop is open.";
    setStatus("ready", "Gateway ready");
  }

  async function load() {
    try { renderReady(await request("/api/cloud/config")); }
    catch (error) { showError(error.message); }
  }

  function openThroughProxy(url) {
    sessionStorage.setItem("GoProxyFullscreen", state.config?.fullscreen === false ? "0" : "1");
    if (typeof window.FuzzProxy?.openStandalone === "function") {
      window.FuzzProxy.openStandalone(url, window.FuzzProxy.getEngine());
      return;
    }
    sessionStorage.setItem("GoUrlRaw", url);
    sessionStorage.setItem("GoProxyEngine", "scramjet");
    window.location.assign("/p");
  }

  function launch() {
    if (state.launching || !state.config?.launchUrl) return;
    state.launching = true;
    elements.launch.disabled = true;
    elements.launch.classList.add("is-launching");
    elements.launch.querySelector(".cloud-launch-icon i").className = "fa-solid fa-circle-notch";
    elements.launch.querySelector(".cloud-launch-copy strong").textContent = "Opening desktop…";
    elements.launch.querySelector(".cloud-launch-copy small").textContent = "Preparing the Fuzz fullscreen workspace";
    window.setTimeout(() => openThroughProxy(state.config.launchUrl), 350);
  }

  function openDirect() {
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
    elements.direct.addEventListener("click", openDirect);
    load();
  });
})();
