import {
  activityIcon,
  escapeHtml,
  formatNumber,
  relativeTime,
  statusClass,
} from "./utils.js";

export function loadingState(message = "Loading...") {
  return `
    <div class="page-loading">
      <span class="spinner"></span>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

export function errorState(message, retryLabel = "Try again") {
  return `
    <div class="page-error">
      <h3>Something went wrong</h3>
      <p>${escapeHtml(message)}</p>
      <button class="button button-secondary" type="button" data-action="retry">
        ${escapeHtml(retryLabel)}
      </button>
    </div>
  `;
}

export function emptyState(title, description) {
  return `
    <div class="empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
    </div>
  `;
}

export function badge(label, variant = "") {
  return `
    <span class="badge ${variant}">
      ${escapeHtml(label)}
    </span>
  `;
}

export function statCard({
  label,
  value,
  icon = "•",
  caption = "All time",
  series = [],
}) {
  return `
    <article class="stat-card">
      <div class="stat-header">
        <span class="stat-label">${escapeHtml(label)}</span>
        <span class="stat-icon">${escapeHtml(icon)}</span>
      </div>

      <strong class="stat-value" data-count="${Number(value || 0)}">
        ${formatNumber(value)}
      </strong>

      <div class="stat-footer">
        <span>${escapeHtml(caption)}</span>
        ${sparkline(series)}
      </div>
    </article>
  `;
}

export function metricCard(label, value, caption = "") {
  return `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${caption ? `<small>${escapeHtml(caption)}</small>` : ""}
    </article>
  `;
}

export function sparkline(series = []) {
  const values = (series || []).map((entry) => Number(entry?.value || 0));

  if (values.length < 2) {
    return `<svg class="sparkline" viewBox="0 0 88 28" aria-hidden="true"><path d="M2 22 L86 22"></path></svg>`;
  }

  const maximum = Math.max(...values, 1);
  const minimum = Math.min(...values, 0);
  const range = maximum - minimum || 1;

  const points = values.map((value, index) => {
    const x = 2 + (index / (values.length - 1)) * 84;
    const y = 25 - ((value - minimum) / range) * 21;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return `
    <svg class="sparkline" viewBox="0 0 88 28" aria-hidden="true">
      <path d="M ${points.join(" L ")}"></path>
    </svg>
  `;
}

export function panel({
  title,
  subtitle = "",
  action = "",
  body = "",
  flush = false,
  className = "",
}) {
  return `
    <section class="panel ${escapeHtml(className)}">
      <header class="panel-header">
        <div class="panel-title">
          <h2>${escapeHtml(title)}</h2>
          ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
        </div>

        ${action}
      </header>

      <div class="panel-body ${flush ? "flush" : ""}">
        ${body}
      </div>
    </section>
  `;
}

export function activityList(logs = [], limit = 8) {
  const items = (logs || []).slice(0, limit);

  if (items.length === 0) {
    return emptyState(
      "No activity yet",
      "New log entries will appear here automatically.",
    );
  }

  return `
    <div class="activity-list">
      ${items
        .map(
          (log) => `
            <article class="activity-item">
              <span class="activity-symbol">
                ${escapeHtml(activityIcon(log.category, log.action))}
              </span>

              <div class="activity-copy">
                <strong>
                  ${escapeHtml(log.description || log.action || "Activity event")}
                </strong>

                <span>
                  ${escapeHtml(log.category || "system")} ·
                  ${escapeHtml(log.status || "informational")}
                </span>
              </div>

              <time class="activity-time" title="${escapeHtml(log.created_at || "")}">
                ${escapeHtml(relativeTime(log.created_at))}
              </time>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

export function serviceList(services = []) {
  return `
    <div class="service-list">
      ${services
        .map(
          (service) => `
            <div class="service-row">
              <span class="service-name">
                ${escapeHtml(service.icon || "•")}
                ${escapeHtml(service.name)}
              </span>

              <span class="service-status">
                <span class="service-indicator ${service.online ? "online" : ""}"></span>
                ${service.online ? "Operational" : "Unavailable"}
              </span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

export function statusBadge(status) {
  return badge(status || "unknown", statusClass(status));
}
