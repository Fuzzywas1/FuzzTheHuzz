(() => {
  "use strict";

  const STORAGE_KEY = "fuzz-app-state-v2";
  const LEGACY_PIN_KEY = "Apinned";
  const LEGACY_CUSTOM_KEY = "Acustom";
  const MAX_RECENT = 8;
  const MAX_CUSTOM_APPS = 50;

  const CATEGORY_ORDER = [
    "all",
    "favorites",
    "recent",
    "social",
    "stream",
    "message",
    "media",
    "game",
    "cloud",
    "tool",
    "ai",
    "emu",
    "mail",
    "android",
    "other",
  ];

  const CATEGORY_LABELS = {
    all: "All",
    favorites: "Favorites",
    recent: "Recent",
    social: "Social",
    stream: "Streaming",
    message: "Messaging",
    media: "TV & Movies",
    game: "Game sites",
    cloud: "Cloud gaming",
    tool: "Tools",
    ai: "AI",
    emu: "Emulators",
    mail: "Mail",
    android: "Android",
    other: "Other",
  };

  const CATEGORY_ICONS = {
    all: "fa-border-all",
    favorites: "fa-star",
    recent: "fa-clock-rotate-left",
    social: "fa-user-group",
    stream: "fa-tower-broadcast",
    message: "fa-message",
    media: "fa-film",
    game: "fa-gamepad",
    cloud: "fa-cloud",
    tool: "fa-screwdriver-wrench",
    ai: "fa-wand-magic-sparkles",
    emu: "fa-microchip",
    mail: "fa-envelope",
    android: "fa-mobile-screen",
    other: "fa-shapes",
  };

  const state = {
    apps: [],
    filteredApps: [],
    favorites: new Set(),
    recent: [],
    openCounts: {},
    customApps: [],
    search: "",
    category: "all",
    sort: "name",
    synced: false,
  };

  const elements = {};

  function cacheElements() {
    elements.search = document.querySelector("#app-search");
    elements.sort = document.querySelector("#app-sort");
    elements.categoryChips = document.querySelector("#category-chips");
    elements.status = document.querySelector("#apps-status");
    elements.count = document.querySelector("#app-count");
    elements.loading = document.querySelector("#apps-loading");
    elements.allApps = document.querySelector("#all-apps");
    elements.empty = document.querySelector("#apps-empty");
    elements.favoritesSection = document.querySelector("#favorites-section");
    elements.favoriteApps = document.querySelector("#favorite-apps");
    elements.recentSection = document.querySelector("#recent-section");
    elements.recentApps = document.querySelector("#recent-apps");
    elements.modalRoot = document.querySelector("#app-modal-root");
    elements.toastRegion = document.querySelector("#apps-toast-region");
  }

  function slugify(value) {
    return String(value || "app")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 54) || "app";
  }

  function smallHash(value) {
    let hash = 2166136261;
    const input = String(value || "");

    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36).slice(0, 7);
  }

  function createAppId(app) {
    return `${slugify(app.name)}-${smallHash(app.link || app.name)}`;
  }

  function cleanDisplayName(name) {
    return String(name || "Untitled app")
      .replace(/^!\s*/, "")
      .replace(/^\[NEW\]\s*/i, "")
      .replace(/^\[Custom\]\s*/i, "")
      .trim();
  }

  function normalizeCategories(categories) {
    const list = Array.isArray(categories) ? categories : ["all"];
    const clean = [...new Set(list.map((value) => String(value).trim().toLowerCase()).filter(Boolean))];

    if (!clean.includes("all")) {
      clean.unshift("all");
    }

    if (clean.length === 1) {
      clean.push("other");
    }

    return clean;
  }

  function normalizeApp(rawApp, { custom = false } = {}) {
    const app = {
      ...rawApp,
      name: cleanDisplayName(rawApp.name),
      link: String(rawApp.link || "").trim(),
      image: String(rawApp.image || "").trim(),
      categories: normalizeCategories(rawApp.categories),
      isCustom: custom === true,
      isCreateAction:
        rawApp.custom === true ||
        rawApp.custom === "true" ||
        /^create custom app$/i.test(cleanDisplayName(rawApp.name)),
    };

    if (/interstellar faq|docs/i.test(app.name)) {
      app.name = "Help & Docs";
    }

    app.id = String(rawApp.id || createAppId(app));
    app.searchText = `${app.name} ${app.categories.join(" ")}`.toLowerCase();
    return app;
  }

  function defaultLocalState() {
    return {
      favorites: [],
      recent: [],
      openCounts: {},
      customApps: [],
    };
  }

  function loadLocalState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return {
        favorites: Array.isArray(parsed?.favorites) ? parsed.favorites : [],
        recent: Array.isArray(parsed?.recent) ? parsed.recent : [],
        openCounts:
          parsed?.openCounts && typeof parsed.openCounts === "object"
            ? parsed.openCounts
            : {},
        customApps: Array.isArray(parsed?.customApps) ? parsed.customApps : [],
      };
    } catch {
      return defaultLocalState();
    }
  }

  function applyStoredState(stored) {
    state.favorites = new Set(
      (stored.favorites || []).map(String).filter(Boolean).slice(0, 250),
    );
    state.recent = (stored.recent || [])
      .filter((item) => item && item.id)
      .slice(0, MAX_RECENT);
    state.openCounts = stored.openCounts || {};
    state.customApps = (stored.customApps || [])
      .slice(0, MAX_CUSTOM_APPS)
      .map((app) => normalizeApp(app, { custom: true }));
  }

  function serializeState() {
    return {
      favorites: [...state.favorites],
      recent: state.recent.slice(0, MAX_RECENT),
      openCounts: state.openCounts,
      customApps: state.customApps.map((app) => ({
        id: app.id,
        name: app.name,
        link: app.link,
        image: app.image,
        categories: app.categories,
      })),
    };
  }

  function saveLocalState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState()));
  }

  let syncTimer = null;

  function scheduleServerSync() {
    saveLocalState();
    window.clearTimeout(syncTimer);

    syncTimer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/apps/state", {
          method: "PUT",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(serializeState()),
        });

        state.synced = response.ok;
      } catch {
        state.synced = false;
      }
    }, 350);
  }

  async function loadServerState() {
    try {
      const response = await fetch("/api/apps/state", {
        credentials: "same-origin",
      });

      if (!response.ok) {
        return null;
      }

      const payload = await response.json();
      state.synced = true;
      return payload.state || null;
    } catch {
      return null;
    }
  }

  function mergeStates(localState, serverState) {
    if (!serverState) {
      return localState;
    }

    const favorites = [
      ...new Set([...(localState.favorites || []), ...(serverState.favorites || [])]),
    ];

    const recentMap = new Map();
    for (const item of [...(localState.recent || []), ...(serverState.recent || [])]) {
      if (!item?.id) continue;
      const current = recentMap.get(item.id);
      if (!current || Date.parse(item.openedAt || 0) > Date.parse(current.openedAt || 0)) {
        recentMap.set(item.id, item);
      }
    }

    const openCounts = { ...(serverState.openCounts || {}) };
    for (const [id, count] of Object.entries(localState.openCounts || {})) {
      openCounts[id] = Math.max(Number(openCounts[id] || 0), Number(count || 0));
    }

    const customMap = new Map();
    for (const app of [...(serverState.customApps || []), ...(localState.customApps || [])]) {
      const normalized = normalizeApp(app, { custom: true });
      customMap.set(normalized.id, normalized);
    }

    return {
      favorites,
      recent: [...recentMap.values()]
        .sort((a, b) => Date.parse(b.openedAt || 0) - Date.parse(a.openedAt || 0))
        .slice(0, MAX_RECENT),
      openCounts,
      customApps: [...customMap.values()].slice(0, MAX_CUSTOM_APPS),
    };
  }

  function legacyPinnedIds(sortedBuiltInApps) {
    const raw = localStorage.getItem(LEGACY_PIN_KEY);
    if (!raw) return [];

    const indexes = raw
      .split(",")
      .map((value) => Number.parseInt(value, 10))
      .filter(Number.isFinite);

    return indexes
      .map((index) => sortedBuiltInApps[index]?.id)
      .filter(Boolean);
  }

  function legacyCustomApps() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LEGACY_CUSTOM_KEY) || "null");
      return parsed
        ? Object.values(parsed).map((app) => normalizeApp(app, { custom: true }))
        : [];
    } catch {
      return [];
    }
  }

  function migrateLegacyState(sortedBuiltInApps) {
    const pinned = legacyPinnedIds(sortedBuiltInApps);
    const custom = legacyCustomApps();

    if (pinned.length === 0 && custom.length === 0) {
      return;
    }

    pinned.forEach((id) => state.favorites.add(id));

    const existing = new Set(state.customApps.map((app) => app.id));
    for (const app of custom) {
      if (!existing.has(app.id)) {
        state.customApps.push(app);
      }
    }

    localStorage.removeItem(LEGACY_PIN_KEY);
    localStorage.removeItem(LEGACY_CUSTOM_KEY);
    scheduleServerSync();
  }

  function categoryForLabel(app) {
    const preferred = app.categories.find((category) => category !== "all");
    return CATEGORY_LABELS[preferred] || "App";
  }

  function appStatus(app) {
    if (app.error) {
      return { label: "Unavailable", className: "status-error", icon: "fa-circle-xmark" };
    }

    if (app.partial) {
      return { label: "May have issues", className: "status-warning", icon: "fa-triangle-exclamation" };
    }

    if (app.load) {
      return { label: "Slow loading", className: "status-warning", icon: "fa-clock" };
    }

    return null;
  }

  function cardTemplate(app) {
    const favorite = state.favorites.has(app.id);
    const status = appStatus(app);
    const initials = app.name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase();

    return `
      <article class="app-card ${favorite ? "is-favorite" : ""} ${app.isCustom ? "app-card-custom" : ""}" data-app-id="${escapeHtml(app.id)}">
        <div class="app-card-actions">
          <button
            class="app-card-action app-card-favorite ${favorite ? "is-active" : ""}"
            type="button"
            data-favorite-app="${escapeHtml(app.id)}"
            title="${favorite ? "Remove from favorites" : "Add to favorites"}"
            aria-label="${favorite ? "Remove from favorites" : "Add to favorites"}"
          >
            <i class="${favorite ? "fa-solid" : "fa-regular"} fa-star" aria-hidden="true"></i>
          </button>

          ${
            app.link
              ? `
                <button
                  class="app-card-action app-card-action-open-blank"
                  type="button"
                  data-open-blank="${escapeHtml(app.id)}"
                  title="Open directly"
                  aria-label="Open directly"
                >
                  <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
                </button>
              `
              : ""
          }

          ${
            app.isCustom
              ? `
                <button
                  class="app-card-action"
                  type="button"
                  data-delete-custom="${escapeHtml(app.id)}"
                  title="Delete custom app"
                  aria-label="Delete custom app"
                >
                  <i class="fa-solid fa-trash" aria-hidden="true"></i>
                </button>
              `
              : ""
          }
        </div>

        <button class="app-card-main" type="button" data-open-app="${escapeHtml(app.id)}">
          <span class="app-card-icon-wrap">
            ${
              app.image
                ? `
                  <img
                    class="app-card-icon"
                    src="${escapeHtml(app.image)}"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    data-app-image
                  />
                  <span class="app-card-icon-fallback" hidden>${escapeHtml(initials || "A")}</span>
                `
                : `<span class="app-card-icon-fallback">${escapeHtml(initials || "A")}</span>`
            }
            <span class="app-card-shade"></span>
            ${
              status
                ? `
                  <span class="app-card-status ${status.className}">
                    <i class="fa-solid ${status.icon}" aria-hidden="true"></i>
                    ${escapeHtml(status.label)}
                  </span>
                `
                : ""
            }
          </span>

          <span class="app-card-copy">
            <span>
              <strong class="app-card-name">${escapeHtml(app.name)}</strong>
              <span class="app-card-meta">${escapeHtml(categoryForLabel(app))}</span>
            </span>
            <i class="fa-solid fa-arrow-up-right-from-square app-card-arrow" aria-hidden="true"></i>
          </span>
        </button>
      </article>
    `;
  }

  function renderCards(container, apps) {
    container.innerHTML = apps.map(cardTemplate).join("");

    container.querySelectorAll("[data-app-image]").forEach((image) => {
      image.addEventListener("error", () => {
        image.hidden = true;
        image.nextElementSibling.hidden = false;
      }, { once: true });
    });
  }

  function availableCategories() {
    const counts = new Map([["all", state.apps.length]]);

    for (const app of state.apps) {
      for (const category of app.categories) {
        if (category === "all") continue;
        counts.set(category, (counts.get(category) || 0) + 1);
      }
    }

    counts.set("favorites", state.favorites.size);
    counts.set("recent", state.recent.length);

    return CATEGORY_ORDER.filter((category) => counts.has(category)).map((category) => ({
      id: category,
      label: CATEGORY_LABELS[category] || category,
      count: counts.get(category) || 0,
      icon: CATEGORY_ICONS[category] || "fa-shapes",
    }));
  }

  function renderCategories() {
    elements.categoryChips.innerHTML = availableCategories()
      .map(
        (category) => `
          <button
            class="apps-category-chip ${state.category === category.id ? "is-active" : ""}"
            type="button"
            data-category="${escapeHtml(category.id)}"
          >
            <i class="fa-solid ${category.icon}" aria-hidden="true"></i>
            <strong>${escapeHtml(category.label)}</strong>
            <span>${category.count}</span>
          </button>
        `,
      )
      .join("");
  }

  function matchesCategory(app) {
    if (state.category === "all") return true;
    if (state.category === "favorites") return state.favorites.has(app.id);
    if (state.category === "recent") return state.recent.some((item) => item.id === app.id);
    return app.categories.includes(state.category);
  }

  function recentTime(id) {
    return Date.parse(state.recent.find((item) => item.id === id)?.openedAt || 0) || 0;
  }

  function sortApps(apps) {
    return [...apps].sort((a, b) => {
      if (state.sort === "recent") {
        return recentTime(b.id) - recentTime(a.id) || a.name.localeCompare(b.name);
      }

      if (state.sort === "used") {
        return Number(state.openCounts[b.id] || 0) - Number(state.openCounts[a.id] || 0) || a.name.localeCompare(b.name);
      }

      if (state.sort === "favorites") {
        return Number(state.favorites.has(b.id)) - Number(state.favorites.has(a.id)) || a.name.localeCompare(b.name);
      }

      return a.name.localeCompare(b.name);
    });
  }

  function filterApps() {
    const query = state.search.trim().toLowerCase();

    state.filteredApps = sortApps(
      state.apps.filter((app) => {
        return matchesCategory(app) && (!query || app.searchText.includes(query));
      }),
    );
  }

  function recentApps() {
    const appMap = new Map(state.apps.map((app) => [app.id, app]));
    return state.recent.map((item) => appMap.get(item.id)).filter(Boolean).slice(0, MAX_RECENT);
  }

  function favoriteApps() {
    return state.apps.filter((app) => state.favorites.has(app.id)).sort((a, b) => a.name.localeCompare(b.name));
  }

  function render() {
    filterApps();
    renderCategories();

    elements.loading.hidden = true;
    elements.allApps.hidden = state.filteredApps.length === 0;
    elements.empty.hidden = state.filteredApps.length !== 0;
    elements.count.textContent = `${state.filteredApps.length} ${state.filteredApps.length === 1 ? "app" : "apps"}`;

    renderCards(elements.allApps, state.filteredApps);

    const favorites = favoriteApps();
    elements.favoritesSection.hidden = favorites.length === 0 || state.search || state.category !== "all";
    if (!elements.favoritesSection.hidden) {
      renderCards(elements.favoriteApps, favorites.slice(0, 8));
    }

    const recent = recentApps();
    elements.recentSection.hidden = recent.length === 0 || state.search || state.category !== "all";
    if (!elements.recentSection.hidden) {
      renderCards(elements.recentApps, recent.slice(0, 8));
    }

    const syncText = state.synced ? "Favorites and recents sync to your account." : "Favorites and recents are saved in this browser.";
    elements.status.innerHTML = `<span>${escapeHtml(syncText)}</span>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showToast(message, icon = "fa-circle-check") {
    const toast = document.createElement("div");
    toast.className = "apps-toast";
    toast.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${escapeHtml(message)}</span>`;
    elements.toastRegion.appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
    }, 3200);
  }

  function resolveSelectedLink(app) {
    if (!Array.isArray(app.links) || app.links.length <= 1) {
      return app.link;
    }

    const options = app.links.map((link, index) => `${index + 1}: ${link.name}`).join("\n");
    const choice = window.prompt(`Select a link:\n${options}`);
    const selectedIndex = Number.parseInt(choice, 10) - 1;

    if (!Number.isFinite(selectedIndex) || selectedIndex < 0 || selectedIndex >= app.links.length) {
      return null;
    }

    return app.links[selectedIndex].url;
  }

  function recordOpen(app) {
    const openedAt = new Date().toISOString();
    state.recent = [
      { id: app.id, openedAt },
      ...state.recent.filter((item) => item.id !== app.id),
    ].slice(0, MAX_RECENT);
    state.openCounts[app.id] = Number(state.openCounts[app.id] || 0) + 1;
    scheduleServerSync();

    fetch("/api/apps/open", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: app.id,
        name: app.name,
        link: app.link,
        categories: app.categories,
      }),
    }).catch(() => {});
  }

  function openApp(app, mode = "default") {
    if (!app) return;

    if (app.isCreateAction) {
      openCustomAppModal();
      return;
    }

    if (app.say) {
      window.alert(app.say);
    }

    const selected = resolveSelectedLink(app);
    if (!selected) return;

    recordOpen(app);

    if (mode === "blank") {
      if (typeof window.blank === "function") {
        window.blank(selected);
      } else {
        window.open(selected, "_blank", "noopener,noreferrer");
      }
      return;
    }

    let inTabsPage = false;
    try {
      inTabsPage = window.top.location.pathname === "/d";
    } catch {
      inTabsPage = false;
    }

    if (app.local) {
      sessionStorage.setItem("GoUrl", selected);
      window.location.href = inTabsPage ? selected : "rx";
    } else if (app.local2) {
      sessionStorage.setItem("GoUrl", selected);
      window.location.href = selected;
    } else if (app.blank) {
      window.blank(selected);
    } else if (app.now && typeof window.now === "function") {
      window.now(selected);
    } else if (app.dy && typeof window.dy === "function") {
      window.dy(selected);
    } else if (typeof window.go === "function") {
      window.go(selected);
    } else {
      window.location.href = selected;
    }
  }

  function toggleFavorite(id) {
    if (state.favorites.has(id)) {
      state.favorites.delete(id);
      showToast("Removed from favorites", "fa-star");
    } else {
      state.favorites.add(id);
      showToast("Added to favorites", "fa-star");
    }

    scheduleServerSync();
    render();
  }

  function removeCustomApp(id) {
    const app = state.customApps.find((item) => item.id === id);
    if (!app) return;

    const confirmed = window.confirm(`Delete ${app.name}?`);
    if (!confirmed) return;

    state.customApps = state.customApps.filter((item) => item.id !== id);
    state.apps = state.apps.filter((item) => item.id !== id);
    state.favorites.delete(id);
    state.recent = state.recent.filter((item) => item.id !== id);
    delete state.openCounts[id];

    scheduleServerSync();
    render();
    showToast("Custom app deleted", "fa-trash");
  }

  function closeModal() {
    elements.modalRoot.innerHTML = "";
  }

  function openCustomAppModal() {
    elements.modalRoot.innerHTML = `
      <div class="apps-modal-backdrop" data-close-app-modal>
        <section class="apps-modal" role="dialog" aria-modal="true" aria-labelledby="custom-app-title">
          <header class="apps-modal-header">
            <div>
              <span class="apps-section-kicker">Custom shortcut</span>
              <h2 id="custom-app-title">Add an app</h2>
              <p>Add any website to your personal app library.</p>
            </div>
            <button class="apps-modal-close" type="button" data-close-app-modal-button aria-label="Close">
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </header>

          <form class="apps-modal-form" id="custom-app-form">
            <label class="apps-form-field">
              <span>Name</span>
              <input id="custom-app-name" type="text" maxlength="60" placeholder="Example: Google Drive" required />
            </label>

            <label class="apps-form-field">
              <span>Website URL</span>
              <input id="custom-app-url" type="url" maxlength="2000" placeholder="https://example.com" required />
            </label>

            <label class="apps-form-field">
              <span>Icon URL <small>(optional)</small></span>
              <input id="custom-app-icon" type="url" maxlength="2000" placeholder="https://example.com/icon.png" />
            </label>

            <p class="apps-form-error" id="custom-app-error"></p>

            <div class="apps-modal-actions">
              <button class="apps-modal-cancel" type="button" data-close-app-modal-button>Cancel</button>
              <button class="apps-modal-submit" type="submit">
                <i class="fa-solid fa-plus" aria-hidden="true"></i>
                Add app
              </button>
            </div>
          </form>
        </section>
      </div>
    `;

    const form = elements.modalRoot.querySelector("#custom-app-form");
    const nameInput = elements.modalRoot.querySelector("#custom-app-name");
    const urlInput = elements.modalRoot.querySelector("#custom-app-url");
    const iconInput = elements.modalRoot.querySelector("#custom-app-icon");
    const error = elements.modalRoot.querySelector("#custom-app-error");

    window.setTimeout(() => nameInput.focus(), 0);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      error.textContent = "";

      const name = nameInput.value.trim();
      let link = urlInput.value.trim();
      const image = iconInput.value.trim();

      if (!/^https?:\/\//i.test(link)) {
        link = `https://${link}`;
      }

      try {
        const parsed = new URL(link);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          throw new Error("Unsupported protocol");
        }
      } catch {
        error.textContent = "Enter a valid website URL.";
        return;
      }

      if (image) {
        try {
          const parsedImage = new URL(image);
          if (!["http:", "https:"].includes(parsedImage.protocol)) {
            throw new Error("Unsupported protocol");
          }
        } catch {
          error.textContent = "Enter a valid icon URL or leave it blank.";
          return;
        }
      }

      const app = normalizeApp(
        {
          name,
          link,
          image: image || "/assets/media/icons/custom.webp",
          categories: ["all", "other"],
        },
        { custom: true },
      );

      if (state.apps.some((item) => item.id === app.id)) {
        error.textContent = "That app is already in your library.";
        return;
      }

      state.customApps.unshift(app);
      state.apps.unshift(app);
      state.favorites.add(app.id);
      scheduleServerSync();
      closeModal();
      render();
      showToast(`${app.name} was added`, "fa-plus");
    });
  }

  function bindEvents() {
    elements.search.addEventListener("input", () => {
      state.search = elements.search.value;
      render();
    });

    elements.sort.addEventListener("change", () => {
      state.sort = elements.sort.value;
      render();
    });

    document.querySelector("#add-custom-app")?.addEventListener("click", openCustomAppModal);

    document.querySelector("#reset-app-filters")?.addEventListener("click", () => {
      state.search = "";
      state.category = "all";
      elements.search.value = "";
      render();
    });

    document.querySelector("[data-clear-favorites]")?.addEventListener("click", () => {
      state.favorites.clear();
      scheduleServerSync();
      render();
      showToast("Favorites cleared", "fa-star");
    });

    document.querySelector("[data-clear-recents]")?.addEventListener("click", () => {
      state.recent = [];
      scheduleServerSync();
      render();
      showToast("Recent history cleared", "fa-clock-rotate-left");
    });

    document.addEventListener("click", (event) => {
      const categoryButton = event.target.closest("[data-category]");
      if (categoryButton) {
        state.category = categoryButton.dataset.category;
        render();
        return;
      }

      const favoriteButton = event.target.closest("[data-favorite-app]");
      if (favoriteButton) {
        toggleFavorite(favoriteButton.dataset.favoriteApp);
        return;
      }

      const blankButton = event.target.closest("[data-open-blank]");
      if (blankButton) {
        openApp(state.apps.find((app) => app.id === blankButton.dataset.openBlank), "blank");
        return;
      }

      const deleteButton = event.target.closest("[data-delete-custom]");
      if (deleteButton) {
        removeCustomApp(deleteButton.dataset.deleteCustom);
        return;
      }

      const openButton = event.target.closest("[data-open-app]");
      if (openButton) {
        openApp(state.apps.find((app) => app.id === openButton.dataset.openApp));
        return;
      }

      if (event.target.matches("[data-close-app-modal]") || event.target.closest("[data-close-app-modal-button]")) {
        closeModal();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        elements.search.focus();
      }

      if (event.key === "Escape") {
        if (elements.modalRoot.innerHTML) {
          closeModal();
        } else if (document.activeElement === elements.search && elements.search.value) {
          state.search = "";
          elements.search.value = "";
          render();
        }
      }
    });
  }

  async function loadApps() {
    const response = await fetch("/assets/json/a.min.json", { cache: "no-cache" });
    if (!response.ok) {
      throw new Error("The app library could not be loaded.");
    }

    const rawApps = await response.json();
    const legacyOrderedApps = rawApps
      .map((app) => normalizeApp(app))
      .sort((a, b) => a.name.localeCompare(b.name));

    const builtInApps = legacyOrderedApps
      .filter((app) => !app.isCreateAction)
      .map((app) => {
        if (app.categories.includes("local")) {
          app.local = true;
        }

        if (/now\.gg|nowgg\.me/i.test(app.link) && app.partial == null) {
          app.partial = true;
          app.say = "Now.gg may not work for every user right now.";
        }

        if (/nowgg\.nl/i.test(app.link) && app.error == null) {
          app.error = true;
          app.say = "This NowGG link is currently unavailable.";
        }

        return app;
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const localState = loadLocalState();
    const serverState = await loadServerState();
    applyStoredState(mergeStates(localState, serverState));
    migrateLegacyState(legacyOrderedApps);

    const appMap = new Map();
    for (const app of [...state.customApps, ...builtInApps]) {
      appMap.set(app.id, app);
    }

    state.apps = [...appMap.values()];

    const validIds = new Set(state.apps.map((app) => app.id));
    state.favorites = new Set([...state.favorites].filter((id) => validIds.has(id)));
    state.recent = state.recent.filter((item) => validIds.has(item.id));

    scheduleServerSync();
  }

  async function init() {
    cacheElements();
    bindEvents();

    try {
      await loadApps();
      render();
    } catch (error) {
      console.error(error);
      elements.loading.hidden = true;
      elements.allApps.hidden = true;
      elements.empty.hidden = false;
      elements.empty.querySelector("h3").textContent = "Apps could not load";
      elements.empty.querySelector("p").textContent = "Refresh the page and try again.";
      elements.status.innerHTML = `<span>${escapeHtml(error.message)}</span>`;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
