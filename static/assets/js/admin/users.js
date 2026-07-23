import { api } from "./api.js";
import {
  badge,
  emptyState,
  errorState,
  loadingState,
  panel,
} from "./components.js";
import { showToast } from "./toast.js";
import { openUserProfile } from "./router.js";
import {
  escapeHtml,
  formatDate,
  initials,
  setButtonBusy,
} from "./utils.js";

let users = [];

export async function renderUsers(container) {
  container.innerHTML = loadingState("Loading users...");

  try {
    const payload = await api.users();
    users = payload.users || [];
    paint(container);
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container
      .querySelector("[data-action='retry']")
      ?.addEventListener("click", () => {
        renderUsers(container);
      });
  }
}

function paint(container) {
  container.innerHTML = `
    <div class="page-section">
      <div class="toolbar">
        <div class="toolbar-group">
          <input
            class="field search-field"
            id="user-search"
            type="search"
            placeholder="Search username or email..."
          />

          <select class="select-field" id="role-filter">
            <option value="">All roles</option>
            <option value="owner">Owners</option>
            <option value="admin">Admins</option>
            <option value="moderator">Moderators</option>
            <option value="user">Users</option>
          </select>

          <select class="select-field" id="status-filter">
            <option value="">All accounts</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="banned">Banned</option>
            <option value="verified">Verified</option>
            <option value="unverified">Unverified</option>
          </select>
        </div>

        <span class="badge badge-info" id="user-count">
          ${users.length} users
        </span>
      </div>

      ${panel({
        title: "User directory",
        subtitle: "Manage access, roles, suspensions and bans",
        flush: true,
        body: `<div id="users-table"></div>`,
      })}

      <div id="users-modal-root"></div>
    </div>
  `;

  const search = container.querySelector("#user-search");
  const roleFilter = container.querySelector("#role-filter");
  const statusFilter = container.querySelector("#status-filter");

  const update = () => {
    renderTable(
      container,
      search.value,
      roleFilter.value,
      statusFilter.value,
    );
  };

  search.addEventListener("input", update);
  roleFilter.addEventListener("change", update);
  statusFilter.addEventListener("change", update);

  const pendingSearch = sessionStorage.getItem(
    "fuzz-admin-user-search",
  );

  if (pendingSearch) {
    search.value = pendingSearch;
    sessionStorage.removeItem(
      "fuzz-admin-user-search",
    );
  }

  update();
}

function renderTable(
  container,
  searchValue,
  roleValue,
  statusValue,
) {
  const normalized = searchValue
    .trim()
    .toLowerCase();

  const filtered = users.filter((user) => {
    const matchesSearch =
      !normalized ||
      String(user.username || "")
        .toLowerCase()
        .includes(normalized) ||
      String(user.email || "")
        .toLowerCase()
        .includes(normalized);

    const matchesRole =
      !roleValue || user.role === roleValue;

    const matchesStatus =
      !statusValue ||
      (statusValue === "banned" && user.banned) ||
      (statusValue === "suspended" &&
        user.suspended &&
        !user.banned) ||
      (statusValue === "active" &&
        !user.banned &&
        !user.suspended) ||
      (statusValue === "verified" &&
        user.emailVerified) ||
      (statusValue === "unverified" &&
        !user.emailVerified);

    return (
      matchesSearch &&
      matchesRole &&
      matchesStatus
    );
  });

  container.querySelector(
    "#user-count",
  ).textContent = `${filtered.length} users`;

  const table = container.querySelector(
    "#users-table",
  );

  if (filtered.length === 0) {
    table.innerHTML = emptyState(
      "No users found",
      "Try changing your search or filters.",
    );
    return;
  }

  table.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Status</th>
            <th>Verified</th>
            <th>Last sign-in</th>
            <th>Created</th>
            <th style="text-align:right">Actions</th>
          </tr>
        </thead>

        <tbody>
          ${filtered.map(userRow).join("")}
        </tbody>
      </table>
    </div>
  `;

  table
    .querySelectorAll("[data-open-user]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        openUserProfile(button.dataset.openUser);
      });
    });

  table
    .querySelectorAll("[data-role-select]")
    .forEach((select) => {
      select.addEventListener(
        "change",
        async () => {
          const userId =
            select.dataset.roleSelect;
          const user = users.find(
            (item) => item.id === userId,
          );
          const previousRole = user?.role;
          const nextRole = select.value;

          if (
            !user ||
            previousRole === nextRole
          ) {
            return;
          }

          const confirmed = window.confirm(
            `Change ${user.username || user.email}'s role from ${previousRole} to ${nextRole}?`,
          );

          if (!confirmed) {
            select.value = previousRole;
            return;
          }

          select.disabled = true;

          try {
            const result =
              await api.updateRole(
                userId,
                nextRole,
              );
            user.role = result.profile.role;

            showToast(
              `${user.username || user.email} is now ${result.profile.role}.`,
              "success",
              "Role updated",
            );
          } catch (error) {
            select.value = previousRole;
            showToast(error.message, "error");
          } finally {
            select.disabled = false;
          }
        },
      );
    });

  table
    .querySelectorAll("[data-suspend-button]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const user = users.find(
          (item) =>
            item.id ===
            button.dataset.suspendButton,
        );

        if (!user) return;

        openSuspensionModal(
          container,
          user,
          () => {
            renderTable(
              container,
              searchValue,
              roleValue,
              statusValue,
            );
          },
        );
      });
    });

  table
    .querySelectorAll("[data-ban-button]")
    .forEach((button) => {
      button.addEventListener(
        "click",
        async () => {
          const userId =
            button.dataset.banButton;
          const user = users.find(
            (item) => item.id === userId,
          );

          if (!user) return;

          const nextBanned = !user.banned;
          const verb = nextBanned
            ? "ban"
            : "unban";

          if (
            !window.confirm(
              `${verb[0].toUpperCase()}${verb.slice(1)} ${user.username || user.email}?`,
            )
          ) {
            return;
          }

          setButtonBusy(
            button,
            true,
            nextBanned
              ? "Banning..."
              : "Unbanning...",
          );

          try {
            const result =
              await api.updateBan(
                userId,
                nextBanned,
              );
            user.banned =
              result.profile.banned;

            showToast(
              `${user.username || user.email} was ${user.banned ? "banned" : "unbanned"}.`,
              "success",
              "Account updated",
            );

            renderTable(
              container,
              searchValue,
              roleValue,
              statusValue,
            );
          } catch (error) {
            showToast(error.message, "error");
          } finally {
            setButtonBusy(button, false);
          }
        },
      );
    });
}

