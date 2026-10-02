(() => {
  let session = null;
  let heartbeat = null;
  let checking = false;
  const start = document.getElementById("browser-start");
  const stop = document.getElementById("browser-stop");
  const status = document.getElementById("browser-status");
  const workspace = document.getElementById("browser-workspace");
  const card = document.getElementById("browser-launch-card");
  const frame = document.getElementById("browser-frame");
  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle("is-error", error);
  }
  async function request(path, method = "GET") {
    const response = await fetch(`/api/cloud-browser${path}`, { method, credentials: "same-origin", cache: "no-store", ...(method !== "GET" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || "The cloud browser could not be reached."), { status: response.status });
    return payload;
  }
  function detach() {
    clearInterval(heartbeat);
    heartbeat = null;
    session = null;
    frame.removeAttribute("src");
    workspace.hidden = true;
    card.hidden = false;
    start.disabled = false;
    start.textContent = "Open my browser";
  }
  function attach(value) {
    if (!value || !/^[a-f0-9-]{36}$/.test(value.id) || value.url !== `/cloud-browser/stream/${value.id}/`) throw new Error("The server returned an invalid browser session.");
    session = value;
    card.hidden = true;
    workspace.hidden = false;
    frame.src = value.url + (value.provider === "neko" ? "?embed=1&usr=Novaris&pwd=novaris-account" : "");
    message("Your browser is open. Your profile will be kept when the session ends.");
    clearInterval(heartbeat);
    heartbeat = setInterval(async () => {
      if (!session || checking) return;
      checking = true;
      try {
        await request(`/sessions/${session.id}/heartbeat`, "POST");
      } catch (error) {
        detach();
        message(error.message, true);
        if ([401, 403].includes(error.status)) start.disabled = true;
      } finally {
        checking = false;
      }
    }, 30000);
  }
  start.addEventListener("click", async () => {
    start.disabled = true;
    start.textContent = "Starting…";
    message("Opening your personal browser. The first launch may take a minute.");
    try {
      attach((await request("/sessions", "POST")).session);
    } catch (error) {
      detach();
      message(error.message, true);
      if ([401, 403].includes(error.status)) start.disabled = true;
    }
  });
  stop.addEventListener("click", async () => {
    if (!session) return;
    stop.disabled = true;
    try {
      await request(`/sessions/${session.id}`, "DELETE");
      detach();
      message("Session ended. Your browser profile is saved for next time.");
    } catch (error) {
      message(error.message, true);
    } finally {
      stop.disabled = false;
    }
  });
  document.getElementById("browser-fullscreen").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await workspace.requestFullscreen();
    } catch {
      message("Fullscreen is not available in this browser.", true);
    }
  });
  window.addEventListener("pagehide", () => {
    clearInterval(heartbeat);
    frame.removeAttribute("src");
  });
  window.addEventListener("pageshow", event => {
    if (event.persisted) window.location.reload();
  });
  request("")
    .then(payload => {
      if (payload.session) {
        attach(payload.session);
        return;
      }
      start.disabled = !payload.configured;
      start.textContent = payload.configured ? "Open my browser" : "Host setup needed";
      message(payload.configured ? "Your personal browser is ready to start." : "Cloud Browser is enabled for your account. An administrator still needs to connect the browser host.");
    })
    .catch(error => {
      message(error.message, true);
      start.textContent = "Unavailable";
    });
})();
