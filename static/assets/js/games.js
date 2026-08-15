(() => {
  "use strict";

  const loader = new window.DogeLocalGmLoader();
  const VIEW_STATE_KEY = "FuzzGamesViewState";

  let pageActive = true;

  const state = {
    games: [],
    categories: {},
    category: "all",
    query: "",
    launching: "",
  };

  const el = {};

  const escapeHtml = (value = "") =>
    String(value).replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[character]);

  function initials(name = "Game") {
    return String(name)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase() || "G";
  }

  function saveViewState() {
    try {
      sessionStorage.setItem(
        VIEW_STATE_KEY,
        JSON.stringify({
          category: state.category,
          query: state.query,
        }),
      );
    } catch {}
  }

  function readViewState() {
    try {
      const parsed = JSON.parse(
        sessionStorage.getItem(VIEW_STATE_KEY) || "{}",
      );

      return {
        category:
          typeof parsed.category === "string"
            ? parsed.category
            : "all",
        query:
          typeof parsed.query === "string"
            ? parsed.query
            : "",
      };
    } catch {
      return {
        category: "all",
        query: "",
      };
    }
  }

  function clearPendingGameNavigation() {
    sessionStorage.removeItem("GoLocalGame");
    sessionStorage.removeItem("GoLocalGameTitle");
    sessionStorage.removeItem("GoUrlRaw");
    sessionStorage.removeItem("GoProxyEngine");
    sessionStorage.removeItem("GoProxyFullscreen");
  }

  function prepareGameNavigation() {
    saveViewState();
    sessionStorage.setItem("GoProxyReturnPath", "/a");
  }

  function currentGames() {
    const source =
      state.category === "all"
        ? state.games
        : state.categories[state.category] || [];

    const query = state.query.trim().toLowerCase();
    if (!query) return source;

    return source.filter((game) =>
      `${game.name} ${game.description} ${game.category}`
        .toLowerCase()
        .includes(query),
    );
  }

  function renderCategories() {
    const items = [
      ["all", "All", state.games.length],
      ...Object.entries(state.categories).map(
        ([name, games]) => [name, name, games.length],
      ),
    ];

    el.categories.innerHTML = items
      .map(([value, label, count]) => `
        <button
          class="apps-category-chip ${
            state.category === value ? "is-active" : ""
          }"
          type="button"
          data-category="${escapeHtml(value)}"
        >
          <span>${escapeHtml(label)}</span>
          <small>${count}</small>
        </button>
      `)
      .join("");

    el.categories.querySelectorAll("[data-category]").forEach((button) => {
      button.addEventListener("click", () => {
        state.category = button.dataset.category || "all";
        saveViewState();
        render();
      });
    });
  }

  function card(game) {
    const busy = state.launching === game.id;
    const fallback = initials(game.name);

    return `
      <article class="app-card">
        <button
          class="app-card-main"
          type="button"
          data-game="${escapeHtml(game.id)}"
          ${state.launching ? "disabled" : ""}
        >
          <span class="app-card-icon-wrap">
            ${
              game.icon
                ? `<img
                    class="app-card-icon"
                    src="${escapeHtml(game.icon)}"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerpolicy="no-referrer"
                    data-game-image
                  />
                  <span class="app-card-icon-fallback" hidden>${escapeHtml(fallback)}</span>`
                : `<span class="app-card-icon-fallback">${escapeHtml(fallback)}</span>`
            }
            <span class="app-card-shade"></span>
          </span>

          <span class="app-card-copy">
            <span class="app-card-text">
              <strong class="app-card-name">${escapeHtml(game.name)}</strong>
              <span class="app-card-description">${escapeHtml(
                busy
                  ? game.local
                    ? "Downloading game..."
                    : "Opening through Fuzz Proxy..."
                  : game.description || game.category,
              )}</span>
              <span class="app-card-footer">
                <span class="app-card-category game-type-badge">
                  <i class="fa-solid ${
                    busy
                      ? "fa-circle-notch fa-spin"
                      : game.local
                        ? "fa-hard-drive"
                        : "fa-globe"
                  }"></i>
                  ${busy ? "Loading" : escapeHtml(game.category)}
                </span>
                <i class="fa-solid fa-arrow-right app-card-arrow"></i>
              </span>
            </span>
          </span>
        </button>
      </article>
    `;
  }

  function openWebGame(game) {
    const target = Array.isArray(game.url) ? game.url[0] : game.url;
    const engine =
      typeof window.FuzzProxy?.getEngine === "function"
        ? window.FuzzProxy.getEngine()
        : "scramjet";

    clearPendingGameNavigation();
    prepareGameNavigation();

    if (typeof window.FuzzProxy?.openStandalone === "function") {
      window.FuzzProxy.openStandalone(target, engine);
      return;
    }

    sessionStorage.setItem("GoUrlRaw", target);
    sessionStorage.setItem("GoProxyEngine", engine);
    location.assign("/p");
  }

  async function openLocalGame(game) {
    clearPendingGameNavigation();
    prepareGameNavigation();

    const result = await loader.load(game.url, (downloading) => {
      if (!pageActive) return;

      el.status.textContent = downloading
        ? `Downloading ${game.name}...`
        : `Preparing ${game.name}...`;
    });

    // If the user left the page while a large game was downloading,
    // never pull them back into the proxy after the download finishes.
    if (!pageActive) return;

    sessionStorage.setItem("GoLocalGame", result.url);
    sessionStorage.setItem("GoLocalGameTitle", game.name);
    location.assign("/p");
  }

  async function launch(game) {
    if (!game || state.launching) return;

    state.launching = game.id;
    render();

    try {
      if (game.local) {
        await openLocalGame(game);
      } else {
        openWebGame(game);
      }
    } catch (error) {
      state.launching = "";
      render();
      el.status.textContent = "Game could not start";
      window.FuzzUI?.toast?.(
        error?.message || "The game could not start.",
        "error",
      );
    }
  }

  function render() {
    renderCategories();

    const games = currentGames();
    el.sectionTitle.textContent =
      state.category === "all" ? "All games" : state.category;
    el.count.textContent =
      `${games.length} ${games.length === 1 ? "game" : "games"}`;

    el.empty.hidden = games.length > 0;
    el.grid.hidden = games.length === 0;
    el.grid.innerHTML = games.map(card).join("");

    el.grid.querySelectorAll("[data-game-image]").forEach((image) => {
      image.addEventListener("error", () => {
        image.hidden = true;
        if (image.nextElementSibling) {
          image.nextElementSibling.hidden = false;
        }
      }, { once: true });
    });

    el.grid.querySelectorAll("[data-game]").forEach((button) => {
      button.addEventListener("click", () => {
        const game = state.games.find(
          (item) => item.id === button.dataset.game,
        );
        void launch(game);
      });
    });

    if (!state.launching) {
      el.status.textContent =
        `${state.games.length} DogeUB games available`;
    }
  }

  async function loadCatalog() {
    el.loading.hidden = false;
    el.grid.hidden = true;
    el.error.hidden = true;
    el.empty.hidden = true;

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
      const savedView = readViewState();

      state.category =
        savedView.category === "all" ||
        Object.prototype.hasOwnProperty.call(
          state.categories,
          savedView.category,
        )
          ? savedView.category
          : "all";
      state.query = savedView.query;
      state.launching = "";

      el.search.value = state.query;
      el.loading.hidden = true;
      render();

      void loader.cleanupOld().catch(() => {});
    } catch (error) {
      el.loading.hidden = true;
      el.error.hidden = false;
      el.errorMessage.textContent =
        error?.message || "The game catalog could not be loaded.";
      el.status.textContent = "Game catalog unavailable";
    }
  }

  function init() {
    el.search = document.querySelector("#game-search");
    el.categories = document.querySelector("#game-category-chips");
    el.status = document.querySelector("#games-status");
    el.loading = document.querySelector("#games-loading");
    el.grid = document.querySelector("#all-games");
    el.empty = document.querySelector("#games-empty");
    el.error = document.querySelector("#games-error");
    el.errorMessage = document.querySelector("#games-error-message");
    el.count = document.querySelector("#game-count");
    el.sectionTitle = document.querySelector("#game-section-title");

    el.search.addEventListener("input", () => {
      state.query = el.search.value || "";
      saveViewState();
      render();
    });

    document.querySelector("#reset-game-filters").addEventListener(
      "click",
      () => {
        state.category = "all";
        state.query = "";
        el.search.value = "";
        saveViewState();
        render();
      },
    );

    document.querySelector("#retry-games").addEventListener(
      "click",
      loadCatalog,
    );

    addEventListener("keydown", (event) => {
      if (event.key === "/" && document.activeElement !== el.search) {
        event.preventDefault();
        el.search.focus();
      }
    });

    addEventListener("pagehide", () => {
      pageActive = false;

      // A page placed into BFCache keeps its JavaScript state. Clear the
      // transient launch state before it is cached so Back never restores
      // a card that still says "Loading".
      state.launching = "";
    });

    addEventListener("pageshow", () => {
      pageActive = true;

      if (state.launching) {
        state.launching = "";
      }

      // pageshow also fires when returning from BFCache.
      // Re-render so all buttons/status text are immediately normal again.
      if (state.games.length > 0) {
        render();
      }
    });

    void loadCatalog();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
