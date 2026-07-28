(() => {
  "use strict";

  const SESSION_COUNT_KEY = "fuzz_diagnostic_report_count";
  const MAX_REPORTS_PER_SESSION = 12;

  function makeId(prefix = "FX") {
    const time = Date.now().toString(36).slice(-6).toUpperCase();
    const random = globalThis.crypto?.getRandomValues
      ? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(3)))
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase()
      : Math.random().toString(16).slice(2, 8).toUpperCase();

    return `${prefix}-${time}-${random}`;
  }

  function reportCount() {
    try {
      return Number(sessionStorage.getItem(SESSION_COUNT_KEY) || 0);
    } catch {
      return 0;
    }
  }

  function incrementReportCount() {
    try {
      sessionStorage.setItem(SESSION_COUNT_KEY, String(reportCount() + 1));
    } catch {}
  }

  function clean(value, maximum = 4000) {
    return String(value ?? "").trim().slice(0, maximum);
  }

  function report(error, context = {}) {
    const errorId = clean(context.errorId || makeId(context.prefix || "FX"), 80);
    const message = clean(error?.message || error || "Unknown client error", 1200);
    const stack = clean(error?.stack || "", 6000);

    if (reportCount() >= MAX_REPORTS_PER_SESSION) {
      return errorId;
    }

    incrementReportCount();

    fetch("/api/client-errors", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        errorId,
        message,
        stack,
        page: `${location.pathname}${location.search}`.slice(0, 1000),
        component: clean(context.component || "browser", 120),
        action: clean(context.action || "client.error", 120),
        engine: clean(context.engine || "", 50),
        targetUrl: clean(context.targetUrl || "", 4000),
        metadata: context.metadata && typeof context.metadata === "object"
          ? context.metadata
          : {},
      }),
    }).catch(() => {});

    return errorId;
  }

  window.addEventListener("error", (event) => {
    const source = String(event.filename || "");
    if (source.startsWith("chrome-extension://") || source.startsWith("moz-extension://")) {
      return;
    }

    report(event.error || event.message, {
      prefix: "JS",
      component: "window",
      action: "client.javascript_error",
      metadata: {
        filename: source.slice(0, 1000),
        line: Number(event.lineno || 0),
        column: Number(event.colno || 0),
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    report(event.reason || "Unhandled promise rejection", {
      prefix: "PR",
      component: "window",
      action: "client.unhandled_rejection",
    });
  });

  window.FuzzDiagnostics = Object.freeze({
    makeId,
    report,
  });
})();
