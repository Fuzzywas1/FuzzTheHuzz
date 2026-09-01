(() => {
  "use strict";

  const summary = document.getElementById("status-summary");
  const grid = document.getElementById("status-grid");
  const browserGrid = document.getElementById("browser-checks");
  const toast = document.getElementById("status-toast");
  let lastPayload = null;

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 2600);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatUptime(seconds) {
    const total = Math.max(0, Number(seconds || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  function card(name, icon, check) {
    const ok = check?.status === "online" || check?.status === "configured";
    return `<article class="status-card"><div class="status-card-head"><span class="status-card-icon"><i class="${escapeHtml(icon)}"></i></span><span class="status-pill ${ok ? "" : "warning"}">${ok ? (check.status === "configured" ? "Configured" : "Online") : "Attention"}</span></div><h3>${escapeHtml(name)}</h3><p>${escapeHtml(check?.message || "No details available.")}</p></article>`;
  }

  async function testWisp() {
    if (!("WebSocket" in window)) return false;

    return new Promise((resolve) => {
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`;
      let settled = false;
      let socket;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        try { socket?.close(); } catch {}
        resolve(value);
      };
      const timer = window.setTimeout(() => finish(false), 4500);

      try {
        socket = new WebSocket(url);
        socket.addEventListener("open", () => finish(true), { once: true });
        socket.addEventListener("error", () => finish(false), { once: true });
      } catch {
        finish(false);
      }
    });
  }

  async function browserChecks() {
    browserGrid.innerHTML = `<article class="status-browser-item"><strong>… Running browser checks</strong><span>This takes a few seconds.</span></article>`;
    const wispConnected = await testWisp();
    const checks = [
      { name: "Secure context", ok: window.isSecureContext, detail: window.isSecureContext ? "HTTPS features available" : "Open Novaris over HTTPS" },
      { name: "Service workers", ok: "serviceWorker" in navigator, detail: "serviceWorker" in navigator ? "Supported by this browser" : "Not supported" },
      { name: "Local storage", ok: (() => { try { localStorage.setItem("__fuzz_test", "1"); localStorage.removeItem("__fuzz_test"); return true; } catch { return false; } })(), detail: "Required for preferences and sessions" },
      { name: "Wisp WebSocket", ok: wispConnected, detail: wispConnected ? "Connected to /wisp/" : "Connection failed or timed out" },
    ];

    browserGrid.innerHTML = checks.map((check) => `<article class="status-browser-item"><strong>${check.ok ? "✓" : "!"} ${check.name}</strong><span>${check.detail}</span></article>`).join("");
  }

  async function load() {
    summary.innerHTML = `<div class="status-loading"><span></span>Running checks…</div>`;
    grid.innerHTML = "";
    try {
      const response = await fetch("/api/status", { credentials: "same-origin" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Status checks failed.");
      lastPayload = payload;
      const healthy = payload.overall === "online";
      summary.innerHTML = `<div class="status-overall ${healthy ? "" : "is-warning"}"><span class="status-overall-dot"></span><div><strong>${healthy ? "All critical systems are operational" : "Some systems need attention"}</strong><span>Novaris ${escapeHtml(payload.version)} · Uptime ${escapeHtml(formatUptime(payload.uptime))}</span></div></div><div class="status-meta">Checked ${escapeHtml(new Date(payload.checkedAt).toLocaleString())}</div>`;
      grid.innerHTML = [
        card("Server", "fa-solid fa-server", payload.checks.server),
        card("Supabase", "fa-solid fa-database", payload.checks.database),
        card("OpenAI", "fa-solid fa-wand-magic-sparkles", payload.checks.openai),
        card("Scramjet", "fa-solid fa-bolt", payload.checks.scramjet),
        card("Ultraviolet", "fa-solid fa-layer-group", payload.checks.ultraviolet),
        card("Wisp transport", "fa-solid fa-wave-square", payload.checks.wisp),
      ].join("");
    } catch (error) {
      const id = window.FuzzDiagnostics?.report?.(error, { prefix: "ST", component: "status", action: "status.load_failed" });
      summary.innerHTML = `<div class="status-overall is-warning"><span class="status-overall-dot"></span><div><strong>Status checks failed</strong><span>${escapeHtml(error.message)}${id ? ` · Error ID ${escapeHtml(id)}` : ""}</span></div></div>`;
    }
    browserChecks();
  }

  document.getElementById("refresh-status")?.addEventListener("click", load);
  document.getElementById("copy-diagnostics")?.addEventListener("click", async () => {
    if (!lastPayload) return showToast("Run the checks first.");
    const text = [
      `Novaris ${lastPayload.version}`,
      `Overall: ${lastPayload.overall}`,
      `Checked: ${lastPayload.checkedAt}`,
      ...Object.entries(lastPayload.checks || {}).map(([name, check]) => `${name}: ${check.status} — ${check.message}`),
      `Browser: ${navigator.userAgent}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      showToast("Diagnostics copied.");
    } catch {
      showToast("Clipboard access was blocked.");
    }
  });

  load();
})();
