let adminUsers = [];
let currentAccount = null;
let requestInProgress = false;

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    const refreshButton =
      document.getElementById(
        "refresh-admin-button",
      );

    const searchInput =
      document.getElementById(
        "user-search",
      );

    refreshButton?.addEventListener(
      "click",
      async () => {
        await loadAdminDashboard();
      },
    );

    searchInput?.addEventListener(
      "input",
      () => {
        renderUsers();
      },
    );

    await loadAdminDashboard();
  },
);

async function loadAdminDashboard() {
  if (requestInProgress) {
    return;
  }

  requestInProgress = true;
  setDashboardLoading(true);
  showStatus("", "");

  try {
    const [
      accountResponse,
      usersResponse,
    ] = await Promise.all([
      fetch("/api/account/me", {
        credentials: "same-origin",
      }),
      fetch("/api/admin/users", {
        credentials: "same-origin",
      }),
    ]);

    const accountResult =
      await accountResponse
        .json()
        .catch(() => ({
          error:
            "Invalid account response.",
        }));

    const usersResult =
      await usersResponse
        .json()
        .catch(() => ({
          error:
            "Invalid users response.",
        }));

    if (!accountResponse.ok) {
      throw new Error(
        accountResult.error ||
          "Your account could not be loaded.",
      );
    }

    if (!usersResponse.ok) {
      throw new Error(
        usersResult.error ||
          "Users could not be loaded.",
      );
    }

    currentAccount = accountResult;
    adminUsers =
      Array.isArray(usersResult.users)
        ? usersResult.users
        : [];

    updateStats();
    renderUsers();

    showStatus(
      "Dashboard refreshed.",
      "success",
    );
  } catch (error) {
    console.error(
      "Admin dashboard failed:",
      error,
    );

    showStatus(
      error.message ||
        "The dashboard could not be loaded.",
      "error",
    );

    renderTableMessage(
      "The user list could not be loaded.",
    );
  } finally {
    requestInProgress = false;
    setDashboardLoading(false);
  }
}

function updateStats() {
  const total = adminUsers.length;

  const verified =
    adminUsers.filter(
      (user) => user.emailVerified,
    ).length;

  const owners =
    adminUsers.filter(
      (user) => user.role === "owner",
    ).length;

  const admins =
    adminUsers.filter(
      (user) => user.role === "admin",
    ).length;

  const moderators =
    adminUsers.filter(
      (user) => user.role === "moderator",
    ).length;

  const banned =
    adminUsers.filter(
      (user) => user.banned,
    ).length;

  setText("stat-total-users", total);
  setText("stat-verified-users", verified);
  setText("stat-owners", owners);
  setText("stat-admins", admins);
  setText("stat-moderators", moderators);
  setText("stat-banned-users", banned);
}

function renderUsers() {
  const tbody =
    document.getElementById(
      "users-table-body",
    );

  const search =
    document.getElementById(
      "user-search",
    );

  if (!tbody) {
    return;
  }

  const query =
    String(search?.value || "")
      .trim()
      .toLowerCase();

  const visibleUsers =
    adminUsers.filter((user) => {
      const username =
        String(user.username || "")
          .toLowerCase();

      const email =
        String(user.email || "")
          .toLowerCase();

      return (
        !query ||
        username.includes(query) ||
        email.includes(query)
      );
    });

  tbody.innerHTML = "";

  if (visibleUsers.length === 0) {
    renderTableMessage(
      "No matching users found.",
    );
    return;
  }

  visibleUsers.forEach((user) => {
    tbody.appendChild(
      buildUserRow(user),
    );
  });
}

function buildUserRow(user) {
  const row =
    document.createElement("tr");

  const userCell =
    document.createElement("td");

  const userPrimary =
    document.createElement("div");

  userPrimary.className = "user-primary";

  const username =
    document.createElement("strong");

  username.textContent =
    user.username || "No username";

  const userId =
    document.createElement("span");

  userId.className = "user-id";
  userId.textContent = user.id;
  userId.title = user.id;

  userPrimary.append(username, userId);
  userCell.appendChild(userPrimary);

  const emailCell =
    document.createElement("td");

  emailCell.textContent =
    user.email || "No email";

  const roleCell =
    document.createElement("td");

  const roleSelect =
    document.createElement("select");

  roleSelect.className = "admin-select";

  [
    "user",
    "moderator",
    "admin",
    "owner",
  ].forEach((role) => {
    const option =
      document.createElement("option");

    option.value = role;
    option.textContent =
      capitalize(role);

    if (user.role === role) {
      option.selected = true;
    }

    roleSelect.appendChild(option);
  });

  const isCurrentUser =
    user.id === currentAccount?.id;

  roleSelect.disabled =
    isCurrentUser ||
    requestInProgress;

  roleSelect.addEventListener(
    "change",
    async () => {
      const previousRole = user.role;
      const nextRole = roleSelect.value;

      const confirmed =
        window.confirm(
          `Change ${user.username || user.email} from ${previousRole} to ${nextRole}?`,
        );

      if (!confirmed) {
        roleSelect.value =
          previousRole;
        return;
      }

      try {
        await updateUserRole(
          user.id,
          nextRole,
        );
      } catch {
        roleSelect.value =
          previousRole;
      }
    },
  );

  roleCell.appendChild(roleSelect);

  const verifiedCell =
    document.createElement("td");

  verifiedCell.appendChild(
    createBadge(
      user.emailVerified
        ? "Verified"
        : "Unverified",
      user.emailVerified
        ? "verified"
        : "unverified",
    ),
  );

  const joinedCell =
    document.createElement("td");

  joinedCell.textContent =
    formatDate(user.createdAt);

  const signInCell =
    document.createElement("td");

  signInCell.textContent =
    formatDate(user.lastSignInAt);

  const statusCell =
    document.createElement("td");

  statusCell.appendChild(
    createBadge(
      user.banned
        ? "Banned"
        : "Active",
      user.banned
        ? "banned"
        : "active",
    ),
  );

  const actionsCell =
    document.createElement("td");

  const actions =
    document.createElement("div");

  actions.className = "user-actions";

  const banButton =
    document.createElement("button");

  banButton.type = "button";

  banButton.className =
    user.banned
      ? "admin-action-button success"
      : "admin-action-button danger";

  banButton.textContent =
    user.banned
      ? "Unban"
      : "Ban";

  banButton.disabled =
    isCurrentUser ||
    user.role === "owner" ||
    requestInProgress;

  banButton.addEventListener(
    "click",
    async () => {
      const nextBanned =
        !user.banned;

      const confirmed =
        window.confirm(
          `${nextBanned ? "Ban" : "Unban"} ${user.username || user.email}?`,
        );

      if (!confirmed) {
        return;
      }

      await updateUserBan(
        user.id,
        nextBanned,
      );
    },
  );

  actions.appendChild(banButton);
  actionsCell.appendChild(actions);

  row.append(
    userCell,
    emailCell,
    roleCell,
    verifiedCell,
    joinedCell,
    signInCell,
    statusCell,
    actionsCell,
  );

  return row;
}

