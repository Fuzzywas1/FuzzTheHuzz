import { api } from "./api.js";
import {
  badge,
  emptyState,
  errorState,
  loadingState,
  panel,
} from "./components.js";
import { showToast } from "./toast.js";
import {
  escapeHtml,
  formatDate,
  setButtonBusy,
  statusClass,
} from "./utils.js";

let currentFilter = "all";
let editingAnnouncement = null;

const STYLE_LABELS = {
  info: "Info",
  success: "Success",
  warning: "Warning",
  critical: "Critical",
};

const AUDIENCE_LABELS = {
  all: "Everyone",
  users: "Signed-in users",
  moderators: "Moderators and above",
  admins: "Admins and owners",
  owners: "Owners only",
};

export async function renderAnnouncements(container) {
  container.innerHTML = loadingState("Loading announcements...");

  try {
    const payload = await api.announcements({ status: currentFilter });
    paint(container, payload);
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container.querySelector("[data-action='retry']")?.addEventListener("click", () => {
      renderAnnouncements(container);
    });
  }
}

function paint(container, payload) {
  const announcements = payload.announcements || [];
  const counts = payload.counts || {};

  container.innerHTML = `
    <div class="page-section">
      <div class="toolbar announcement-toolbar">
        <div class="section-tabs" role="tablist" aria-label="Announcement status">
          ${filterButton("all", "All", counts.all)}
          ${filterButton("active", "Active", counts.active)}
          ${filterButton("scheduled", "Scheduled", counts.scheduled)}
          ${filterButton("inactive", "Inactive", counts.inactive)}
          ${filterButton("expired", "Expired", counts.expired)}
        </div>

        <button class="button button-primary" id="new-announcement-button" type="button">
          <span class="button-icon">＋</span>
          New announcement
        </button>
      </div>

      ${panel({
        title: "Site announcements",
        subtitle: "Publish dismissible or permanent notices to selected audiences",
        body:
          announcements.length === 0
            ? emptyState(
                "No announcements found",
                currentFilter === "all"
                  ? "Create your first site announcement."
                  : `There are no ${currentFilter} announcements.`,
              )
            : `<div class="announcement-grid">${announcements
                .map(announcementCard)
                .join("")}</div>`,
      })}

      <div id="announcement-modal-root"></div>
    </div>
  `;

  container.querySelectorAll("[data-announcement-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.announcementFilter;
      renderAnnouncements(container);
    });
  });

  container.querySelector("#new-announcement-button")?.addEventListener("click", () => {
    editingAnnouncement = null;
    openEditor(container);
  });

  container.querySelectorAll("[data-edit-announcement]").forEach((button) => {
    button.addEventListener("click", () => {
      const announcement = announcements.find(
        (entry) => entry.id === button.dataset.editAnnouncement,
      );

      if (!announcement) return;
      editingAnnouncement = announcement;
      openEditor(container);
    });
  });

  container.querySelectorAll("[data-toggle-announcement]").forEach((button) => {
    button.addEventListener("click", async () => {
      const announcement = announcements.find(
        (entry) => entry.id === button.dataset.toggleAnnouncement,
      );

      if (!announcement) return;

      setButtonBusy(button, true, "Saving...");

      try {
        await api.updateAnnouncement(announcement.id, {
          active: !announcement.active,
        });

        showToast(
          announcement.active
            ? "The announcement was disabled."
            : "The announcement is now active.",
          "success",
          "Announcement updated",
        );

        await renderAnnouncements(container);
      } catch (error) {
        showToast(error.message, "error");
        setButtonBusy(button, false);
      }
    });
  });

  container.querySelectorAll("[data-delete-announcement]").forEach((button) => {
    button.addEventListener("click", async () => {
      const announcement = announcements.find(
        (entry) => entry.id === button.dataset.deleteAnnouncement,
      );

      if (!announcement) return;

      if (!window.confirm(`Delete “${announcement.title}”?`)) {
        return;
      }

      setButtonBusy(button, true, "Deleting...");

      try {
        await api.deleteAnnouncement(announcement.id);
        showToast("The announcement was deleted.", "success", "Deleted");
        await renderAnnouncements(container);
      } catch (error) {
        showToast(error.message, "error");
        setButtonBusy(button, false);
      }
    });
  });
}

