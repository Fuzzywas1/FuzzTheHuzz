(() => {
  const DISMISS_KEY = "fuzz_dismissed_announcements_v1";
  const currentPath = window.location.pathname;

  if (currentPath.startsWith("/admin")) {
    return;
  }

  function readDismissed() {
    try {
      const value = JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]");
      return new Set(Array.isArray(value) ? value : []);
    } catch {
      return new Set();
    }
  }

  function saveDismissed(values) {
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify([...values]));
    } catch {
      // Browsers with blocked storage can still view announcements.
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function fetchJson(path) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    return response.json();
  }

  function installStyles() {
    if (document.getElementById("fuzz-site-control-styles")) return;

    const style = document.createElement("style");
    style.id = "fuzz-site-control-styles";
    style.textContent = `
      #fuzz-announcement-stack {
        position: fixed;
        top: 12px;
        left: 50%;
        z-index: 2147483000;
        display: grid;
        width: min(760px, calc(100vw - 28px));
        gap: 9px;
        transform: translateX(-50%);
        pointer-events: none;
      }

      .fuzz-site-announcement {
        position: relative;
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: start;
        gap: 12px;
        overflow: hidden;
        padding: 13px 14px;
        border: 1px solid rgba(155, 171, 255, 0.24);
        border-radius: 14px;
        color: #f4f7ff;
        background: rgba(8, 12, 27, 0.96);
        box-shadow: 0 18px 55px rgba(0, 0, 0, 0.46);
        font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        backdrop-filter: blur(18px);
        pointer-events: auto;
        animation: fuzzAnnouncementIn 220ms ease both;
      }

      .fuzz-site-announcement::before {
        position: absolute;
        inset: 0 auto 0 0;
        width: 3px;
        content: "";
        background: #7f8cff;
      }

      .fuzz-site-announcement[data-style="success"]::before { background: #47e6a7; }
      .fuzz-site-announcement[data-style="warning"]::before { background: #f8c85a; }
      .fuzz-site-announcement[data-style="critical"]::before { background: #ff6c87; }

      .fuzz-announcement-symbol {
        display: grid;
        width: 29px;
        height: 29px;
        place-items: center;
        border: 1px solid rgba(127, 140, 255, 0.22);
        border-radius: 9px;
        color: #cdd3ff;
        background: rgba(127, 140, 255, 0.1);
        font-size: 13px;
      }

      .fuzz-announcement-copy {
        display: grid;
        gap: 3px;
        min-width: 0;
      }

      .fuzz-announcement-copy strong {
        color: #f4f7ff;
        font-size: 12px;
        line-height: 1.35;
      }

      .fuzz-announcement-copy span {
        color: #aab3ca;
        font-size: 10px;
        line-height: 1.5;
        white-space: pre-wrap;
      }

      .fuzz-announcement-dismiss {
        display: grid;
        width: 28px;
        height: 28px;
        place-items: center;
        padding: 0;
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 9px;
        color: #aab3ca;
        background: rgba(255,255,255,.04);
        cursor: pointer;
      }

      .fuzz-announcement-dismiss:hover {
        color: white;
        background: rgba(255,255,255,.08);
      }

      @keyframes fuzzAnnouncementIn {
        from { opacity: 0; transform: translateY(-8px) scale(.99); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      @media (max-width: 620px) {
        #fuzz-announcement-stack { top: 8px; width: calc(100vw - 16px); }
        .fuzz-site-announcement { grid-template-columns: auto 1fr auto; padding: 11px; }
      }
    `;

    document.head.appendChild(style);
  }

  function announcementSymbol(style) {
    if (style === "success") return "✓";
    if (style === "warning") return "!";
    if (style === "critical") return "×";
    return "i";
  }

  function renderAnnouncements(announcements, extraAnnouncements = []) {
    const dismissed = readDismissed();
    const visible = [...extraAnnouncements, ...(announcements || [])].filter(
      (announcement) => !dismissed.has(announcement.id),
    );

    if (visible.length === 0) return;

    installStyles();

    const stack = document.createElement("div");
    stack.id = "fuzz-announcement-stack";

    stack.innerHTML = visible
      .map(
        (announcement) => `
          <article
            class="fuzz-site-announcement"
            data-announcement-id="${escapeHtml(announcement.id)}"
            data-style="${escapeHtml(announcement.style || "info")}"
          >
            <span class="fuzz-announcement-symbol">
              ${escapeHtml(announcementSymbol(announcement.style))}
            </span>

            <span class="fuzz-announcement-copy">
              <strong>${escapeHtml(announcement.title)}</strong>
              <span>${escapeHtml(announcement.message)}</span>
            </span>

            ${
              announcement.dismissible
                ? `
                  <button
                    class="fuzz-announcement-dismiss"
                    type="button"
                    aria-label="Dismiss announcement"
                    title="Dismiss"
                  >
                    ×
                  </button>
                `
                : ""
            }
          </article>
        `,
      )
      .join("");

    document.body.appendChild(stack);

    stack.querySelectorAll(".fuzz-announcement-dismiss").forEach((button) => {
      button.addEventListener("click", () => {
        const card = button.closest("[data-announcement-id]");
        if (!card) return;

        dismissed.add(card.dataset.announcementId);
        saveDismissed(dismissed);
        card.remove();

        if (!stack.children.length) {
          stack.remove();
        }
      });
    });
  }

  function featureForPath(pathname) {
    if (["/ai", "/ai.html"].includes(pathname)) return "ai";
    if (["/cloud", "/cloud.html"].includes(pathname)) return "cloud";
    if (["/b", "/apps.html"].includes(pathname)) return "apps";
    if (["/a", "/games.html", "/play.html"].includes(pathname)) return "games";
    if (["/signup", "/signup.html"].includes(pathname)) return "registrations";
    return null;
  }

  function isFeatureEnabled(features, feature) {
    if (!feature) return true;
    return features?.[feature] !== false;
  }

  async function sendSecurityHeartbeat() {
    try {
      const response = await fetch("/api/auth/security/heartbeat", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "{}",
      });

      if (response.status === 423 && currentPath !== "/suspended") {
        window.location.replace("/suspended");
      }
    } catch {
      // Guests and temporarily offline clients do not need a heartbeat.
    }
  }

  async function initialize() {
    void sendSecurityHeartbeat();
    window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void sendSecurityHeartbeat();
      }
    }, 120000);

    try {
      const [configPayload, announcementPayload] = await Promise.all([
        fetchJson("/api/platform/config"),
        fetchJson("/api/announcements/active").catch(() => ({ announcements: [] })),
      ]);

      const config = configPayload || {};
      window.fuzzPlatformConfig = config;
      window.dispatchEvent(
        new CustomEvent("fuzz:platform-config", { detail: config }),
      );

      if (
        config.maintenance?.active &&
        !config.maintenance?.bypass &&
        !["/maintenance", "/login", "/verified"].includes(currentPath)
      ) {
        window.location.replace("/maintenance");
        return;
      }

      const feature = featureForPath(currentPath);

      if (!isFeatureEnabled(config.features, feature)) {
        const url = new URL("/feature-unavailable", window.location.origin);
        url.searchParams.set("feature", feature);
        window.location.replace(`${url.pathname}${url.search}`);
        return;
      }

      const extras = [];

      if (currentPath === "/" && config.features?.proxy === false) {
        extras.push({
          id: "system-proxy-disabled",
          title: "Proxy temporarily unavailable",
          message: "Browsing through the Fuzz proxy is currently disabled by an administrator.",
          style: "warning",
          dismissible: false,
        });
      }

      if (config.features?.imageUploads === false && ["/ai", "/ai.html"].includes(currentPath)) {
        extras.push({
          id: "system-image-uploads-disabled",
          title: "AI image uploads disabled",
          message: "Text chat is still available, but images cannot be attached right now.",
          style: "info",
          dismissible: true,
        });
      }

      renderAnnouncements(announcementPayload.announcements, extras);
    } catch (error) {
      console.warn("Fuzz site controls could not be loaded:", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
