(() => {
  "use strict";

  const form = document.getElementById("fv");
  const input = document.getElementById("input");

  let insideTabs = false;
  try {
    insideTabs = window.top.location.pathname === "/d";
  } catch {}

  async function submit(value) {
    const rawValue = String(value || "").trim();
    if (!rawValue) return;

    const url = window.FuzzProxy.normalizeInput(rawValue);
    const engine = window.FuzzProxy.getEngine();
    window.FuzzProxy.logNavigation(
      url,
      engine,
      window.FuzzProxy.isUrl(rawValue) ? "" : rawValue,
      insideTabs ? "tabs-address-bar" : "home-search",
    );

    if (insideTabs && typeof window.fuzzNavigateActiveTab === "function") {
      await window.fuzzNavigateActiveTab(url, engine);
      return;
    }

    window.FuzzProxy.openTabs(url, engine);
  }

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(input?.value).catch((error) => {
      console.error("Proxy navigation failed:", error);
      const errorId = window.FuzzDiagnostics?.report?.(error, {
        prefix: "HM",
        component: "home-search",
        action: "proxy.home_navigation_failed",
        engine: window.FuzzProxy?.getEngine?.(),
        targetUrl: input?.value,
      });
      window.alert(`The page could not be opened: ${error.message}${errorId ? `\nError ID: ${errorId}` : ""}`);
    });
  });

  window.processUrl = (value, path = "/d") => {
    if (path === "/d") return window.FuzzProxy.openTabs(value);
    return window.FuzzProxy.openStandalone(value);
  };
  window.go = (value) => window.FuzzProxy.openTabs(value);
  window.blank = (value) => window.FuzzProxy.openStandalone(value);
  window.dy = (value) => window.FuzzProxy.openTabs(value, "scramjet");
  window.now = (value) => window.FuzzProxy.openTabs(value, "scramjet");
})();
