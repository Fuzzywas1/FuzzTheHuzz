import { renderActivity } from "./activity.js";
import { renderAnnouncements } from "./announcements.js";
import { renderAi } from "./ai.js";
import { renderAnalytics } from "./analytics.js";
import { renderDashboard } from "./dashboard.js?v=8";
import { renderExports } from "./exports.js";
import { renderInvites } from "./invites.js";
import { renderLimits } from "./limits.js";
import { renderHistory } from "./history.js";
import { renderHealth } from "./health.js";
import { renderProxy } from "./proxy.js";
import { renderSecurityCenter } from "./security-center.js";
import { renderSettings } from "./settings.js?v=8";
import { renderUserProfile } from "./user-profile.js";
import { renderUsers } from "./users.js";

const routes = {
  dashboard: {
    title: "Dashboard",
    subtitle: "A live overview of your platform.",
    render: renderDashboard,
  },
  users: {
    title: "Users",
    subtitle: "Manage roles, account access and bans.",
    render: renderUsers,
  },
  "user-profile": {
    title: "User Profile",
    subtitle: "Account details, activity, AI chats and proxy history.",
    render: renderUserProfile,
  },
  activity: {
    title: "Activity",
    subtitle: "Search the complete Novaris audit trail.",
    render: renderActivity,
  },
  security: {
    title: "Security Center",
    subtitle: "Notifications, active sessions and sensitive audit events.",
    render: renderSecurityCenter,
  },
  limits: {
    title: "Limits & Abuse",
    subtitle: "Set usage limits, automatic suspensions and abuse controls.",
    render: renderLimits,
  },
  health: {
    title: "System Health",
    subtitle: "Deep checks, proxy assets, platform switches, and client error IDs.",
    render: renderHealth,
  },
  history: {
    title: "History",
    subtitle: "Owner-only AI conversations and proxy searches.",
    render: renderHistory,
  },
  invites: {
    title: "Invite Codes",
    subtitle: "Create and manage invite-only signup access.",
    render: renderInvites,
  },
  announcements: {
    title: "Announcements",
    subtitle: "Publish banners and scheduled notices across Novaris.",
    render: renderAnnouncements,
  },
  ai: {
    title: "Novaris AI",
    subtitle: "Usage, performance and account activity.",
    render: renderAi,
  },
  proxy: {
    title: "Proxy",
    subtitle: "Traffic, domains and navigation performance.",
    render: renderProxy,
  },
  analytics: {
    title: "Analytics",
    subtitle: "Growth and usage trends across the platform.",
    render: renderAnalytics,
  },
  exports: {
    title: "Backups & Export",
    subtitle: "Download secure snapshots of platform data.",
    render: renderExports,
  },
  settings: {
    title: "Settings",
    subtitle: "System health and owner maintenance actions.",
    render: renderSettings,
  },
};

let currentRoute = "dashboard";
let currentPath = "dashboard";
let rendering = false;

function resolveRoute() {
  const raw = window.location.hash
    .replace(/^#/, "")
    .split("?")[0]
    .trim();

  if (raw.startsWith("user/")) {
    const userId = decodeURIComponent(raw.slice("user/".length));

    if (userId) {
      return {
        key: "user-profile",
        path: raw,
        params: { userId },
      };
    }
  }

  const key = routes[raw] ? raw : "dashboard";

  return {
    key,
    path: key,
    params: {},
  };
}

function updateChrome(route) {
  const definition = routes[route.key];

  document.title = `${definition.title} · Novaris Control`;
  document.getElementById("page-title").textContent = definition.title;
  const breadcrumb = document.getElementById("breadcrumb-page");
  if (breadcrumb) breadcrumb.textContent = definition.title;
  document.getElementById("page-subtitle").textContent = definition.subtitle;

  document.querySelectorAll("[data-route]").forEach((button) => {
    const activeRoute =
      route.key === "user-profile" ? "users" : route.key;

    button.classList.toggle(
      "is-active",
      button.dataset.route === activeRoute,
    );
  });
}

export async function renderCurrentRoute(options = {}) {
  if (rendering) {
    return;
  }

  rendering = true;

  try {
    const route = resolveRoute();
    currentRoute = route.key;
    currentPath = route.path;
    updateChrome(route);

    const container = document.getElementById("app-view");
    await routes[route.key].render(container, options, route.params);
    container.focus({ preventScroll: true });
  } finally {
    rendering = false;
  }
}

export function navigate(path) {
  const requested = String(path || "dashboard").replace(/^#/, "");
  const isUserPath = requested.startsWith("user/");
  const resolved = isUserPath || routes[requested] ? requested : "dashboard";

  if (window.location.hash === `#${resolved}`) {
    renderCurrentRoute();
    return;
  }

  window.location.hash = resolved;
}

export function openUserProfile(userId) {
  navigate(`user/${encodeURIComponent(userId)}`);
}

export function getCurrentRoute() {
  return currentRoute;
}

export function getCurrentPath() {
  return currentPath;
}

export function initRouter() {
  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.route));
  });

  window.addEventListener("hashchange", () => {
    renderCurrentRoute();
  });

  if (!window.location.hash) {
    window.location.hash = "dashboard";
  } else {
    renderCurrentRoute();
  }
}
