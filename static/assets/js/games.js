(() => {
  "use strict";

  const state = {
    games: [],
    categories: {},
    category: "all",
    query: "",
  };

  const elements = {};

  const escapeHtml = (value = "") =>
    String(value).replace(
      /[&<>'"]/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[character],
    );

  function initials(name = "Game") {
    return String(name)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase() || "G";
  }

  function categoryCounts() {
    const counts = new Map([["all", state.games.length]]);

    for (const [category, games] of Object.entries(state.categories)) {
      counts.set(category, Array.isArray(games) ? games.length : 0);
    }

    return counts;
  }

  function renderCategories() {
    const counts = categoryCounts();
    const order = ["all", ...Object.keys(state.categories)];

    elements.categories.innerHTML = order
      .map((category) => {
        const active = state.category === category;
        const label = category === "all" ? "All" : category;
        return `
          <button
            class="apps-category-chip ${active ? "is-active" : ""}"
            type="button"
            data-game-category="${escapeHtml(category)}"
          >
            <span>${escapeHtml(label)}</span>
            <small>${counts.get(category) || 0}</small>
          </button>
        `;
      })
      .join("");

    elements.categories
      .querySelectorAll("[data-game-category]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          state.category = button.dataset.gameCategory || "all";
          render();
        });
      });
  }

  function filteredGames() {
    const source =
      state.category === "all"
        ? state.games
        : state.categories[state.category] || [];

    const query = state.query
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");

    if (!query) return source;

    return source.filter((game) =>
      `${game.name || ""}${game.description || ""}${game.category || ""}`
        .toLowerCase()
        .replace(/\s+/g, "")
        .includes(query),
    );
  }

  function cardTemplate(game) {
    const fallback = initials(game.name);
    return `
      <article class="app-card" data-game-id="${escapeHtml(game.id)}">
        <button
          class="app-card-main"
          type="button"
          data-open-game="${escapeHtml(game.id)}"
          title="Play ${escapeHtml(game.name)} through Fuzz Proxy"
        >
          <span class="app-card-icon-wrap">
            ${
              game.icon
                ? `
                  <img
                    class="app-card-icon"
                    src="${escapeHtml(game.icon)}"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerpolicy="no-referrer"
                    data-game-image
                  />
                  <span class="app-card-icon-fallback" hidden>${escapeHtml(fallback)}</span>
                `
                : `<span class="app-card-icon-fallback">${escapeHtml(fallback)}</span>`
            }
            <span class="app-card-shade"></span>
          </span>

          <span class="app-card-copy">
            <span class="app-card-text">
              <strong class="app-card-name">${escapeHtml(game.name)}</strong>
              <span class="app-card-description">${escapeHtml(
                game.description || game.category || "Game",
              )}</span>
              <span class="app-card-footer">
                <span class="app-card-category game-source-badge">
                  <i class="fa-solid fa-gamepad" aria-hidden="true"></i>
                  ${escapeHtml(game.category || "Game")}
                </span>
                <i class="fa-solid fa-arrow-right app-card-arrow" aria-hidden="true"></i>
              </span>
            </span>
          </span>
        </button>
      </article>
    `;
  }

  function openGame(game) {
    if (!game?.url) return;

    const engine =
      typeof window.FuzzProxy?.getEngine === "function"
        ? window.FuzzProxy.getEngine()
        : "scramjet";

    if (typeof window.FuzzProxy?.openStandalone === "function") {
      window.FuzzProxy.openStandalone(game.url, engine);
      return;
    }

    sessionStorage.setItem("GoUrlRaw", game.url);
    sessionStorage.setItem("GoProxyEngine", engine);
    window.location.assign("/p");
  }

  function renderCards(games) {
    elements.grid.innerHTML = games.map(cardTemplate).join("");

    elements.grid.querySelectorAll("[data-game-image]").forEach((image) => {
      image.addEventListener(
        "error",
        () => {
          image.hidden = true;
          if (image.nextElementSibling) {
            image.nextElementSibling.hidden = false;
          }
        },
        { once: true },
      );
    });

    elements.grid.querySelectorAll("[data-open-game]").forEach((button) => {
      button.addEventListener("click", () => {
        const game = state.games.find(
          (item) => item.id === button.dataset.openGame,
        );
        openGame(game);
      });
    });
  }

  function render() {
    renderCategories();

    const games = filteredGames();
    const label =
      state.category === "all"
        ? "All games"
        : state.category;

    elements.sectionTitle.textContent = label;
    elements.count.textContent = `${games.length} ${
      games.length === 1 ? "game" : "games"
    }`;

    elements.empty.hidden = games.length !== 0;
    elements.grid.hidden = games.length === 0;
    renderCards(games);

    elements.status.textContent = `${state.games.length} DogeUB games available`;
  }

  async function loadGames() {
    elements.error.hidden = true;
    elements.empty.hidden = true;
    elements.grid.hidden = true;
    elements.loading.hidden = false;
    elements.status.textContent = "Loading DogeUB games...";

    try {
      const response = await fetch("/api/games/catalog", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          payload.error || "The game catalog could not be loaded.",
        );
      }

      state.games = Array.isArray(payload.games) ? payload.games : [];
      state.categories =
        payload.categories && typeof payload.categories === "object"
          ? payload.categories
          : {};
      state.category = "all";
      state.query = "";

      elements.search.value = "";
      elements.loading.hidden = true;
      render();
    } catch (error) {
      elements.loading.hidden = true;
      elements.grid.hidden = true;
      elements.empty.hidden = true;
      elements.error.hidden = false;
      elements.status.textContent = "Game catalog unavailable";
      elements.errorMessage.textContent =
        error?.message || "The DogeUB catalog is temporarily unavailable.";
    }
  }

  function init() {
    elements.search = document.querySelector("#game-search");
    elements.categories = document.querySelector("#game-category-chips");
    elements.status = document.querySelector("#games-status");
    elements.loading = document.querySelector("#games-loading");
    elements.grid = document.querySelector("#all-games");
    elements.empty = document.querySelector("#games-empty");
    elements.error = document.querySelector("#games-error");
    elements.errorMessage = document.querySelector("#games-error-message");
    elements.count = document.querySelector("#game-count");
    elements.sectionTitle = document.querySelector("#game-section-title");

    elements.search.addEventListener("input", () => {
      state.query = elements.search.value || "";
      render();
    });

    document.querySelector("#reset-game-filters").addEventListener("click", () => {
      state.category = "all";
      state.query = "";
      elements.search.value = "";
      render();
    });

    document.querySelector("#retry-games").addEventListener("click", loadGames);

    window.addEventListener("keydown", (event) => {
      if (
        event.key === "/" &&
        document.activeElement !== elements.search
      ) {
        event.preventDefault();
        elements.search.focus();
      }
    });

    void loadGames();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
