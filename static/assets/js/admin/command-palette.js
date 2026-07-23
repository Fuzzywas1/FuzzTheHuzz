import { api } from "./api.js";
import { navigate } from "./router.js";
import { debounce, escapeHtml } from "./utils.js";

let overlay = null;
let input = null;
let results = null;
let currentItems = [];
let selectedIndex = 0;

export function initCommandPalette() {
  overlay = document.getElementById("command-overlay");
  input = document.getElementById("command-input");
  results = document.getElementById("command-results");

  document.getElementById("command-trigger")?.addEventListener("click", open);

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      overlay.classList.contains("is-open") ? close() : open();
      return;
    }

    if (!overlay.classList.contains("is-open")) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      activateSelected();
    }
  });

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  input.addEventListener(
    "input",
    debounce(() => loadResults(input.value.trim()), 180),
  );
}

async function open() {
  overlay.classList.add("is-open");
  overlay.setAttribute("aria-hidden", "false");
  input.value = "";
  selectedIndex = 0;
  input.focus();
  await loadResults("");
}

function close() {
  overlay.classList.remove("is-open");
  overlay.setAttribute("aria-hidden", "true");
}

async function loadResults(query) {
  results.innerHTML = `
    <div class="command-empty">
      <span class="spinner"></span>
      <span>Searching...</span>
    </div>
  `;

  try {
    const payload = await api.search(query);

    currentItems = [
      ...(payload.commands || []).map((command) => ({
        type: "command",
        title: command.title,
        subtitle: command.keywords,
        route: command.route,
        icon: "⌘",
      })),
      ...(payload.users || []).map((user) => ({
        type: "user",
        title: user.username,
        subtitle: `${user.role}${user.banned ? " · banned" : ""}`,
        user,
        icon: "◎",
      })),
    ];

    selectedIndex = 0;
    paintResults();
  } catch (error) {
    currentItems = [];
    results.innerHTML = `
      <div class="command-empty">
        <strong>Search failed</strong>
        <span>${escapeHtml(error.message)}</span>
      </div>
    `;
  }
}

function paintResults() {
  if (currentItems.length === 0) {
    results.innerHTML = `
      <div class="command-empty">
        <strong>No matches</strong>
        <span>Try another page or username.</span>
      </div>
    `;
    return;
  }

  const commandItems = currentItems.filter((item) => item.type === "command");
  const userItems = currentItems.filter((item) => item.type === "user");

  let itemIndex = 0;

  const group = (title, items) => {
    if (items.length === 0) return "";

    return `
      <div class="command-group-label">${escapeHtml(title)}</div>

      ${items
        .map((item) => {
          const index = itemIndex++;

          return `
            <button
              class="command-result ${index === selectedIndex ? "is-selected" : ""}"
              type="button"
              data-command-index="${index}"
            >
              <span class="command-result-icon">${escapeHtml(item.icon)}</span>

              <span class="command-result-copy">
                <strong>${escapeHtml(item.title)}</strong>
                <span>${escapeHtml(item.subtitle || "")}</span>
              </span>
            </button>
          `;
        })
        .join("")}
    `;
  };

  results.innerHTML =
    group("Navigation", commandItems) +
    group("Users", userItems);

  results.querySelectorAll("[data-command-index]").forEach((button) => {
    button.addEventListener("mouseenter", () => {
      selectedIndex = Number(button.dataset.commandIndex);
      updateSelection();
    });

    button.addEventListener("click", () => {
      selectedIndex = Number(button.dataset.commandIndex);
      activateSelected();
    });
  });
}

function updateSelection() {
  results.querySelectorAll("[data-command-index]").forEach((button) => {
    button.classList.toggle(
      "is-selected",
      Number(button.dataset.commandIndex) === selectedIndex,
    );
  });
}

function moveSelection(direction) {
  if (currentItems.length === 0) return;

  selectedIndex =
    (selectedIndex + direction + currentItems.length) % currentItems.length;

  updateSelection();

  results
    .querySelector(`[data-command-index="${selectedIndex}"]`)
    ?.scrollIntoView({ block: "nearest" });
}

function activateSelected() {
  const item = currentItems[selectedIndex];

  if (!item) {
    return;
  }

  if (item.type === "command") {
    navigate(item.route);
  } else if (item.type === "user") {
    navigate(`user/${encodeURIComponent(item.user.id)}`);
  }

  close();
}
