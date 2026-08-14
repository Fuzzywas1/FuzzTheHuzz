(() => {
  "use strict";

  const DB_NAME = "gm loader db";
  const DB_VER = 1;
  const STORE_NAME = "gms";
  const TEXT_EXTS = new Set([
    "html", "htm", "css", "js", "mjs", "json", "xml", "txt",
    "md", "csv", "svg",
  ]);

  const state = {
    games: [],
    categories: {},
    category: "all",
    query: "",
    loadingGameId: "",
  };

  const elements = {};

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

  function getMime(filename) {
    const ext = String(filename).split(".").pop().toLowerCase();
    return ({
      html: "text/html", htm: "text/html", css: "text/css",
      js: "application/javascript", mjs: "application/javascript",
      json: "application/json", xml: "application/xml",
      txt: "text/plain", md: "text/markdown", csv: "text/csv",
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", svg: "image/svg+xml", ico: "image/x-icon",
      webp: "image/webp", bmp: "image/bmp", avif: "image/avif",
      woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf",
      otf: "font/otf", eot: "application/vnd.ms-fontobject",
      mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
      m4a: "audio/mp4", aac: "audio/aac",
      mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg",
      wasm: "application/wasm", zip: "application/zip",
      gz: "application/gzip", pdf: "application/pdf",
      data: "application/octet-stream", unityweb: "application/octet-stream",
      bundle: "application/octet-stream", bin: "application/octet-stream",
      dat: "application/octet-stream", mem: "application/octet-stream",
      asset: "application/octet-stream", resource: "application/octet-stream",
    })[ext] || "application/octet-stream";
  }

  function isBinary(filename) {
    const ext = String(filename).split(".").pop().toLowerCase();
    return !TEXT_EXTS.has(ext);
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VER);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
    });
  }

  async function getStoredGame(name) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readonly");
      const request = tx.objectStore(STORE_NAME).get(name);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveStoredGame(name, files) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readwrite");
      const request = tx.objectStore(STORE_NAME).put({
        id: name,
        name,
        files,
        uploadDate: new Date().toISOString(),
        lastPlayed: new Date().toISOString(),
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async function registerGameWorker() {
    if (!("serviceWorker" in navigator)) {
      throw new Error("This browser does not support the game loader.");
    }

    const registrations = await navigator.serviceWorker.getRegistrations();
    let registration = registrations.find((item) =>
      item.active?.scriptURL.includes("/loadersw.js"),
    );

    if (!registration) {
      registration = await navigator.serviceWorker.register("/loadersw.js", {
        scope: "/game/",
        updateViaCache: "none",
      });
    }

    if (registration.installing || registration.waiting) {
      const worker = registration.installing || registration.waiting;
      await new Promise((resolve) => {
        if (worker.state === "activated") return resolve();
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") resolve();
        });
      });
    }

    return registration;
  }

  function gamePackageName(game) {
    const first = (Array.isArray(game.urls) ? game.urls[0] : game.url) || "";
    const raw = first.split("/").pop()?.split("?")[0] || `game-${game.id}`;
    return raw.replace(/\.zip$/i, "") || `game-${game.id}`;
  }

  async function fetchZip(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Game package returned ${response.status}.`);
    }

    const type = response.headers.get("content-type") || "";
    const blob = await response.blob();

    if (
      !/zip|octet-stream/i.test(type) &&
      !/\.zip(?:$|\?)/i.test(url)
    ) {
      throw new Error("This DogeUB entry is not a playable game package.");
    }

    const archive = await window.JSZip.loadAsync(blob);
    const files = {};

    for (const [path, entry] of Object.entries(archive.files)) {
      if (entry.dir) continue;
      const binary = isBinary(path);
      files[path] = {
        content: await entry.async(binary ? "base64" : "string"),
        mime: getMime(path),
        binary,
      };
    }

    return files;
  }

  async function prepareGame(game) {
    if (!window.JSZip) {
      throw new Error("The game unpacker did not load.");
    }

    await registerGameWorker();

    const name = gamePackageName(game);
    const existing = await getStoredGame(name);
    if (existing?.files) {
      return `/game/${encodeURIComponent(name)}/index.html`;
    }

    const urls =
      Array.isArray(game.urls) && game.urls.length
        ? game.urls
        : [game.url];

    const merged = {};
    for (const url of urls) {
      const files = await fetchZip(url);
      Object.assign(merged, files);
    }

    if (!Object.keys(merged).length) {
      throw new Error("The downloaded game package was empty.");
    }

    await saveStoredGame(name, merged);
    return `/game/${encodeURIComponent(name)}/index.html`;
  }

  function openInsideFuzzProxyShell(localUrl, game) {
    sessionStorage.setItem("GoLocalGame", localUrl);
    sessionStorage.setItem("GoLocalGameTitle", game?.name || "Game");
    window.location.assign("/p");
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

    elements.categories.innerHTML = order.map((category) => {
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
    }).join("");

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

    const query = state.query.trim().toLowerCase().replace(/\s+/g, "");
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
    const busy = state.loadingGameId === game.id;

    return `
      <article class="app-card" data-game-id="${escapeHtml(game.id)}">
        <button
          class="app-card-main"
          type="button"
          data-open-game="${escapeHtml(game.id)}"
          ${state.loadingGameId ? "disabled" : ""}
          title="Play ${escapeHtml(game.name)}"
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
                busy ? "Preparing game..." : (game.description || game.category || "Game"),
              )}</span>
              <span class="app-card-footer">
                <span class="app-card-category game-source-badge">
                  <i class="fa-solid ${busy ? "fa-circle-notch fa-spin" : "fa-play"}" aria-hidden="true"></i>
                  ${busy ? "Loading" : escapeHtml(game.category || "Game")}
                </span>
                <i class="fa-solid fa-arrow-right app-card-arrow" aria-hidden="true"></i>
              </span>
            </span>
          </span>
        </button>
      </article>
    `;
  }

  async function openGame(game) {
    if (!game || state.loadingGameId) return;

    state.loadingGameId = game.id;
    elements.status.textContent = `Preparing ${game.name}...`;
    render();

    try {
      const localUrl = await prepareGame(game);
      openInsideFuzzProxyShell(localUrl, game);
    } catch (error) {
      state.loadingGameId = "";
      render();
      elements.status.textContent = "Game could not start";
      window.FuzzUI?.toast?.(
        error?.message || "The game could not be prepared.",
        "error",
      );
    }
  }

  function renderCards(games) {
    elements.grid.innerHTML = games.map(cardTemplate).join("");

    elements.grid.querySelectorAll("[data-game-image]").forEach((image) => {
      image.addEventListener("error", () => {
        image.hidden = true;
        if (image.nextElementSibling) image.nextElementSibling.hidden = false;
      }, { once: true });
    });

    elements.grid.querySelectorAll("[data-open-game]").forEach((button) => {
      button.addEventListener("click", () => {
        const game = state.games.find((item) => item.id === button.dataset.openGame);
        void openGame(game);
      });
    });
  }

  function render() {
    renderCategories();
    const games = filteredGames();
    const label = state.category === "all" ? "All games" : state.category;

    elements.sectionTitle.textContent = label;
    elements.count.textContent = `${games.length} ${games.length === 1 ? "game" : "games"}`;
    elements.empty.hidden = games.length !== 0;
    elements.grid.hidden = games.length === 0;
    renderCards(games);

    if (!state.loadingGameId) {
      elements.status.textContent = `${state.games.length} DogeUB games available`;
    }
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
        throw new Error(payload.error || "The game catalog could not be loaded.");
      }

      state.games = Array.isArray(payload.games) ? payload.games : [];
      state.categories =
        payload.categories && typeof payload.categories === "object"
          ? payload.categories
          : {};
      state.category = "all";
      state.query = "";
      state.loadingGameId = "";
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
      if (event.key === "/" && document.activeElement !== elements.search) {
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