function userStatus(user) {
  if (user.banned) {
    return badge("Banned", "badge-danger");
  }

  if (user.suspended) {
    return `
      <span title="Until ${escapeHtml(formatDate(user.suspendedUntil))}">
        ${badge("Suspended", "badge-warning")}
      </span>
    `;
  }

  return badge("Active", "badge-success");
}

function userRow(user) {
  const roleOptions = [
    "user",
    "moderator",
    "admin",
    "owner",
  ]
    .map(
      (role) => `
        <option value="${role}" ${user.role === role ? "selected" : ""}>
          ${role}
        </option>
      `,
    )
    .join("");

  return `
    <tr>
      <td>
        <button
          class="table-primary user-profile-link"
          type="button"
          data-open-user="${escapeHtml(user.id)}"
        >
          <span class="table-avatar">${escapeHtml(initials(user.username || user.email))}</span>

          <span class="table-primary-copy">
            <strong>${escapeHtml(user.username || "No username")}</strong>
            <span>${escapeHtml(user.email || "No email")}</span>
          </span>
        </button>
      </td>

      <td>
        <select
          class="select-field"
          data-role-select="${escapeHtml(user.id)}"
          style="min-height:32px;padding:0 9px"
        >
          ${roleOptions}
        </select>
      </td>

      <td>${userStatus(user)}</td>

      <td>
        ${
          user.emailVerified
            ? badge(
                "Verified",
                "badge-success",
              )
            : badge(
                "Unverified",
                "badge-warning",
              )
        }
      </td>

      <td>${escapeHtml(formatDate(user.lastSignInAt))}</td>
      <td>${escapeHtml(formatDate(user.createdAt))}</td>

      <td style="text-align:right">
        <div class="table-actions">
          <button
            class="button button-small button-secondary"
            type="button"
            data-open-user="${escapeHtml(user.id)}"
          >
            View
          </button>

          <button
            class="button button-small button-warning"
            type="button"
            data-suspend-button="${escapeHtml(user.id)}"
            ${user.role === "owner" ? "disabled" : ""}
          >
            ${user.suspended ? "Manage suspension" : "Suspend"}
          </button>

          <button
            class="button button-small ${user.banned ? "button-secondary" : "button-danger"}"
            type="button"
            data-ban-button="${escapeHtml(user.id)}"
            ${user.role === "owner" ? "disabled" : ""}
          >
            ${user.banned ? "Unban" : "Ban"}
          </button>
        </div>
      </td>
    </tr>
  `;
}

function localDateTimeValue(value) {
  const date = value
    ? new Date(value)
    : new Date(Date.now() + 24 * 60 * 60 * 1000);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const shifted = new Date(
    date.getTime() -
      date.getTimezoneOffset() * 60 * 1000,
  );

  return shifted.toISOString().slice(0, 16);
}

