import { api } from "./api.js";
import { initCommandPalette } from "./command-palette.js";
import {
  getCurrentRoute,
  initRouter,
  navigate,
  renderCurrentRoute,
} from "./router.js?v=2";
import { showToast } from "./toast.js";
import { initials, setButtonBusy } from "./utils.js";

let notificationRefreshTimer = null;
let heartbeatTimer = null;

async function initialize() {
  try {
    const account = await api.account();

    document.getElementById("account-name").textContent =
      account.username || account.email || "Owner";

    document.getElementById("account-role").textContent =
      account.role || "owner";

    document.getElementById("account-avatar").textContent =
      initials(account.username || account.email);
  } catch (error) {
    showToast(error.message, "error", "Account unavailable");
  }

  initRouter();
  initCommandPalette();
  bindGlobalActions();
  startLiveRefresh();
  startSecurityHeartbeat();
  startNotificationRefresh();
}

function bindGlobalActions() {
  const refreshButton = document.getElementById("refresh-button");

  refreshButton?.addEventListener("click", async () => {
    setButtonBusy(refreshButton, true, "Refreshing...");

    try {
      await renderCurrentRoute({ refresh: true });
      await refreshNotificationBadge();
      showToast("The current page was refreshed.", "success", "Updated");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setButtonBusy(refreshButton, false);
    }
  });

  document.getElementById("notification-button")?.addEventListener("click", () => {
    navigate("security");
  });

  document.getElementById("logout-button")?.addEventListener("click", async () => {
    if (!window.confirm("Sign out of Fuzz Control?")) {
      return;
    }

    try {
      await api.logout();
    } catch {
      // Cookies may already be cleared; continue to login.
    }

    window.location.href = "/login";
  });

  window.addEventListener("fuzz:notifications-changed", () => {
    refreshNotificationBadge();
  });
}

function setNotificationCount(count) {
  const safeCount = Math.max(0, Number(count) || 0);
  const text = safeCount > 99 ? "99+" : String(safeCount);

  for (const id of ["notification-count", "security-nav-count"]) {
    const element = document.getElementById(id);
    if (!element) continue;

    element.textContent = text;
    element.classList.toggle("is-hidden", safeCount === 0);
  }
}

async function refreshNotificationBadge() {
  try {
    const payload = await api.notifications({ limit: 1, page: 1 });
    setNotificationCount(payload.unreadCount || 0);
  } catch {
    // The badge is supplemental; do not interrupt the dashboard.
  }
}

function startNotificationRefresh() {
  refreshNotificationBadge();

  notificationRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") {
      refreshNotificationBadge();
    }
  }, 15000);
}

function startSecurityHeartbeat() {
  const heartbeat = () => {
    if (document.visibilityState !== "visible") return;
    api.securityHeartbeat().catch(() => {});
  };

  heartbeat();
  heartbeatTimer = window.setInterval(heartbeat, 90000);
}

function startLiveRefresh() {
  window.setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      getCurrentRoute() === "dashboard"
    ) {
      renderCurrentRoute({ refresh: true });
    }
  }, 5000);
}

window.addEventListener("beforeunload", () => {
  if (notificationRefreshTimer) window.clearInterval(notificationRefreshTimer);
  if (heartbeatTimer) window.clearInterval(heartbeatTimer);
});

initialize();
