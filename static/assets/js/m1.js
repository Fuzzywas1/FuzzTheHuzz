(() => {
  "use strict";

  const ROUTE_GROUPS = [
    {
      label: "Workspace",
      items: [
        { href: "/", match: ["/", "/index.html"], label: "Home", icon: "home" },
        { href: "/chat", match: ["/chat", "/chat.html"], label: "Chat", icon: "chat", badge: "chat" },
        { href: "/ai", match: ["/ai", "/ai.html"], label: "Fuzz AI", icon: "sparkles" },
      ],
    },
    {
      label: "Browser",
      items: [
        { href: "/b", match: ["/b", "/apps.html"], label: "Apps", icon: "apps" },
        { href: "/d", match: ["/d", "/tabs.html"], label: "Tabs", icon: "tabs" },
        { href: "/p", match: ["/p", "/proxy.html"], label: "Proxy", icon: "globe" },
      ],
    },
    {
      label: "Control",
      items: [
        { href: "/account#preferences", match: ["/c", "/settings", "/settings.html"], hashPath: "/account", hash: "#preferences", label: "Settings", icon: "settings" },
        { href: "/feedback", match: ["/feedback", "/feedback.html"], label: "Feedback", icon: "feedback" },
        { href: "/status", match: ["/status", "/status.html"], label: "Status", icon: "status" },
      ],
    },
  ];

  let canAccessAdmin = false;

  const ICONS = Object.freeze({
    home: '<path d="M3.5 10.8 12 3.7l8.5 7.1"/><path d="M5.6 9.8v10.1h12.8V9.8"/><path d="M9.4 19.9v-6.2h5.2v6.2"/>',
    chat: '<path d="M5.1 17.8 3.7 21l4.1-1.9c1.2.5 2.5.8 4.2.8 5.1 0 8.8-3.3 8.8-7.9S17.1 4.1 12 4.1 3.2 7.4 3.2 12c0 2.2.7 4.2 1.9 5.8Z"/><path d="M8.2 12h.1M11.9 12h.1M15.6 12h.1"/>',
    sparkles: '<path d="m12 3 1.2 3.4L16.6 8l-3.4 1.2L12 12.6l-1.2-3.4L7.4 8l3.4-1.6L12 3Z"/><path d="m18.3 13.2.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/><path d="m5.6 13.8.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/>',
    apps: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.5"/><rect x="14" y="14" width="6.5" height="6.5" rx="1.5"/>',
    tabs: '<rect x="3.5" y="5.2" width="17" height="13.6" rx="2.3"/><path d="M3.7 9.2h16.6"/><path d="M7 7.2h.1M10 7.2h.1"/>',
    globe: '<circle cx="12" cy="12" r="8.8"/><path d="M3.5 12h17M12 3.2c2.2 2.4 3.3 5.3 3.3 8.8S14.2 18.4 12 20.8M12 3.2C9.8 5.6 8.7 8.5 8.7 12s1.1 6.4 3.3 8.8"/>',
    settings: '<circle cx="12" cy="12" r="3.1"/><path d="M19.1 13.7a7.8 7.8 0 0 0 .1-3.4l2-1.5-2-3.4-2.5 1a8 8 0 0 0-2.9-1.7L13.5 2h-4l-.4 2.7a8 8 0 0 0-2.9 1.7l-2.5-1-2 3.4 2 1.5a7.8 7.8 0 0 0 .1 3.4l-2.1 1.5 2 3.4 2.5-1a8 8 0 0 0 2.9 1.7l.4 2.7h4l.4-2.7a8 8 0 0 0 2.9-1.7l2.5 1 2-3.4-2.2-1.5Z"/>',
    feedback: '<path d="M4 4.8h16v11.1H9l-5 4V4.8Z"/><path d="M8 9h8M8 12.5h5"/>',
    status: '<path d="M4 18.5h2.7V14H4v4.5ZM10.7 18.5h2.7V9.4h-2.7v9.1ZM17.3 18.5H20V4.8h-2.7v13.7Z"/>',
    admin: '<path d="M12 3.2 19 6v5.4c0 4.2-2.8 8-7 9.4-4.2-1.4-7-5.2-7-9.4V6l7-2.8Z"/><path d="m8.9 12 2 2 4.2-4.4"/>',
    bell: '<path d="M18.2 9.7c0-3.5-2.2-5.9-6.2-5.9S5.8 6.2 5.8 9.7c0 6-2.2 6.5-2.2 6.5h16.8s-2.2-.5-2.2-6.5Z"/><path d="M9.6 19.2c.5.9 1.2 1.4 2.4 1.4s1.9-.5 2.4-1.4"/>',
    logout: '<path d="M10 4H5.2v16H10"/><path d="M13.5 8.2 17.3 12l-3.8 3.8M8.5 12h8.8"/>',
    collapse: '<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M9 4v16"/><path d="m15.5 9-3 3 3 3"/>',
    expand: '<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M9 4v16"/><path d="m12.5 9 3 3-3 3"/>',
    user: '<circle cx="12" cy="8" r="3.3"/><path d="M5.5 20c.6-4.1 2.8-6.1 6.5-6.1s5.9 2 6.5 6.1"/>',
  });

  const escapeHtml = (value = "") => String(value).replace(
    /[&<>'"]/g,
    (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[character],
  );

  function iconSvg(name, className = "") {
    const body = ICONS[name] || ICONS.home;
    return `<svg class="fuzz-icon ${escapeHtml(className)}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  const hexToRgb = (value) => {
    const hex = String(value || "").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(hex)) return "124, 124, 255";
    return `${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}`;
  };

  function applyPersonalization(prefs = {}) {
    const root = document.documentElement;
    const accent = /^#[0-9a-f]{6}$/i.test(prefs.accentColor || "")
      ? prefs.accentColor
      : "#7c7cff";

    root.style.setProperty("--fuzz-accent", accent);
    root.style.setProperty("--fuzz-accent-rgb", hexToRgb(accent));
    root.style.setProperty(
      "--fuzz-surface-opacity",
      String(Math.min(0.96, Math.max(0.35, Number(prefs.surfaceOpacity ?? 0.78)))),
    );
    root.style.setProperty(
      "--fuzz-radius",
      `${Math.min(30, Math.max(8, Number(prefs.borderRadius ?? 18)))}px`,
    );
    root.style.setProperty(
      "--fuzz-font-scale",
      String(Math.min(1.25, Math.max(0.85, Number(prefs.fontScale ?? 1)))),
    );

    document.body.classList.toggle("fuzz-density-compact", prefs.density === "compact");
    document.body.classList.toggle("fuzz-reduced-motion", prefs.reducedMotion === true);

    if (prefs.sidebarMode === "expanded" || prefs.sidebarMode === "collapsed") {
      try {
        localStorage.setItem("fuzzSidebarMode", prefs.sidebarMode);
      } catch {}

      if (!window.matchMedia("(max-width: 820px)").matches) {
        document.body.classList.toggle(
          "fuzz-sidebar-collapsed",
          prefs.sidebarMode === "collapsed",
        );
      }
    }

    let legacyWallpaper = "";
    try {
      legacyWallpaper = localStorage.getItem("backgroundImage") || "";
    } catch {}

    const wallpaper = prefs.wallpaperUrl || prefs.wallpaperExternalUrl || legacyWallpaper;
    document.body.classList.toggle("fuzz-has-wallpaper", Boolean(wallpaper));

    if (wallpaper) {
      const overlay = Math.min(0.85, Math.max(0, Number(prefs.wallpaperOverlay ?? 0.42)));
      const safeWallpaper = String(wallpaper).replaceAll('"', "%22");
      document.body.style.backgroundImage = `linear-gradient(rgba(2,3,10,${overlay}), rgba(2,3,10,${overlay})), url("${safeWallpaper}")`;
      document.body.style.backgroundSize = prefs.wallpaperFit || "cover";
      document.body.style.backgroundPosition = prefs.wallpaperPosition || "center";
      document.body.style.backgroundAttachment = "fixed";
    } else {
      document.body.style.removeProperty("background-image");
      document.body.style.removeProperty("background-size");
      document.body.style.removeProperty("background-position");
      document.body.style.removeProperty("background-attachment");
    }

    const quickLinks = document.querySelector(".home-actions");
    const bookmarks = document.getElementById("home-bookmarks")?.closest(".home-library-column");
    const recents = document.getElementById("home-recents")?.closest(".home-library-column");
    if (quickLinks) quickLinks.hidden = prefs.homeShowQuickLinks === false;
    if (bookmarks) bookmarks.hidden = prefs.homeShowBookmarks === false;
    if (recents) recents.hidden = prefs.homeShowRecents === false;

    const styleId = "fuzz-personalization-style";
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      document.head.append(style);
    }

    const blur = Math.min(18, Math.max(0, Number(prefs.wallpaperBlur ?? 0)));
    style.textContent = blur > 0
      ? `body.fuzz-has-wallpaper::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;backdrop-filter:blur(${blur}px);-webkit-backdrop-filter:blur(${blur}px)}body.fuzz-has-wallpaper>main,body.fuzz-has-wallpaper>header,body.fuzz-has-wallpaper>section,body.fuzz-has-wallpaper>aside{position:relative;z-index:1}`
      : "";

    try {
      localStorage.setItem(
        "fuzzPersonalization",
        JSON.stringify({ ...prefs, wallpaperUrl: prefs.wallpaperUrl || "" }),
      );
    } catch {}
  }

  function getCachedPersonalization() {
    try {
      return JSON.parse(localStorage.getItem("fuzzPersonalization") || "{}");
    } catch {
      return {};
    }
  }

  function normalizedPath(value = window.location.pathname) {
    const normalized = String(value || "/").replace(/\/+$/, "");
    return normalized || "/";
  }

  function isActive(item) {
    const path = normalizedPath();
    const pathMatch = item.match.some((candidate) => normalizedPath(candidate) === path);
    const hashMatch = Boolean(
      item.hashPath &&
      normalizedPath(item.hashPath) === path &&
      window.location.hash === item.hash,
    );
    return pathMatch || hashMatch;
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function initials(name = "F") {
    return String(name)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "F";
  }

  function timeAgo(value) {
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return "";
    const difference = Date.now() - time;
    if (difference < 60_000) return "now";
    if (difference < 3_600_000) return `${Math.floor(difference / 60_000)}m`;
    if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)}h`;
    return new Date(time).toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function safeInternalLink(value) {
    const link = String(value || "");
    return link.startsWith("/") && !link.startsWith("//") ? link : "";
  }

  function notificationIcon(type = "") {
    if (type === "chat_message") return "chat";
    if (type.startsWith("feedback")) return "feedback";
    return "bell";
  }

  function renderNotifications(data = {}) {
    const panel = document.querySelector("[data-fuzz-notification-panel]");
    const list = document.querySelector("[data-fuzz-notification-list]");
    const badge = document.querySelector('[data-fuzz-badge="notifications"]');
    const count = Number(data.unread || 0);

    if (badge) {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.hidden = count < 1;
    }

    if (!panel || !list) return;
    const notifications = Array.isArray(data.notifications) ? data.notifications : [];
    list.innerHTML = notifications.length
      ? notifications.map((item) => {
        const link = safeInternalLink(item.link);
        return `<button class="fuzz-notification-item${item.readAt ? "" : " is-unread"}" type="button" data-notification-id="${escapeHtml(item.id)}" data-notification-link="${escapeHtml(link)}">
          <span class="fuzz-notification-icon">${iconSvg(notificationIcon(item.type))}</span>
          <span class="fuzz-notification-copy">
            <strong>${escapeHtml(item.title || "Notification")}</strong>
            ${item.body ? `<small>${escapeHtml(item.body)}</small>` : ""}
            <time>${escapeHtml(timeAgo(item.createdAt))}</time>
          </span>
        </button>`;
      }).join("")
      : `<div class="fuzz-notification-empty">${iconSvg("bell")}<strong>You are all caught up</strong><small>Messages and feedback updates will appear here.</small></div>`;

    list.querySelectorAll("[data-notification-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await fetchJson("/api/notifications/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: button.dataset.notificationId }),
          });
        } catch {}
        const link = safeInternalLink(button.dataset.notificationLink);
        if (link) window.location.href = link;
        else {
          button.classList.remove("is-unread");
          updateNotifications();
        }
      });
    });
  }

  async function updateNotifications(includeList = false) {
    try {
      const data = await fetchJson("/api/notifications");
      const panel = document.querySelector("[data-fuzz-notification-panel]");
      if (includeList || !panel?.hidden) renderNotifications(data);
      else {
        const badge = document.querySelector('[data-fuzz-badge="notifications"]');
        const count = Number(data.unread || 0);
        if (badge) {
          badge.textContent = count > 99 ? "99+" : String(count);
          badge.hidden = count < 1;
        }
      }
    } catch {}
  }

  function renderRoute(item) {
    return `<a class="fuzz-sidebar-link${isActive(item) ? " is-active" : ""}" href="${item.href}" data-tooltip="${escapeHtml(item.label)}" title="${escapeHtml(item.label)}" ${isActive(item) ? 'aria-current="page"' : ""}>
      <span class="fuzz-sidebar-icon">${iconSvg(item.icon)}</span>
      <span class="fuzz-sidebar-label">${escapeHtml(item.label)}</span>
      ${item.badge ? `<span class="fuzz-sidebar-badge" data-fuzz-badge="${item.badge}" hidden>0</span>` : ""}
    </a>`;
  }

  function renderShell(container, account = {}) {
    let savedMode = "expanded";
    try {
      savedMode = localStorage.getItem("fuzzSidebarMode") || "expanded";
    } catch {}

    const isMobile = window.matchMedia("(max-width: 820px)").matches;
    const collapsed = !isMobile && savedMode === "collapsed";

    document.body.classList.add("has-fuzz-sidebar");
    document.body.classList.remove("fuzz-shell-overlay");
    document.body.classList.toggle("fuzz-sidebar-collapsed", collapsed);

    const groupedLinks = ROUTE_GROUPS.map((group) => `
      <section class="fuzz-sidebar-group" aria-label="${escapeHtml(group.label)}">
        <div class="fuzz-sidebar-section-label">${escapeHtml(group.label)}</div>
        ${group.items.map(renderRoute).join("")}
      </section>`).join("");

    const path = normalizedPath();
    canAccessAdmin = account.role === "owner";
    const adminLink = canAccessAdmin
      ? `<section class="fuzz-sidebar-group" aria-label="Management">
          <div class="fuzz-sidebar-section-label">Management</div>
          <a class="fuzz-sidebar-link${path.startsWith("/admin") ? " is-active" : ""}" href="/admin" data-tooltip="Admin" title="Admin" ${path.startsWith("/admin") ? 'aria-current="page"' : ""}>
            <span class="fuzz-sidebar-icon">${iconSvg("admin")}</span>
            <span class="fuzz-sidebar-label">Admin</span>
          </a>
        </section>`
      : "";

    const safeUsername = escapeHtml(account.username || "Fuzz user");
    const safeRole = escapeHtml(account.role || "user");

    container.innerHTML = `
      <aside class="fuzz-sidebar" aria-label="Fuzz navigation">
        <header class="fuzz-sidebar-header">
          <a class="fuzz-sidebar-brand" href="/" data-tooltip="Fuzz Home" title="Fuzz Home" aria-label="Fuzz Home">
            <span class="fuzz-sidebar-logo" aria-hidden="true"><span>F</span></span>
            <span class="fuzz-sidebar-brand-copy"><strong>FuzzTheHuzz</strong><small>Private workspace</small></span>
          </a>
        </header>

        <nav class="fuzz-sidebar-nav" aria-label="Main navigation">
          ${groupedLinks}
          ${adminLink}
        </nav>

        <footer class="fuzz-sidebar-footer">
          <button class="fuzz-sidebar-action fuzz-notification-button" type="button" data-fuzz-notifications data-tooltip="Notifications" title="Notifications" aria-expanded="false">
            <span class="fuzz-sidebar-icon">${iconSvg("bell")}</span>
            <span class="fuzz-sidebar-label">Notifications</span>
            <span class="fuzz-sidebar-badge" data-fuzz-badge="notifications" hidden>0</span>
          </button>

          <section class="fuzz-notification-panel" data-fuzz-notification-panel hidden>
            <header>
              <div><strong>Notifications</strong><small>Messages and updates</small></div>
              <button type="button" data-fuzz-read-all>Mark all read</button>
            </header>
            <div class="fuzz-notification-list" data-fuzz-notification-list>
              <div class="fuzz-notification-empty"><span class="fuzz-notification-loader"></span><small>Loading notifications…</small></div>
            </div>
          </section>

          <a class="fuzz-sidebar-profile" href="/account" data-tooltip="Account" title="Account" aria-label="Open account">
            <span class="fuzz-sidebar-avatar">${escapeHtml(initials(account.username))}</span>
            <span class="fuzz-sidebar-profile-copy"><strong>${safeUsername}</strong><small>${safeRole}</small></span>
            <span class="fuzz-profile-arrow" aria-hidden="true">${iconSvg("user")}</span>
          </a>

          <div class="fuzz-sidebar-utility-row">
            <button class="fuzz-sidebar-action" type="button" data-fuzz-collapse data-tooltip="Collapse menu" title="Collapse menu" aria-label="Collapse menu" aria-pressed="false">
              <span class="fuzz-sidebar-icon fuzz-collapse-icon">${iconSvg(collapsed ? "expand" : "collapse")}</span>
              <span class="fuzz-sidebar-label" data-fuzz-collapse-label>${collapsed ? "Expand menu" : "Collapse menu"}</span>
            </button>
            <button class="fuzz-sidebar-action fuzz-logout-action" type="button" data-fuzz-logout data-tooltip="Sign out" title="Sign out" aria-label="Sign out">
              <span class="fuzz-sidebar-icon">${iconSvg("logout")}</span>
              <span class="fuzz-sidebar-label">Sign out</span>
            </button>
          </div>
        </footer>
      </aside>`;

    let scrim = document.querySelector(".fuzz-sidebar-scrim");
    if (!scrim) {
      scrim = document.createElement("button");
      scrim.className = "fuzz-sidebar-scrim";
      scrim.type = "button";
      scrim.setAttribute("aria-label", "Close navigation");
      document.body.append(scrim);
    }

    let mobileToggle = document.querySelector(".fuzz-mobile-menu-toggle");
    if (!mobileToggle) {
      mobileToggle = document.createElement("button");
      mobileToggle.className = "fuzz-mobile-menu-toggle";
      mobileToggle.type = "button";
      mobileToggle.setAttribute("aria-label", "Open navigation");
      mobileToggle.innerHTML = '<span></span><span></span><span></span>';
      document.body.append(mobileToggle);
    }

    const collapseButton = container.querySelector("[data-fuzz-collapse]");
    const notificationButton = container.querySelector("[data-fuzz-notifications]");
    const notificationPanel = container.querySelector("[data-fuzz-notification-panel]");

    const syncCollapseUi = () => {
      const isCollapsed = document.body.classList.contains("fuzz-sidebar-collapsed");
      const label = isCollapsed ? "Expand menu" : "Collapse menu";
      collapseButton?.setAttribute("aria-label", label);
      collapseButton?.setAttribute("aria-pressed", String(isCollapsed));
      collapseButton?.setAttribute("data-tooltip", label);
      collapseButton?.setAttribute("title", label);
      const labelNode = collapseButton?.querySelector("[data-fuzz-collapse-label]");
      if (labelNode) labelNode.textContent = label;
      const icon = collapseButton?.querySelector(".fuzz-collapse-icon");
      if (icon) icon.innerHTML = iconSvg(isCollapsed ? "expand" : "collapse");
    };

    const closeMobileNav = () => {
      document.body.classList.remove("fuzz-mobile-nav-open");
      mobileToggle?.setAttribute("aria-expanded", "false");
    };

    const toggleSidebar = () => {
      if (window.matchMedia("(max-width: 820px)").matches) {
        const open = document.body.classList.toggle("fuzz-mobile-nav-open");
        mobileToggle?.setAttribute("aria-expanded", String(open));
        return;
      }

      const nextCollapsed = !document.body.classList.contains("fuzz-sidebar-collapsed");
      document.body.classList.toggle("fuzz-sidebar-collapsed", nextCollapsed);
      try {
        localStorage.setItem("fuzzSidebarMode", nextCollapsed ? "collapsed" : "expanded");
      } catch {}
      syncCollapseUi();
      window.dispatchEvent(new CustomEvent("fuzz:sidebar-change", {
        detail: { collapsed: nextCollapsed },
      }));
    };

    collapseButton?.addEventListener("click", toggleSidebar);
    mobileToggle.addEventListener("click", toggleSidebar);
    scrim.addEventListener("click", closeMobileNav);
    container.querySelectorAll(".fuzz-sidebar-link, .fuzz-sidebar-brand, .fuzz-sidebar-profile").forEach((link) => {
      link.addEventListener("click", closeMobileNav);
    });

    notificationButton?.addEventListener("click", () => {
      notificationPanel.hidden = !notificationPanel.hidden;
      notificationButton.setAttribute("aria-expanded", String(!notificationPanel.hidden));
      if (!notificationPanel.hidden) updateNotifications(true);
    });

    container.querySelector("[data-fuzz-read-all]")?.addEventListener("click", async () => {
      try {
        await fetchJson("/api/notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        await updateNotifications(true);
      } catch {}
    });

    document.addEventListener("click", (event) => {
      if (
        notificationPanel.hidden ||
        notificationPanel.contains(event.target) ||
        notificationButton?.contains(event.target)
      ) return;
      notificationPanel.hidden = true;
      notificationButton?.setAttribute("aria-expanded", "false");
    });

    container.querySelector("[data-fuzz-logout]")?.addEventListener("click", async () => {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "same-origin",
        });
      } catch {}
      sessionStorage.clear();
      window.location.href = "/login";
    });

    window.addEventListener("resize", () => {
      if (!window.matchMedia("(max-width: 820px)").matches) closeMobileNav();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeMobileNav();
        if (notificationPanel && !notificationPanel.hidden) {
          notificationPanel.hidden = true;
          notificationButton?.setAttribute("aria-expanded", "false");
        }
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        toggleSidebar();
      }
    });

    syncCollapseUi();
  }

  async function updateUnread() {
    try {
      const data = await fetchJson("/api/chat/unread");
      const badge = document.querySelector('[data-fuzz-badge="chat"]');
      const count = Number(data.unread || 0);
      if (badge) {
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.hidden = count < 1;
      }
      document.title = count > 0 && !window.location.pathname.startsWith("/chat")
        ? `(${count}) ${document.title.replace(/^\(\d+\)\s*/, "")}`
        : document.title.replace(/^\(\d+\)\s*/, "");
    } catch {}
  }

  document.addEventListener("DOMContentLoaded", async () => {
    applyPersonalization(getCachedPersonalization());
    const nav = document.querySelector(".f-nav");
    if (!nav) return;

    document.body.classList.add("has-fuzz-sidebar");
    if (window.matchMedia("(max-width: 820px)").matches) {
      document.body.classList.remove("fuzz-sidebar-collapsed");
    }

    let account = {};
    try {
      account = await fetchJson("/api/account/me");
    } catch {}
    renderShell(nav, account);

    try {
      const { preferences } = await fetchJson("/api/personalization");
      applyPersonalization(preferences || {});
    } catch {}

    updateUnread();
    updateNotifications();
    window.setInterval(updateUnread, 12_000);
    window.setInterval(updateNotifications, 20_000);
  });

  document.addEventListener("keydown", (event) => {
    if (
      canAccessAdmin &&
      event.ctrlKey &&
      event.shiftKey &&
      event.key.toLowerCase() === "o"
    ) {
      event.preventDefault();
      window.location.href = "/admin";
    }
  });

  window.FuzzPersonalization = { apply: applyPersonalization };
})();
