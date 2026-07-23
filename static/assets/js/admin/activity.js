import { api } from "./api.js";
import {
  badge,
  emptyState,
  errorState,
  loadingState,
  panel,
} from "./components.js";
import {
  activityIcon,
  escapeHtml,
  formatDate,
  statusClass,
} from "./utils.js";

let state = {
  page: 1,
  limit: 50,
  category: "",
  status: "",
  search: "",
};

export async function renderActivity(container) {
  container.innerHTML = loadingState("Loading activity logs...");
  await load(container);
}

async function load(container) {
  try {
    const payload = await api.activity(state);
    paint(container, payload);
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container.querySelector("[data-action='retry']")?.addEventListener("click", () => {
      load(container);
    });
  }
}

function paint(container, payload) {
  const logs = payload.logs || [];
  const pagination = payload.pagination || {
    page: 1,
    totalPages: 1,
    total: logs.length,
  };

  container.innerHTML = `
    <div class="page-section">
      <form class="toolbar" id="activity-filter-form">
        <div class="toolbar-group">
          <input
            class="field search-field"
            id="activity-search"
            type="search"
            value="${escapeHtml(state.search)}"
            placeholder="Search descriptions or actions..."
          />

          <select class="select-field" id="activity-category">
            <option value="">All categories</option>
            ${["auth", "admin", "ai", "proxy", "page", "system"]
              .map(
                (category) => `
                  <option value="${category}" ${state.category === category ? "selected" : ""}>
                    ${category}
                  </option>
                `,
              )
              .join("")}
          </select>

          <select class="select-field" id="activity-status">
            <option value="">All statuses</option>
            ${["success", "failure", "informational"]
              .map(
                (status) => `
                  <option value="${status}" ${state.status === status ? "selected" : ""}>
                    ${status}
                  </option>
                `,
              )
              .join("")}
          </select>

          <button class="button button-secondary" type="submit">Apply</button>
        </div>

        <span class="badge badge-info">${pagination.total} logs</span>
      </form>

      ${panel({
        title: "Activity audit trail",
        subtitle: "Authentication, admin, AI and proxy events",
        flush: true,
        body:
          logs.length === 0
            ? emptyState("No activity found", "Try changing the filters.")
            : `
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Category</th>
                      <th>Status</th>
                      <th>Client</th>
                      <th>Response</th>
                      <th>Time</th>
                    </tr>
                  </thead>

                  <tbody>
                    ${logs.map(logRow).join("")}
                  </tbody>
                </table>
              </div>

              <div class="pager">
                <span>
                  Page ${pagination.page} of ${pagination.totalPages}
                </span>

                <div class="pager-actions">
                  <button
                    class="button button-small button-secondary"
                    type="button"
                    data-page="previous"
                    ${pagination.page <= 1 ? "disabled" : ""}
                  >
                    Previous
                  </button>

                  <button
                    class="button button-small button-secondary"
                    type="button"
                    data-page="next"
                    ${pagination.page >= pagination.totalPages ? "disabled" : ""}
                  >
                    Next
                  </button>
                </div>
              </div>
            `,
      })}
    </div>
  `;

  container
    .querySelector("#activity-filter-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();

      state = {
        ...state,
        page: 1,
        search: container.querySelector("#activity-search").value.trim(),
        category: container.querySelector("#activity-category").value,
        status: container.querySelector("#activity-status").value,
      };

      container.innerHTML = loadingState("Filtering activity logs...");
      load(container);
    });

  container.querySelector("[data-page='previous']")?.addEventListener("click", () => {
    state.page = Math.max(1, state.page - 1);
    container.innerHTML = loadingState("Loading previous page...");
    load(container);
  });

  container.querySelector("[data-page='next']")?.addEventListener("click", () => {
    state.page += 1;
    container.innerHTML = loadingState("Loading next page...");
    load(container);
  });
}

function logRow(log) {
  return `
    <tr>
      <td>
        <div class="table-primary">
          <span class="table-avatar">
            ${escapeHtml(activityIcon(log.category, log.action))}
          </span>

          <span class="table-primary-copy">
            <strong>${escapeHtml(log.description || log.action || "Activity event")}</strong>
            <span>${escapeHtml(log.action || "unknown")}</span>
          </span>
        </div>
      </td>

      <td>${badge(log.category || "unknown", "badge-info")}</td>
      <td>${badge(log.status || "unknown", statusClass(log.status))}</td>

      <td>
        <span class="table-primary-copy">
          <strong>${escapeHtml(log.browser || "Unknown browser")}</strong>
          <span>${escapeHtml(`${log.operating_system || "Unknown OS"} · ${log.device_type || "device"}`)}</span>
        </span>
      </td>

      <td>${log.response_status ?? "—"}</td>
      <td>${escapeHtml(formatDate(log.created_at))}</td>
    </tr>
  `;
}