function filterButton(value, label, count = 0) {
  return `
    <button
      class="section-tab ${currentFilter === value ? "is-active" : ""}"
      type="button"
      data-announcement-filter="${escapeHtml(value)}"
    >
      ${escapeHtml(label)}
      <span class="tab-count">${Number(count || 0)}</span>
    </button>
  `;
}

function announcementCard(announcement) {
  return `
    <article class="announcement-card announcement-style-${escapeHtml(
      announcement.style || "info",
    )}">
      <div class="announcement-card-topline">
        <div class="announcement-badges">
          ${badge(announcement.status || "unknown", statusClass(announcement.status))}
          ${badge(
            STYLE_LABELS[announcement.style] || "Info",
            styleBadgeClass(announcement.style),
          )}
          ${badge(
            AUDIENCE_LABELS[announcement.audience] || "Everyone",
            "badge-info",
          )}
        </div>

        <span class="announcement-created">
          Updated ${escapeHtml(formatDate(announcement.updatedAt))}
        </span>
      </div>

      <div class="announcement-copy">
        <h3>${escapeHtml(announcement.title)}</h3>
        <p>${escapeHtml(announcement.message)}</p>
      </div>

      <dl class="announcement-meta">
        <div>
          <dt>Starts</dt>
          <dd>${escapeHtml(formatDate(announcement.startsAt))}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>${escapeHtml(
            announcement.expiresAt ? formatDate(announcement.expiresAt) : "No expiration",
          )}</dd>
        </div>
        <div>
          <dt>Dismissal</dt>
          <dd>${announcement.dismissible ? "Users may dismiss" : "Permanent banner"}</dd>
        </div>
      </dl>

      <div class="announcement-actions">
        <button
          class="button button-small button-secondary"
          type="button"
          data-edit-announcement="${escapeHtml(announcement.id)}"
        >
          Edit
        </button>

        <button
          class="button button-small button-secondary"
          type="button"
          data-toggle-announcement="${escapeHtml(announcement.id)}"
        >
          ${announcement.active ? "Disable" : "Enable"}
        </button>

        <button
          class="button button-small button-danger"
          type="button"
          data-delete-announcement="${escapeHtml(announcement.id)}"
        >
          Delete
        </button>
      </div>
    </article>
  `;
}

function styleBadgeClass(style) {
  if (style === "success") return "badge-success";
  if (style === "warning") return "badge-warning";
  if (style === "critical") return "badge-danger";
  return "badge-info";
}

