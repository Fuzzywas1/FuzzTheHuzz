window.addEventListener("load", () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("../sw.js?v=2025-04-15", {
      scope: "/a/",
    }).catch(err => {
      console.warn("Service worker failed:", err);
    });
  }
});

/* 🌌 FRAME CHECK (safe fallback) */
let xl = false;

try {
  xl = window.top.location.pathname === "/d";
} catch {
  try {
    xl = window.parent.location.pathname === "/d";
  } catch {
    xl = false;
  }
}

/* 🔍 ELEMENTS */
const form = document.getElementById("fv");
const input = document.getElementById("input");

/* 🚀 FORM HANDLER */
if (form && input) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const value = input.value.trim();

    if (!value) return;

    try {
      if (xl) {
        processUrl(value, "");
      } else {
        processUrl(value, "/d");
      }
    } catch (err) {
      console.warn("Fallback navigation triggered:", err);
      processUrl(value, "/d");
    }
  });
}

/* 🌠 MAIN URL PROCESSOR */
function processUrl(value, path = "") {
  let url = value.trim();

  const engine =
    localStorage.getItem("engine") ||
    "https://duckduckgo.com/?q=";

  /* 🌌 detect URL vs search */
  if (!isUrl(url)) {
    url = engine + encodeURIComponent(url);
  } else if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  try {
    const encoded = __uv$config.encodeUrl(url);
    sessionStorage.setItem("GoUrl", encoded);

    const dy = localStorage.getItem("dy");

    /* 🌠 dynamic routing modes */
    if (dy === "true") {
      window.location.href = `/a/q/${encoded}`;
      return;
    }

    if (path) {
      location.href = path;
      return;
    }

    window.location.href = `/a/${encoded}`;

  } catch (err) {
    console.error("Encoding failed, redirecting normally:", err);
    window.location.href = url;
  }
}

/* 🚀 HELPERS */
function go(value) {
  processUrl(value, "/d");
}

function blank(value) {
  processUrl(value);
}

function dy(value) {
  const encoded = __uv$config.encodeUrl(value);
  processUrl(value, `/a/q/${encoded}`);
}

/* 🔍 URL DETECTION (IMPROVED) */
function isUrl(val = "") {
  const trimmed = val.trim();

  if (!trimmed) return false;

  return (
    /^https?:\/\//i.test(trimmed) ||
    /^[a-z0-9.-]+\.[a-z]{2,}/i.test(trimmed)
  );
}