function openSuspensionModal(
  container,
  user,
  onComplete,
) {
  const root = container.querySelector(
    "#users-modal-root",
  );

  root.innerHTML = `
    <div class="history-modal-backdrop" data-suspension-backdrop>
      <section class="history-modal suspension-modal" role="dialog" aria-modal="true">
        <header class="history-modal-header">
          <div>
            <p class="eyebrow">Temporary account restriction</p>
            <h2>${escapeHtml(user.suspended ? "Manage suspension" : "Suspend account")}</h2>
            <span>${escapeHtml(user.username || user.email || "User")}</span>
          </div>

          <button class="icon-button" id="suspension-modal-close" type="button">×</button>
        </header>

        <form class="suspension-form" id="suspension-form">
          ${
            user.suspended
              ? `
                <div class="suspension-current">
                  <strong>Currently suspended</strong>
                  <span>Until ${escapeHtml(formatDate(user.suspendedUntil))}</span>
                  <p>${escapeHtml(user.suspensionReason || "No reason recorded.")}</p>
                </div>
              `
              : ""
          }

          <label class="form-field">
            <span>Duration</span>
            <select class="select-field" id="suspension-duration">
              <option value="15">15 minutes</option>
              <option value="60">1 hour</option>
              <option value="360">6 hours</option>
              <option value="1440" selected>1 day</option>
              <option value="4320">3 days</option>
              <option value="10080">7 days</option>
              <option value="43200">30 days</option>
              <option value="custom">Custom date and time</option>
            </select>
          </label>

          <label class="form-field is-hidden" id="suspension-custom-wrap">
            <span>Suspended until</span>
            <input
              class="field"
              id="suspension-custom-until"
              type="datetime-local"
              value="${escapeHtml(localDateTimeValue(user.suspendedUntil))}"
            />
          </label>

          <label class="form-field">
            <span>Reason</span>
            <textarea
              class="field textarea-field"
              id="suspension-reason"
              maxlength="500"
              required
              placeholder="Explain why this account is being suspended..."
            >${escapeHtml(user.suspensionReason || "")}</textarea>
          </label>

          <p class="form-help">
            The account stays signed in, but protected pages and APIs are blocked until the timer expires or you remove the suspension.
          </p>

          <div class="modal-actions">
            ${
              user.suspended
                ? `
                  <button class="button button-secondary" id="remove-suspension" type="button">
                    Unsuspend now
                  </button>
                `
                : ""
            }

            <button class="button button-ghost" id="cancel-suspension" type="button">
              Cancel
            </button>

            <button class="button button-warning" id="save-suspension" type="submit">
              ${user.suspended ? "Update suspension" : "Suspend account"}
            </button>
          </div>
        </form>
      </section>
    </div>
  `;

  const close = () => {
    root.innerHTML = "";
  };

  root
    .querySelector("#suspension-modal-close")
    ?.addEventListener("click", close);
  root
    .querySelector("#cancel-suspension")
    ?.addEventListener("click", close);
  root
    .querySelector("[data-suspension-backdrop]")
    ?.addEventListener("mousedown", (event) => {
      if (
        event.target.dataset
          .suspensionBackdrop !== undefined
      ) {
        close();
      }
    });

  const durationSelect = root.querySelector(
    "#suspension-duration",
  );
  const customWrap = root.querySelector(
    "#suspension-custom-wrap",
  );

  durationSelect.addEventListener(
    "change",
    () => {
      customWrap.classList.toggle(
        "is-hidden",
        durationSelect.value !== "custom",
      );
    },
  );

  root
    .querySelector("#remove-suspension")
    ?.addEventListener("click", async (event) => {
      if (
        !window.confirm(
          `Unsuspend ${user.username || user.email} now?`,
        )
      ) {
        return;
      }

      const button = event.currentTarget;
      setButtonBusy(button, true, "Removing...");

      try {
        const result =
          await api.updateSuspension(
            user.id,
            {
              suspendedUntil: null,
              reason: "",
            },
          );

        applySuspensionResult(user, result.profile);
        showToast(
          `${user.username || user.email} was unsuspended.`,
          "success",
          "Suspension removed",
        );
        close();
        onComplete?.();
      } catch (error) {
        showToast(error.message, "error");
        setButtonBusy(button, false);
      }
    });

  root
    .querySelector("#suspension-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();

      const reason = root
        .querySelector("#suspension-reason")
        .value.trim();
      let suspendedUntil;

      if (durationSelect.value === "custom") {
        const customValue = root.querySelector(
          "#suspension-custom-until",
        ).value;
        const parsed = new Date(customValue);

        if (!Number.isFinite(parsed.getTime())) {
          showToast(
            "Choose a valid suspension expiration time.",
            "error",
          );
          return;
        }

        suspendedUntil = parsed.toISOString();
      } else {
        const minutes = Number(
          durationSelect.value,
        );
        suspendedUntil = new Date(
          Date.now() + minutes * 60 * 1000,
        ).toISOString();
      }

      const button = root.querySelector(
        "#save-suspension",
      );
      setButtonBusy(button, true, "Saving...");

      try {
        const result =
          await api.updateSuspension(
            user.id,
            {
              suspendedUntil,
              reason,
            },
          );

        applySuspensionResult(user, result.profile);
        showToast(
          `${user.username || user.email} is suspended until ${formatDate(suspendedUntil)}.`,
          "success",
          "Account suspended",
        );
        close();
        onComplete?.();
      } catch (error) {
        showToast(error.message, "error");
        setButtonBusy(button, false);
      }
    });
}

function applySuspensionResult(user, profile) {
  user.suspended = profile.suspended;
  user.suspendedUntil =
    profile.suspendedUntil;
  user.suspensionReason =
    profile.suspensionReason;
  user.suspensionSource =
    profile.suspensionSource;
}
