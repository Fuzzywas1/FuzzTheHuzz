export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatNumber(value) {
  const number = Number(value || 0);

  return new Intl.NumberFormat("en-US", {
    notation: number >= 1000000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(number);
}

export function formatExactNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

export function formatDate(value) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function relativeTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", {
    numeric: "auto",
  });

  const ranges = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];

  for (const [unit, divisor] of ranges) {
    if (Math.abs(seconds) >= divisor || unit === "second") {
      return formatter.format(Math.round(seconds / divisor), unit);
    }
  }

  return "Now";
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0);

  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );

  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDuration(milliseconds) {
  const value = Number(milliseconds);

  if (!Number.isFinite(value)) {
    return "No data";
  }

  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }

  return `${(value / 1000).toFixed(1)} s`;
}

export function formatUptime(seconds) {
  let remaining = Math.max(0, Math.floor(Number(seconds || 0)));

  const days = Math.floor(remaining / 86400);
  remaining %= 86400;

  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;

  const minutes = Math.floor(remaining / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

export function debounce(callback, delay = 250) {
  let timeoutId = null;

  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), delay);
  };
}

export function initials(value) {
  const text = String(value || "F").trim();

  if (!text) {
    return "F";
  }

  const parts = text.split(/\s+/).filter(Boolean);

  if (parts.length > 1) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return text.slice(0, 2).toUpperCase();
}

export function statusClass(status) {
  const normalized = String(status || "").toLowerCase();

  if (["success", "online", "verified", "active"].includes(normalized)) {
    return "badge-success";
  }

  if (["failure", "banned", "error", "offline"].includes(normalized)) {
    return "badge-danger";
  }

  if (["warning", "unused", "pending"].includes(normalized)) {
    return "badge-warning";
  }

  return "badge-info";
}

export function activityIcon(category, action = "") {
  const normalized = `${category} ${action}`.toLowerCase();

  if (normalized.includes("auth")) return "↪";
  if (normalized.includes("ban")) return "⊘";
  if (normalized.includes("role")) return "♜";
  if (normalized.includes("invite")) return "◇";
  if (normalized.includes("proxy")) return "◈";
  if (normalized.includes("ai")) return "✦";
  if (normalized.includes("cache")) return "↻";
  if (normalized.includes("admin")) return "⌘";

  return "•";
}

export async function copyText(text) {
  await navigator.clipboard.writeText(String(text));
}

export function setButtonBusy(button, busy, label = "Working...") {
  if (!button) return;

  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" style="width:14px;height:14px;border-width:2px"></span>${escapeHtml(label)}`;
  } else {
    button.disabled = false;
    button.innerHTML = button.dataset.originalHtml || button.innerHTML;
    delete button.dataset.originalHtml;
  }
}