function openEditor(container) {
  const root = container.querySelector("#announcement-modal-root");
  const announcement = editingAnnouncement || {};

  root.innerHTML = `
    <div class="history-modal-backdrop" data-close-announcement-modal>
      <section class="history-modal announcement-editor" role="dialog" aria-modal="true">
        <header class="history-modal-header">
          <div>
            <p class="eyebrow">Novaris communications</p>
            <h2>${editingAnnouncement ? "Edit announcement" : "New announcement"}</h2>
            <span>Choose when, where and how the banner appears.</span>
          </div>

          <button
            class="icon-button"
            id="close-announcement-modal"
            type="button"
            aria-label="Close announcement editor"
          >
            ×
          </button>
        </header>

        <form class="announcement-form" id="announcement-form">
          <div class="form-grid">
            <label class="field-group field-span-two">
              <span>Title</span>
              <input
                class="field"
                id="announcement-title"
                maxlength="120"
                required
                value="${escapeHtml(announcement.title || "")}"
                placeholder="New Novaris AI update"
              />
            </label>

            <label class="field-group field-span-two">
              <span>Message</span>
              <textarea
                class="field textarea-field"
                id="announcement-message"
                maxlength="1200"
                required
                placeholder="Tell users what changed..."
              >${escapeHtml(announcement.message || "")}</textarea>
            </label>

            <label class="field-group">
              <span>Style</span>
              <select class="select-field" id="announcement-style">
                ${optionList(STYLE_LABELS, announcement.style || "info")}
              </select>
            </label>

            <label class="field-group">
              <span>Audience</span>
              <select class="select-field" id="announcement-audience">
                ${optionList(AUDIENCE_LABELS, announcement.audience || "all")}
              </select>
            </label>

            <label class="field-group">
              <span>Start time</span>
              <input
                class="field"
                id="announcement-start"
                type="datetime-local"
                value="${escapeHtml(toDateTimeLocal(announcement.startsAt || new Date()))}"
              />
            </label>

            <label class="field-group">
              <span>Expiration time</span>
              <input
                class="field"
                id="announcement-expiration"
                type="datetime-local"
                value="${escapeHtml(toDateTimeLocal(announcement.expiresAt))}"
              />
              <small>Leave empty to keep it until you disable it.</small>
            </label>
          </div>

          <div class="announcement-checkboxes">
            ${toggleRow(
              "announcement-active",
              "Active",
              "Allow this announcement to appear during its schedule.",
              announcement.active !== false,
            )}
            ${toggleRow(
              "announcement-dismissible",
              "Dismissible",
              "Allow users to hide this announcement on their device.",
              announcement.dismissible !== false,
            )}
          </div>

          <footer class="modal-footer">
            <button class="button button-ghost" id="cancel-announcement" type="button">
              Cancel
            </button>
            <button class="button button-primary" id="save-announcement" type="submit">
              ${editingAnnouncement ? "Save changes" : "Publish announcement"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  `;

  const close = () => {
    root.innerHTML = "";
    editingAnnouncement = null;
  };

  root.querySelector("#close-announcement-modal")?.addEventListener("click", close);
  root.querySelector("#cancel-announcement")?.addEventListener("click", close);
  root.querySelector("[data-close-announcement-modal]")?.addEventListener(
    "mousedown",
    (event) => {
      if (event.target.dataset.closeAnnouncementModal !== undefined) {
        close();
      }
    },
  );

  root.querySelector("#announcement-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const saveButton = root.querySelector("#save-announcement");
    const startsAt = dateInputToIso(root.querySelector("#announcement-start").value);
    const expiresAt = dateInputToIso(
      root.querySelector("#announcement-expiration").value,
    );

    if (expiresAt && startsAt && new Date(expiresAt) <= new Date(startsAt)) {
      showToast("Expiration must be after the start time.", "error");
      return;
    }

    const payload = {
      title: root.querySelector("#announcement-title").value.trim(),
      message: root.querySelector("#announcement-message").value.trim(),
      style: root.querySelector("#announcement-style").value,
      audience: root.querySelector("#announcement-audience").value,
      startsAt,
      expiresAt,
      active: root.querySelector("#announcement-active").checked,
      dismissible: root.querySelector("#announcement-dismissible").checked,
    };

    setButtonBusy(saveButton, true, "Saving...");

    try {
      if (editingAnnouncement) {
        await api.updateAnnouncement(editingAnnouncement.id, payload);
      } else {
        await api.createAnnouncement(payload);
      }

      showToast(
        editingAnnouncement
          ? "The announcement was updated."
          : "The announcement was created.",
        "success",
        "Announcement saved",
      );

      close();
      await renderAnnouncements(container);
    } catch (error) {
      showToast(error.message, "error");
      setButtonBusy(saveButton, false);
    }
  });
}

function toggleRow(id, title, description, checked) {
  return `
    <label class="toggle-setting" for="${escapeHtml(id)}">
      <span class="toggle-copy">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(description)}</span>
      </span>

      <span class="switch">
        <input id="${escapeHtml(id)}" type="checkbox" ${checked ? "checked" : ""} />
        <span class="switch-track"></span>
      </span>
    </label>
  `;
}

function optionList(options, selected) {
  return Object.entries(options)
    .map(
      ([value, label]) => `
        <option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>
          ${escapeHtml(label)}
        </option>
      `,
    )
    .join("");
}

function toDateTimeLocal(value) {
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function dateInputToIso(value) {
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
