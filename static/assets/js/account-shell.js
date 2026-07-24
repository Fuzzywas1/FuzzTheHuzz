(() => {
  const ENGINE_MAP = {
    duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
    google: { name: "Google", url: "https://www.google.com/search?q=" },
    bing: { name: "Bing", url: "https://www.bing.com/search?q=" },
    startpage: { name: "Startpage", url: "https://www.startpage.com/search?q=" },
    qwant: { name: "Qwant", url: "https://www.qwant.com/?q=" },
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function installStyles() {
    if (document.getElementById("fuzz-account-shell-styles")) return;

    const style = document.createElement("style");
    style.id = "fuzz-account-shell-styles";
    style.textContent = `
      .fuzz-profile-menu { position: relative; }
      .fuzz-profile-trigger {
        display: inline-flex; min-height: 40px; align-items: center; gap: 8px;
        padding: 0 10px 0 7px; border: 1px solid rgba(148,161,255,.16);
        border-radius: 12px; color: white; background: rgba(255,255,255,.045);
        font: inherit; cursor: pointer;
      }
      .fuzz-profile-trigger:hover { background: rgba(255,255,255,.075); }
      .fuzz-profile-avatar {
        display: grid; width: 28px; height: 28px; place-items: center;
        border: 1px solid rgba(127,140,255,.25); border-radius: 9px;
        color: #d9ddff; background: rgba(127,140,255,.12);
        font-size: 10px; font-weight: 850;
      }
      .fuzz-profile-name { max-width: 120px; overflow: hidden; font-size: 10px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; text-transform: none; }
      .fuzz-profile-dropdown {
        position: absolute; top: calc(100% + 9px); right: 0; z-index: 2147482000;
        display: none; width: 190px; overflow: hidden; padding: 7px;
        border: 1px solid rgba(148,161,255,.19); border-radius: 14px;
        background: rgba(8,12,27,.98); box-shadow: 0 24px 70px rgba(0,0,0,.48);
        backdrop-filter: blur(18px);
      }
      .fuzz-profile-menu.is-open .fuzz-profile-dropdown { display: grid; gap: 4px; }
      .fuzz-profile-dropdown a,
      .fuzz-profile-dropdown button {
        display: flex; min-height: 39px; align-items: center; gap: 10px;
        padding: 0 10px; border: 0; border-radius: 10px; color: #d5daed;
        background: transparent; font: inherit; font-size: 10px; font-weight: 750;
        text-align: left; text-decoration: none; cursor: pointer; text-transform: none;
      }
      .fuzz-profile-dropdown a:hover,
      .fuzz-profile-dropdown button:hover { color: white; background: rgba(127,140,255,.1); }
      .fuzz-profile-dropdown i { width: 16px; color: #aeb7ff; text-align: center; }
      html.fuzz-reduced-motion *, html.fuzz-reduced-motion *::before, html.fuzz-reduced-motion *::after {
        scroll-behavior: auto !important; animation-duration: .001ms !important;
        animation-iteration-count: 1 !important; transition-duration: .001ms !important;
      }
      html[data-fuzz-appearance="midnight"] body { --background-image: radial-gradient(circle at top,#02030a,#000) !important; background: #000 !important; }
      html[data-fuzz-appearance="dim"] body { --background-image: radial-gradient(circle at top,#151827,#090b12) !important; background: #0b0e17 !important; }
      @media (max-width: 720px) { .fuzz-profile-name { display: none; } }
    `;
    document.head.appendChild(style);
  }

  function applyPreferences(preferences) {
    const appearance = preferences?.appearance || "space";
    document.documentElement.dataset.fuzzAppearance = appearance;
    document.documentElement.classList.toggle(
      "fuzz-reduced-motion",
      preferences?.reducedMotion === true,
    );

    try {
      localStorage.setItem(
        "fuzz_announcements_enabled",
        String(preferences?.announcementsEnabled !== false),
      );
      localStorage.setItem(
        "fuzz_ai_behavior",
        preferences?.aiBehavior || "balanced",
      );
      const engine = ENGINE_MAP[preferences?.defaultProxyEngine];
      if (engine) {
        localStorage.setItem("engine", engine.url);
        localStorage.setItem("enginename", engine.name);
      }
    } catch {
      // The site remains usable when browser storage is blocked.
    }

    if (preferences?.announcementsEnabled === false) {
      document.getElementById("fuzz-announcement-stack")?.remove();
      const observer = new MutationObserver(() => {
        document.getElementById("fuzz-announcement-stack")?.remove();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      window.setTimeout(() => observer.disconnect(), 8000);
    }
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      // Clear the browser state even if the network is unavailable.
    }

    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}

    window.location.href = "/login";
  }

  async function initialize() {
    if (window.location.pathname.startsWith("/admin")) return;
    installStyles();

    let payload;
    try {
      const [accountResponse, preferencesResponse] = await Promise.all([
        fetch("/api/account/me", { credentials: "same-origin" }),
        fetch("/api/account/preferences", { credentials: "same-origin" }),
      ]);

      if (!accountResponse.ok) return;
      const account = await accountResponse.json();
      const preferencePayload = preferencesResponse.ok
        ? await preferencesResponse.json()
        : { preferences: {} };
      payload = { account, preferences: preferencePayload.preferences || {} };
    } catch {
      return;
    }

    applyPreferences(payload.preferences);

    let attempts = 0;
    const placeMenu = () => {
      const navRight = document.querySelector(".f-nav-right");
      if (!navRight) {
        attempts += 1;
        if (attempts < 50) window.setTimeout(placeMenu, 50);
        return;
      }

      navRight.querySelector("#logout-btn")?.remove();
      navRight.querySelector(".fuzz-profile-menu")?.remove();

      const username = payload.account.username || "Account";
      const menu = document.createElement("div");
      menu.className = "fuzz-profile-menu";
      menu.innerHTML = `
        <button class="fuzz-profile-trigger" type="button" aria-expanded="false" aria-label="Open account menu">
          <span class="fuzz-profile-avatar">${escapeHtml(username.slice(0, 2).toUpperCase())}</span>
          <span class="fuzz-profile-name">${escapeHtml(username)}</span>
          <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
        </button>
        <div class="fuzz-profile-dropdown">
          <a href="/account"><i class="fa-solid fa-user-gear"></i><span>My Account</span></a>
          <button type="button" data-account-shell-logout><i class="fa-solid fa-right-from-bracket"></i><span>Sign Out</span></button>
        </div>
      `;
      navRight.appendChild(menu);

      const trigger = menu.querySelector(".fuzz-profile-trigger");
      trigger.addEventListener("click", () => {
        const open = menu.classList.toggle("is-open");
        trigger.setAttribute("aria-expanded", String(open));
      });
      menu.querySelector("[data-account-shell-logout]").addEventListener("click", logout);
      document.addEventListener("click", (event) => {
        if (!menu.contains(event.target)) {
          menu.classList.remove("is-open");
          trigger.setAttribute("aria-expanded", "false");
        }
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          menu.classList.remove("is-open");
          trigger.setAttribute("aria-expanded", "false");
        }
      });
    };

    placeMenu();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
