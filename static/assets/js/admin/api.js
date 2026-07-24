async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  let payload = null;

  if (response.status !== 204) {
    payload = isJson
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");
  }

  if (response.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent("/admin")}`;
    throw new Error("Your session has expired.");
  }

  if (!response.ok) {
    const message =
      payload?.error ||
      (typeof payload === "string" && payload) ||
      `Request failed with status ${response.status}.`;

    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function withQuery(path, params = {}) {
  const url = new URL(path, window.location.origin);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return `${url.pathname}${url.search}`;
}

export const api = {
  account: () => request("/api/account/me"),

  logout: () =>
    request("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  dashboard: (refresh = false) =>
    request(withQuery("/api/admin/dashboard", refresh ? { refresh: 1 } : {})),

  stats: (days = 30) =>
    request(withQuery("/api/admin/stats", { days })),

  users: () => request("/api/admin/users"),

  updateRole: (userId, role) =>
    request(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),

  updateBan: (userId, banned) =>
    request(`/api/admin/users/${encodeURIComponent(userId)}/ban`, {
      method: "PATCH",
      body: JSON.stringify({ banned }),
    }),

  updateSuspension: (userId, suspension) =>
    request(`/api/admin/users/${encodeURIComponent(userId)}/suspension`, {
      method: "PATCH",
      body: JSON.stringify(suspension),
    }),

  usageSettings: () =>
    request("/api/admin/usage/settings"),

  updateUsagePolicy: (role, policy) =>
    request(`/api/admin/usage/settings/${encodeURIComponent(role)}`, {
      method: "PATCH",
      body: JSON.stringify(policy),
    }),

  userUsage: (userId) =>
    request(`/api/admin/users/${encodeURIComponent(userId)}/usage`),

  updateUserUsage: (userId, limits) =>
    request(`/api/admin/users/${encodeURIComponent(userId)}/usage`, {
      method: "PATCH",
      body: JSON.stringify(limits),
    }),

  clearUserUsageOverride: (userId) =>
    request(`/api/admin/users/${encodeURIComponent(userId)}/usage`, {
      method: "DELETE",
    }),

  resetUserUsage: (userId) =>
    request(`/api/admin/users/${encodeURIComponent(userId)}/usage/reset`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  activity: (params = {}) =>
    request(withQuery("/api/admin/activity", params)),

  system: () => request("/api/admin/system"),

  platformSettings: () =>
    request("/api/admin/platform/settings"),

  updatePlatformSettings: (settings) =>
    request("/api/admin/platform/settings", {
      method: "PATCH",
      body: JSON.stringify(settings),
    }),

  announcements: (params = {}) =>
    request(withQuery("/api/admin/announcements", params)),

  createAnnouncement: (announcement) =>
    request("/api/admin/announcements", {
      method: "POST",
      body: JSON.stringify(announcement),
    }),

  updateAnnouncement: (announcementId, announcement) =>
    request(
      `/api/admin/announcements/${encodeURIComponent(announcementId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(announcement),
      },
    ),

  deleteAnnouncement: (announcementId) =>
    request(
      `/api/admin/announcements/${encodeURIComponent(announcementId)}`,
      { method: "DELETE" },
    ),

  clearCache: () =>
    request("/api/admin/cache/clear", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  invites: () => request("/api/admin/invites"),

  createInvites: ({ code = "", amount = 1 }) =>
    request("/api/admin/invites", {
      method: "POST",
      body: JSON.stringify({ code, amount }),
    }),

  deleteInvite: (inviteId) =>
    request(`/api/admin/invites/${encodeURIComponent(inviteId)}`, {
      method: "DELETE",
    }),

  aiAnalytics: (days = 30) =>
    request(withQuery("/api/admin/ai/analytics", { days })),

  proxyAnalytics: (days = 30) =>
    request(withQuery("/api/admin/proxy/analytics", { days })),

  aiHistory: (params = {}) =>
    request(withQuery("/api/admin/ai/history", params)),

  aiChatDetails: (chatId) =>
    request(`/api/admin/ai/history/${encodeURIComponent(chatId)}`),

  proxyHistory: (params = {}) =>
    request(withQuery("/api/admin/proxy/history", params)),

  userProfile: (userId) =>
    request(`/api/admin/users/${encodeURIComponent(userId)}/profile`),

  userActivity: (userId, params = {}) =>
    request(
      withQuery(
        `/api/admin/users/${encodeURIComponent(userId)}/activity`,
        params,
      ),
    ),

  userAiChats: (userId, params = {}) =>
    request(
      withQuery(
        `/api/admin/users/${encodeURIComponent(userId)}/ai-chats`,
        params,
      ),
    ),

  userProxyHistory: (userId, params = {}) =>
    request(
      withQuery(
        `/api/admin/users/${encodeURIComponent(userId)}/proxy-history`,
        params,
      ),
    ),

  securityHeartbeat: () =>
    request("/api/auth/security/heartbeat", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  notifications: (params = {}) =>
    request(withQuery("/api/admin/notifications", params)),

  markNotificationRead: (notificationId) =>
    request(
      `/api/admin/notifications/${encodeURIComponent(notificationId)}/read`,
      {
        method: "PATCH",
        body: JSON.stringify({}),
      },
    ),

  dismissNotification: (notificationId) =>
    request(
      `/api/admin/notifications/${encodeURIComponent(notificationId)}/dismiss`,
      {
        method: "PATCH",
        body: JSON.stringify({}),
      },
    ),

  markAllNotificationsRead: () =>
    request("/api/admin/notifications/read-all", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  securityOverview: () =>
    request("/api/admin/security/overview"),

  securitySessions: (params = {}) =>
    request(withQuery("/api/admin/security/sessions", params)),

  userSecuritySessions: (userId) =>
    request(
      `/api/admin/security/users/${encodeURIComponent(userId)}/sessions`,
    ),

  revokeSecuritySession: (sessionId, reason = "Revoked by owner") =>
    request(
      `/api/admin/security/sessions/${encodeURIComponent(sessionId)}/revoke`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      },
    ),

  revokeUserSessions: (userId, exceptCurrent = false) =>
    request(
      `/api/admin/security/users/${encodeURIComponent(userId)}/revoke-all`,
      {
        method: "POST",
        body: JSON.stringify({ exceptCurrent }),
      },
    ),

  exportsSummary: () =>
    request("/api/admin/exports/summary"),

  exportDownloadUrl: (dataset, format = "json", params = {}) =>
    withQuery("/api/admin/exports/download", {
      dataset,
      format,
      ...params,
    }),

  search: (query = "") =>
    request(withQuery("/api/admin/search", { q: query })),
};