async function updateUserRole(
  userId,
  role,
) {
  setDashboardLoading(true);

  try {
    const response = await fetch(
      `/api/admin/users/${encodeURIComponent(
        userId,
      )}/role`,
      {
        method: "PATCH",
        headers: {
          "Content-Type":
            "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          role,
        }),
      },
    );

    const result =
      await response
        .json()
        .catch(() => ({
          error:
            "Invalid role response.",
        }));

    if (!response.ok) {
      throw new Error(
        result.error ||
          "The role could not be changed.",
      );
    }

    adminUsers =
      adminUsers.map((user) => {
        return user.id === userId
          ? {
              ...user,
              role:
                result.profile?.role ||
                role,
            }
          : user;
      });

    updateStats();
    renderUsers();

    showStatus(
      "Role updated successfully.",
      "success",
    );
  } catch (error) {
    console.error(
      "Role update failed:",
      error,
    );

    showStatus(
      error.message ||
        "The role could not be changed.",
      "error",
    );

    throw error;
  } finally {
    setDashboardLoading(false);
  }
}

async function updateUserBan(
  userId,
  banned,
) {
  setDashboardLoading(true);

  try {
    const response = await fetch(
      `/api/admin/users/${encodeURIComponent(
        userId,
      )}/ban`,
      {
        method: "PATCH",
        headers: {
          "Content-Type":
            "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          banned,
        }),
      },
    );

    const result =
      await response
        .json()
        .catch(() => ({
          error:
            "Invalid ban response.",
        }));

    if (!response.ok) {
      throw new Error(
        result.error ||
          "The account status could not be changed.",
      );
    }

    adminUsers =
      adminUsers.map((user) => {
        return user.id === userId
          ? {
              ...user,
              banned:
                result.profile?.banned ??
                banned,
            }
          : user;
      });

    updateStats();
    renderUsers();

    showStatus(
      banned
        ? "User banned."
        : "User unbanned.",
      "success",
    );
  } catch (error) {
    console.error(
      "Ban update failed:",
      error,
    );

    showStatus(
      error.message ||
        "The account status could not be changed.",
      "error",
    );
  } finally {
    setDashboardLoading(false);
  }
}

function createBadge(text, className) {
  const badge =
    document.createElement("span");

  badge.className =
    `status-badge ${className}`;

  badge.textContent = text;

  return badge;
}

function renderTableMessage(message) {
  const tbody =
    document.getElementById(
      "users-table-body",
    );

  if (!tbody) {
    return;
  }

  tbody.innerHTML = "";

  const row =
    document.createElement("tr");

  const cell =
    document.createElement("td");

  cell.colSpan = 8;
  cell.className = "table-empty";
  cell.textContent = message;

  row.appendChild(cell);
  tbody.appendChild(row);
}

function setDashboardLoading(loading) {
  const refreshButton =
    document.getElementById(
      "refresh-admin-button",
    );

  if (refreshButton) {
    refreshButton.disabled = loading;
    refreshButton.textContent =
      loading
        ? "Loading..."
        : "Refresh";
  }
}

function showStatus(message, type) {
  const status =
    document.getElementById(
      "admin-status",
    );

  if (!status) {
    return;
  }

  status.textContent = message;

  status.className =
    message
      ? `admin-status visible ${type}`
      : "admin-status";
}

function setText(id, value) {
  const element =
    document.getElementById(id);

  if (element) {
    element.textContent =
      String(value);
  }
}

function formatDate(value) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);

  if (
    Number.isNaN(date.getTime())
  ) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(date);
}

function capitalize(value) {
  const text = String(value || "");

  return (
    text.charAt(0).toUpperCase() +
    text.slice(1)
  );
}