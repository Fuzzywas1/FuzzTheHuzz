(() => {
  "use strict";

  const RECENTS_KEY = "fuzz_browser_recents_v1";
  const CLOSED_KEY = "fuzz_recently_closed_v1";
  const LOCAL_BOOKMARKS_KEY = "fuzz_local_bookmarks_v1";
  const MAX_RECENTS = 24;
  const MAX_CLOSED = 16;
  let bookmarkStorageMode = "account";

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function cleanUrl(value) {
    try {
      const url = new URL(String(value || ""));
      if (!['http:', 'https:'].includes(url.protocol)) return "";
      return url.toString().slice(0, 4000);
    } catch {
      return "";
    }
  }

  function cleanTitle(value, url = "") {
    const title = String(value || "").trim().slice(0, 160);
    if (title) return title;

    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "Saved page";
    }
  }

  function normalizeEntry(entry = {}) {
    const url = cleanUrl(entry.url);
    if (!url) return null;

    return {
      id: String(entry.id || ""),
      url,
      title: cleanTitle(entry.title, url),
      engine: entry.engine === "ultraviolet" ? "ultraviolet" : "scramjet",
      pinned: entry.pinned === true,
      createdAt: entry.createdAt || entry.created_at || new Date().toISOString(),
      updatedAt: entry.updatedAt || entry.updated_at || new Date().toISOString(),
      closedAt: entry.closedAt || new Date().toISOString(),
      visitedAt: entry.visitedAt || new Date().toISOString(),
    };
  }

  function recordRecent(entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized) return;

    const current = readJson(RECENTS_KEY, []);
    const next = [
      normalized,
      ...current.filter((item) => cleanUrl(item.url) !== normalized.url),
    ].slice(0, MAX_RECENTS);

    writeJson(RECENTS_KEY, next);
    window.dispatchEvent(new CustomEvent("fuzz:browser-data-changed", {
      detail: { type: "recent" },
    }));
  }

  function recordClosed(entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized) return;

    const current = readJson(CLOSED_KEY, []);
    const next = [normalized, ...current].slice(0, MAX_CLOSED);
    writeJson(CLOSED_KEY, next);
    window.dispatchEvent(new CustomEvent("fuzz:browser-data-changed", {
      detail: { type: "closed" },
    }));
  }

  function getRecents() {
    return readJson(RECENTS_KEY, []).map(normalizeEntry).filter(Boolean);
  }

  function getClosed() {
    return readJson(CLOSED_KEY, []).map(normalizeEntry).filter(Boolean);
  }

  function clearRecents() {
    writeJson(RECENTS_KEY, []);
    window.dispatchEvent(new CustomEvent("fuzz:browser-data-changed", {
      detail: { type: "recent" },
    }));
  }

  function clearClosed() {
    writeJson(CLOSED_KEY, []);
    window.dispatchEvent(new CustomEvent("fuzz:browser-data-changed", {
      detail: { type: "closed" },
    }));
  }

  function takeClosed() {
    const current = getClosed();
    const first = current.shift() || null;
    writeJson(CLOSED_KEY, current);
    window.dispatchEvent(new CustomEvent("fuzz:browser-data-changed", {
      detail: { type: "closed" },
    }));
    return first;
  }

  function localBookmarks() {
    return readJson(LOCAL_BOOKMARKS_KEY, []).map(normalizeEntry).filter(Boolean);
  }

  function writeLocalBookmarks(bookmarks) {
    writeJson(LOCAL_BOOKMARKS_KEY, bookmarks);
    window.dispatchEvent(new CustomEvent("fuzz:bookmarks-changed"));
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed (${response.status}).`);
      error.code = payload.code || "";
      throw error;
    }

    return payload;
  }

  async function listBookmarks() {
    if (bookmarkStorageMode === "browser") {
      return { bookmarks: localBookmarks(), source: "browser" };
    }

    try {
      const payload = await request("/api/bookmarks");
      const bookmarks = (payload.bookmarks || []).map(normalizeEntry).filter(Boolean);
      writeJson(LOCAL_BOOKMARKS_KEY, bookmarks);
      bookmarkStorageMode = "account";
      return { bookmarks, source: "account" };
    } catch {
      bookmarkStorageMode = "browser";
      return { bookmarks: localBookmarks(), source: "browser" };
    }
  }

  async function createBookmark(entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized) throw new Error("Enter a valid http:// or https:// address.");

    try {
      if (bookmarkStorageMode === "browser") {
        throw new Error("Using browser bookmark storage.");
      }

      const payload = await request("/api/bookmarks", {
        method: "POST",
        body: JSON.stringify(normalized),
      });
      bookmarkStorageMode = "account";
      window.dispatchEvent(new CustomEvent("fuzz:bookmarks-changed"));
      return normalizeEntry(payload.bookmark);
    } catch {
      bookmarkStorageMode = "browser";
      const bookmark = {
        ...normalized,
        id: normalized.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };
      const current = localBookmarks();
      const duplicate = current.find((item) => item.url === bookmark.url);
      const next = duplicate
        ? current.map((item) => item.url === bookmark.url ? { ...item, ...bookmark, id: item.id } : item)
        : [bookmark, ...current];
      writeLocalBookmarks(next);
      return duplicate || bookmark;
    }
  }

  async function updateBookmark(id, changes = {}) {
    try {
      if (bookmarkStorageMode === "browser" || String(id).startsWith("local-")) {
        throw new Error("Using browser bookmark storage.");
      }

      const payload = await request(`/api/bookmarks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      bookmarkStorageMode = "account";
      window.dispatchEvent(new CustomEvent("fuzz:bookmarks-changed"));
      return normalizeEntry(payload.bookmark);
    } catch {
      bookmarkStorageMode = "browser";
      const current = localBookmarks();
      let updated = null;
      const next = current.map((bookmark) => {
        if (bookmark.id !== id) return bookmark;
        updated = normalizeEntry({ ...bookmark, ...changes, id: bookmark.id });
        return updated || bookmark;
      });
      writeLocalBookmarks(next);
      return updated;
    }
  }

  async function deleteBookmark(id) {
    try {
      if (bookmarkStorageMode === "browser" || String(id).startsWith("local-")) {
        throw new Error("Using browser bookmark storage.");
      }

      await request(`/api/bookmarks/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      bookmarkStorageMode = "account";
    } catch {
      bookmarkStorageMode = "browser";
      writeLocalBookmarks(localBookmarks().filter((bookmark) => bookmark.id !== id));
    }

    window.dispatchEvent(new CustomEvent("fuzz:bookmarks-changed"));
  }

  async function importBookmarks(entries) {
    const safeEntries = Array.isArray(entries) ? entries.slice(0, 200) : [];
    let imported = 0;

    for (const entry of safeEntries) {
      try {
        await createBookmark(entry);
        imported += 1;
      } catch {}
    }

    return imported;
  }

  async function exportBookmarks() {
    const { bookmarks } = await listBookmarks();
    return {
      product: "Novaris",
      type: "bookmarks",
      exportedAt: new Date().toISOString(),
      bookmarks,
    };
  }

  window.FuzzBrowserData = Object.freeze({
    recordRecent,
    recordClosed,
    getRecents,
    getClosed,
    takeClosed,
    clearRecents,
    clearClosed,
    listBookmarks,
    createBookmark,
    updateBookmark,
    deleteBookmark,
    importBookmarks,
    exportBookmarks,
  });
})();
