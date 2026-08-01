(() => {
  const $ = (id) => document.getElementById(id);
  let state = {};
  let uploadedWallpaperUrl = "";

  function esc(value = "") {
    return String(value).replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[character]);
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function toast(message) {
    const node = $("settings-toast");
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, 3200);
  }

  function setMessage(message = "") {
    const node = $("settings-message");
    node.textContent = message;
    node.hidden = !message;
  }

  function updateOutputs() {
    $("wallpaper-blur-output").textContent = `${$("wallpaper-blur").value}px`;
    $("wallpaper-overlay-output").textContent = `${$("wallpaper-overlay").value}%`;
    $("surface-opacity-output").textContent = `${$("surface-opacity").value}%`;
    $("border-radius-output").textContent = `${$("border-radius").value}px`;
    $("font-scale-output").textContent = `${$("font-scale").value}%`;
  }

  function collect() {
    return {
      accentColor: $("accent-color").value,
      wallpaperExternalUrl: $("wallpaper-url").value.trim(),
      wallpaperFit: $("wallpaper-fit").value,
      wallpaperPosition: $("wallpaper-position").value,
      wallpaperBlur: Number($("wallpaper-blur").value),
      wallpaperOverlay: Number($("wallpaper-overlay").value) / 100,
      surfaceOpacity: Number($("surface-opacity").value) / 100,
      borderRadius: Number($("border-radius").value),
      fontScale: Number($("font-scale").value) / 100,
      sidebarMode: document.querySelector('input[name="sidebar-mode"]:checked')?.value || "expanded",
      density: $("density").value,
      defaultPage: $("default-page").value,
      reducedMotion: $("reduced-motion").checked,
      homeShowQuickLinks: $("show-quick-links").checked,
      homeShowBookmarks: $("show-bookmarks").checked,
      homeShowRecents: $("show-recents").checked,
      wallpaperUrl: uploadedWallpaperUrl || state.wallpaperUrl || "",
    };
  }

  function renderPreview(prefs = collect()) {
    const preview = $("wallpaper-preview");
    const url = prefs.wallpaperExternalUrl || uploadedWallpaperUrl || prefs.wallpaperUrl || "";
    if (url) {
      preview.style.backgroundImage = `linear-gradient(rgba(2,3,10,${prefs.wallpaperOverlay ?? .42}),rgba(2,3,10,${prefs.wallpaperOverlay ?? .42})),url("${url.replaceAll('"', '%22')}")`;
      preview.style.backgroundSize = prefs.wallpaperFit || "cover";
      preview.style.backgroundPosition = prefs.wallpaperPosition || "center";
      preview.innerHTML = "";
    } else {
      preview.style.backgroundImage = "";
      preview.innerHTML = '<span><i class="fa-regular fa-image"></i>No wallpaper selected</span>';
    }
    window.FuzzPersonalization?.apply?.({ ...prefs, wallpaperUrl: uploadedWallpaperUrl || prefs.wallpaperUrl || "" });
  }

  function fill(prefs = {}) {
    state = prefs;
    uploadedWallpaperUrl = prefs.wallpaperUrl || "";
    $("accent-color").value = prefs.accentColor || "#7c7cff";
    $("wallpaper-url").value = prefs.wallpaperExternalUrl || "";
    $("wallpaper-fit").value = prefs.wallpaperFit || "cover";
    $("wallpaper-position").value = prefs.wallpaperPosition || "center";
    $("wallpaper-blur").value = Number(prefs.wallpaperBlur ?? 0);
    $("wallpaper-overlay").value = Math.round(Number(prefs.wallpaperOverlay ?? .42) * 100);
    $("surface-opacity").value = Math.round(Number(prefs.surfaceOpacity ?? .78) * 100);
    $("border-radius").value = Number(prefs.borderRadius ?? 18);
    $("font-scale").value = Math.round(Number(prefs.fontScale ?? 1) * 100);
    document.querySelector(`input[name="sidebar-mode"][value="${prefs.sidebarMode || "expanded"}"]`)?.click();
    $("density").value = prefs.density || "comfortable";
    $("default-page").value = prefs.defaultPage || "/";
    $("reduced-motion").checked = prefs.reducedMotion === true;
    $("show-quick-links").checked = prefs.homeShowQuickLinks !== false;
    $("show-bookmarks").checked = prefs.homeShowBookmarks !== false;
    $("show-recents").checked = prefs.homeShowRecents !== false;
    updateOutputs();
    renderPreview(prefs);
  }

  async function uploadFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) throw new Error("Wallpaper images must be 5 MB or smaller.");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("That image could not be read."));
      reader.readAsDataURL(file);
    });
    toast("Uploading wallpaper…");
    const data = await request("/api/personalization/wallpaper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl, filename: file.name }),
    });
    uploadedWallpaperUrl = data.wallpaperUrl || "";
    state.wallpaperPath = data.wallpaperPath || "";
    renderPreview(collect());
    toast("Wallpaper uploaded. Save your settings to finish.");
  }

  async function save() {
    setMessage();
    const prefs = collect();
    const data = await request("/api/personalization", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    });
    state = data.preferences || prefs;
    uploadedWallpaperUrl = state.wallpaperUrl || "";
    localStorage.setItem("fuzzSidebarMode", state.sidebarMode || "expanded");
    window.FuzzPersonalization?.apply?.(state);
    renderPreview(state);
    toast("Customization saved.");
  }

  async function loadBlockedUsers() {
    const root = $("blocked-users-list");
    if (!root) return;
    try {
      const data = await request("/api/chat/blocks");
      const users = data.users || [];
      root.innerHTML = users.length
        ? users.map((user) => `<article class="blocked-user-row">
            <span class="blocked-user-avatar">${esc(String(user.username || "U").slice(0, 1).toUpperCase())}</span>
            <span><strong>${esc(user.username || "Unknown user")}</strong><small>${esc(user.role || "user")}</small></span>
            <button type="button" data-unblock-user="${esc(user.id)}">Unblock</button>
          </article>`).join("")
        : '<div class="blocked-users-empty"><i class="fa-regular fa-circle-check"></i><strong>No blocked users</strong><small>People you block in Fuzz Chat will appear here.</small></div>';
      root.querySelectorAll("[data-unblock-user]").forEach((button) => {
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await request(`/api/chat/users/${button.dataset.unblockUser}/block`, { method: "DELETE" });
            toast("User unblocked.");
            await loadBlockedUsers();
          } catch (error) {
            setMessage(error.message);
            button.disabled = false;
          }
        });
      });
    } catch (error) {
      root.innerHTML = `<div class="blocked-users-empty"><i class="fa-solid fa-triangle-exclamation"></i><strong>Could not load blocked users</strong><small>${esc(error.message)}</small></div>`;
    }
  }

  async function reset() {
    const data = await request("/api/personalization/reset", { method: "POST" });
    fill(data.preferences || {});
    localStorage.removeItem("fuzzPersonalization");
    localStorage.removeItem("backgroundImage");
    localStorage.setItem("fuzzSidebarMode", "expanded");
    toast("Customization reset.");
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      const data = await request("/api/personalization");
      fill(data.preferences || {});
    } catch (error) { setMessage(error.message); }
    void loadBlockedUsers();

    ["wallpaper-fit","wallpaper-position","wallpaper-blur","wallpaper-overlay","accent-color","surface-opacity","border-radius","font-scale","density","reduced-motion","wallpaper-url"].forEach((id) => {
      $(id)?.addEventListener("input", () => { updateOutputs(); renderPreview(collect()); });
      $(id)?.addEventListener("change", () => { updateOutputs(); renderPreview(collect()); });
    });
    document.querySelectorAll('input[name="sidebar-mode"],#show-quick-links,#show-bookmarks,#show-recents').forEach((node) => node.addEventListener("change", () => renderPreview(collect())));

    $("choose-wallpaper").addEventListener("click", () => $("wallpaper-file").click());
    $("wallpaper-file").addEventListener("change", async () => {
      try { await uploadFile($("wallpaper-file").files?.[0]); }
      catch (error) { setMessage(error.message); }
      finally { $("wallpaper-file").value = ""; }
    });
    $("remove-wallpaper").addEventListener("click", async () => {
      try {
        const data = await request("/api/personalization/wallpaper", { method: "DELETE" });
        uploadedWallpaperUrl = "";
        state.wallpaperUrl = "";
        state.wallpaperPath = "";
        localStorage.removeItem("backgroundImage");
        $("wallpaper-url").value = "";
        fill(data.preferences || collect());
        toast("Wallpaper removed.");
      } catch (error) { setMessage(error.message); }
    });
    $("save-settings").addEventListener("click", () => save().catch((error) => setMessage(error.message)));
    $("reset-settings").addEventListener("click", () => reset().catch((error) => setMessage(error.message)));
  });
})();
