import { escapeHtml } from "./utils.js";

export function showToast(message, type = "success", title = "") {
  const region = document.getElementById("toast-region");

  if (!region) {
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const resolvedTitle =
    title || (type === "error" ? "Action failed" : "Done");

  toast.innerHTML = `
    <span class="toast-icon">
      ${type === "error" ? "!" : "✓"}
    </span>

    <div class="toast-copy">
      <strong>${escapeHtml(resolvedTitle)}</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `;

  region.append(toast);

  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(18px)";

    window.setTimeout(() => toast.remove(), 180);
  }, 3600);
}
