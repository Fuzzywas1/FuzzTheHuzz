(() => {
  "use strict";

  const controllers = new WeakMap();

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
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function createController(root) {
    const $ = (id) => root.querySelector(`#${id}`);
    const $$ = (selector) => Array.from(root.querySelectorAll(selector));
    let state = {};
    let uploadedWallpaperUrl = "";
    let initialized = false;

    function toast(message) {
      const node = $("settings-toast");
      if (!node) return;
      node.textContent = message;
      node.hidden = false;
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => {
        node.hidden = true;
      }, 3200);
    }

    function setMessage(message = "") {
      const node = $("settings-message");
      if (!node) return;
      node.textContent = message;
      node.hidden = !message;
    }

    function updateOutputs() {
      const values = [
        ["wallpaper-blur-output", "wallpaper-blur", "px"],
        ["wallpaper-overlay-output", "wallpaper-overlay", "%"],
        ["surface-opacity-output", "surface-opacity", "%"],
        ["border-radius-output", "border-radius", "px"],
        ["font-scale-output", "font-scale", "%"],
      ];
      for (const [outputId, inputId, suffix] of values) {
        const output = $(outputId);
        const input = $(inputId);
        if (output && input) output.textContent = `${input.value}${suffix}`;
      }
    }

    function collect() {
      return {
        accentColor: $("accent-color")?.value || "#7c7cff",
        wallpaperExternalUrl: $("wallpaper-url")?.value.trim() || "",
        wallpaperFit: $("wallpaper-fit")?.value || "cover",
        wallpaperPosition: $("wallpaper-position")?.value || "center",
        wallpaperBlur: Number($("wallpaper-blur")?.value || 0),
        wallpaperOverlay: Number($("wallpaper-overlay")?.value || 42) / 100,
        surfaceOpacity: Number($("surface-opacity")?.value || 78) / 100,
        borderRadius: Number($("border-radius")?.value || 18),
        fontScale: Number($("font-scale")?.value || 100) / 100,
        sidebarMode: root.querySelector('input[name="sidebar-mode"]:checked')?.value || "expanded",
        density: $("density")?.value || "comfortable",
        defaultPage: $("default-page")?.value || "/",
        reducedMotion: $("reduced-motion")?.checked === true,
        showDeviceStatus: $("show-device-status")?.checked !== false,
        homeShowQuickLinks: $("show-quick-links")?.checked !== false,
        homeShowBookmarks: $("show-bookmarks")?.checked !== false,
        homeShowRecents: $("show-recents")?.checked !== false,
        wallpaperUrl: uploadedWallpaperUrl || state.wallpaperUrl || "",
      };
    }

    function renderPreview(prefs = collect()) {
      const preview = $("wallpaper-preview");
      if (!preview) return;
      const url = prefs.wallpaperExternalUrl || uploadedWallpaperUrl || prefs.wallpaperUrl || "";
      if (url) {
        const safeUrl = String(url).replaceAll('"', "%22");
        const overlay = Number(prefs.wallpaperOverlay ?? 0.42);
        preview.style.backgroundImage = `linear-gradient(rgba(2,3,10,${overlay}),rgba(2,3,10,${overlay})),url("${safeUrl}")`;
        preview.style.backgroundSize = prefs.wallpaperFit || "cover";
        preview.style.backgroundPosition = prefs.wallpaperPosition || "center";
        preview.innerHTML = "";
      } else {
        preview.style.backgroundImage = "";
        preview.innerHTML = '<span><i class="fa-regular fa-image"></i>No wallpaper selected</span>';
      }
      window.FuzzPersonalization?.apply?.({
        ...prefs,
        wallpaperUrl: uploadedWallpaperUrl || prefs.wallpaperUrl || "",
      });
    }

    function setValue(id, value) {
      const node = $(id);
      if (node) node.value = value;
    }

    function setChecked(id, value) {
      const node = $(id);
      if (node) node.checked = Boolean(value);
    }

    function fill(prefs = {}) {
      state = prefs;
      uploadedWallpaperUrl = prefs.wallpaperUrl || "";
      setValue("accent-color", prefs.accentColor || "#7c7cff");
      setValue("wallpaper-url", prefs.wallpaperExternalUrl || "");
      setValue("wallpaper-fit", prefs.wallpaperFit || "cover");
      setValue("wallpaper-position", prefs.wallpaperPosition || "center");
      setValue("wallpaper-blur", Number(prefs.wallpaperBlur ?? 0));
      setValue("wallpaper-overlay", Math.round(Number(prefs.wallpaperOverlay ?? 0.42) * 100));
      setValue("surface-opacity", Math.round(Number(prefs.surfaceOpacity ?? 0.78) * 100));
      setValue("border-radius", Number(prefs.borderRadius ?? 18));
      setValue("font-scale", Math.round(Number(prefs.fontScale ?? 1) * 100));
      const mode = root.querySelector(`input[name="sidebar-mode"][value="${prefs.sidebarMode || "expanded"}"]`);
      if (mode) mode.checked = true;
      setValue("density", prefs.density || "comfortable");
      setValue("default-page", prefs.defaultPage || "/");
      setChecked("reduced-motion", prefs.reducedMotion === true);
      let localDeviceStatus = true;
      try {
        localDeviceStatus = localStorage.getItem("fuzzDeviceStatusEnabled") !== "false";
      } catch {}
      setChecked("show-device-status", localDeviceStatus);
      setChecked("show-quick-links", prefs.homeShowQuickLinks !== false);
      setChecked("show-bookmarks", prefs.homeShowBookmarks !== false);
      setChecked("show-recents", prefs.homeShowRecents !== false);
      updateOutputs();
      renderPreview(prefs);
    }

    async function uploadFile(file) {
      if (!file) return;
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        throw new Error("Choose a PNG, JPEG, or WebP image.");
      }
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("Wallpaper images must be 5 MB or smaller.");
      }
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
      toast("Wallpaper uploaded. Save customization to finish.");
    }

    async function save() {
      setMessage();
      const button = $("save-settings");
      if (button) button.disabled = true;
      try {
        const prefs = collect();
        const data = await request("/api/personalization", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(prefs),
        });
        state = data.preferences || prefs;
        uploadedWallpaperUrl = state.wallpaperUrl || "";
        localStorage.setItem("fuzzSidebarMode", state.sidebarMode || "expanded");
        localStorage.setItem("fuzzDeviceStatusEnabled", prefs.showDeviceStatus === false ? "false" : "true");
        window.FuzzPersonalization?.apply?.(state);
        renderPreview(state);
        toast("Customization saved.");
      } finally {
        if (button) button.disabled = false;
      }
    }

    async function loadBlockedUsers() {
      const listRoot = $("blocked-users-list");
      if (!listRoot) return;
      try {
        const data = await request("/api/chat/blocks");
        const users = data.users || [];
        listRoot.innerHTML = users.length
          ? users.map((user) => `<article class="blocked-user-row">
              <span class="blocked-user-avatar">${esc(String(user.username || "U").slice(0, 1).toUpperCase())}</span>
              <span><strong>${esc(user.username || "Unknown user")}</strong><small>${esc(user.role || "user")}</small></span>
              <button type="button" data-unblock-user="${esc(user.id)}">Unblock</button>
            </article>`).join("")
          : '<div class="blocked-users-empty"><i class="fa-regular fa-circle-check"></i><strong>No blocked users</strong><small>People you block in Novaris Chat will appear here.</small></div>';
        $$('[data-unblock-user]').forEach((button) => {
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
        listRoot.innerHTML = `<div class="blocked-users-empty"><i class="fa-solid fa-triangle-exclamation"></i><strong>Could not load blocked users</strong><small>${esc(error.message)}</small></div>`;
      }
    }

    async function reset() {
      const button = $("reset-settings");
      if (button) button.disabled = true;
      try {
        const data = await request("/api/personalization/reset", { method: "POST" });
        fill(data.preferences || {});
        localStorage.removeItem("fuzzPersonalization");
        localStorage.removeItem("backgroundImage");
        localStorage.setItem("fuzzSidebarMode", "expanded");
        localStorage.setItem("fuzzDeviceStatusEnabled", "true");
        toast("Customization reset.");
      } finally {
        if (button) button.disabled = false;
      }
    }

    function bind() {
      [
        "wallpaper-fit",
        "wallpaper-position",
        "wallpaper-blur",
        "wallpaper-overlay",
        "accent-color",
        "surface-opacity",
        "border-radius",
        "font-scale",
        "density",
        "reduced-motion",
        "wallpaper-url",
      ].forEach((id) => {
        const node = $(id);
        node?.addEventListener("input", () => {
          updateOutputs();
          renderPreview(collect());
        });
        node?.addEventListener("change", () => {
          updateOutputs();
          renderPreview(collect());
        });
      });

      $$('input[name="sidebar-mode"],#show-quick-links,#show-bookmarks,#show-recents,#show-device-status').forEach((node) => {
        node.addEventListener("change", () => renderPreview(collect()));
      });

      $("choose-wallpaper")?.addEventListener("click", () => $("wallpaper-file")?.click());
      $("wallpaper-file")?.addEventListener("change", async () => {
        const input = $("wallpaper-file");
        try {
          await uploadFile(input?.files?.[0]);
        } catch (error) {
          setMessage(error.message);
        } finally {
          if (input) input.value = "";
        }
      });
      $("remove-wallpaper")?.addEventListener("click", async () => {
        try {
          const data = await request("/api/personalization/wallpaper", { method: "DELETE" });
          uploadedWallpaperUrl = "";
          state.wallpaperUrl = "";
          state.wallpaperPath = "";
          localStorage.removeItem("backgroundImage");
          setValue("wallpaper-url", "");
          fill(data.preferences || collect());
          toast("Wallpaper removed.");
        } catch (error) {
          setMessage(error.message);
        }
      });
      $("save-settings")?.addEventListener("click", () => {
        save().catch((error) => setMessage(error.message));
      });
      $("reset-settings")?.addEventListener("click", () => {
        reset().catch((error) => setMessage(error.message));
      });
    }

    async function init() {
      if (initialized || !$("save-settings")) return;
      initialized = true;
      root.dataset.fuzzCustomizationInitialized = "true";
      bind();
      try {
        const data = await request("/api/personalization");
        fill(data.preferences || {});
      } catch (error) {
        setMessage(error.message);
      }
      void loadBlockedUsers();
    }

    return { init, collect, fill, save, reset };
  }

  function init(root = document) {
    if (!root) return null;
    let controller = controllers.get(root);
    if (!controller) {
      controller = createController(root);
      controllers.set(root, controller);
    }
    void controller.init();
    return controller;
  }

  window.FuzzCustomization = { init };
  window.dispatchEvent(new CustomEvent("fuzz:customization-ready"));

  document.addEventListener("DOMContentLoaded", () => {
    const root = document.querySelector("[data-fuzz-customization]") || document;
    init(root);
  });
})();
