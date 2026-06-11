let qp;

try {
  qp = window.top.location.pathname === "/d";
} catch {
  try {
    qp = window.parent.location.pathname === "/d";
  } catch {
    qp = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {

  /* 🌌 REMOVED: unsafe external ad injection for clean build
     (kept empty intentionally for safety + performance)
  */

  const nav = document.querySelector(".f-nav");

  if (nav) {
    const themeId = localStorage.getItem("theme");

    let LogoUrl = "/assets/media/favicon/main.png";
    if (themeId === "Inverted") {
      LogoUrl = "/assets/media/favicon/main-inverted.png";
    }

    /* 🌠 SPACE HUD NAVBAR */
    const html = `
      <div id="icon-container">
  <a class="icon" href="/./">
    <span class="logo-text">FuzzTheHuzz</span>
  </a>
</div>

      <div class="f-nav-right">

        <!-- 🌌 GAMES TAB REMOVED (frontend only) -->

        <a class="navbar-link" href="/./b">
          <i class="fa-solid fa-phone navbar-icon"></i>
          <span>Apps</span>
        </a>

        ${qp ? "" : `
        <a class="navbar-link" href="/./d">
          <i class="fa-solid fa-laptop navbar-icon"></i>
          <span>Tabs</span>
        </a>`}

        <a class="navbar-link" href="/./c">
          <i class="fa-solid fa-gear navbar-icon settings-icon"></i>
          <span>Settings</span>
        </a>

      </div>
    `;

    nav.innerHTML = html;
  }

  /* 🌌 SAFE LOCALSTORAGE INIT */
  if (localStorage.getItem("dy") == null) {
    localStorage.setItem("dy", "false");
  }

  /* 🎨 THEME SYSTEM (UNCHANGED CORE) */
  const themeid = localStorage.getItem("theme");
  const themeEle = document.createElement("link");
  themeEle.rel = "stylesheet";

  const themes = {
    catppuccinMocha: "/assets/css/themes/catppuccin/mocha.css?v=00",
    catppuccinMacchiato: "/assets/css/themes/catppuccin/macchiato.css?v=00",
    catppuccinFrappe: "/assets/css/themes/catppuccin/frappe.css?v=00",
    catppuccinLatte: "/assets/css/themes/catppuccin/latte.css?v=00",
    Inverted: "/assets/css/themes/colors/inverted.css?v=00",
    sky: "/assets/css/themes/colors/sky.css?v=00",
  };

  if (themes[themeid]) {
    themeEle.href = themes[themeid];
    document.body.appendChild(themeEle);
  } else {
    const customThemeEle = document.createElement("style");
    customThemeEle.textContent = localStorage.getItem(`theme-${themeid}`) || "";
    document.head.appendChild(customThemeEle);
  }

  /* 🌌 CLOAK SYSTEM */
  const icon = document.getElementById("tab-favicon");
  const name = document.getElementById("t");
  const selectedValue = localStorage.getItem("selectedOption");

  function setCloak(nameValue, iconUrl) {
    const customName = localStorage.getItem("CustomName");
    const customIcon = localStorage.getItem("CustomIcon");

    let finalName = customName || nameValue;
    let finalIcon = customIcon || iconUrl;

    if (finalIcon && icon) {
      icon.setAttribute("href", finalIcon);
      localStorage.setItem("icon", finalIcon);
    }

    if (finalName && name) {
      name.textContent = finalName;
      localStorage.setItem("name", finalName);
    }
  }

  const options = {
    Google: { name: "Google", icon: "/assets/media/favicon/google.png" },
    Drive: { name: "My Drive - Google Drive", icon: "/assets/media/favicon/drive.png" },
    Classroom: { name: "Home", icon: "/assets/media/favicon/classroom.png" },
    Gmail: { name: "Gmail", icon: "/assets/media/favicon/gmail.png" },
    Canvas: { name: "Dashboard", icon: "/assets/media/favicon/canvas.png" },
    IXL: { name: "IXL | Dashboard", icon: "/assets/media/favicon/ixl.png" }
  };

  if (options[selectedValue]) {
    setCloak(options[selectedValue].name, options[selectedValue].icon);
  }

  /* ⌨️ KEY COMBO REDIRECT */
  const eventKey = JSON.parse(localStorage.getItem("eventKey")) || ["Ctrl", "E"];
  const pLink = localStorage.getItem("pLink") || "https://classroom.google.com/";

  let pressedKeys = [];

  document.addEventListener("keydown", (event) => {
    pressedKeys.push(event.key);

    if (pressedKeys.length > eventKey.length) {
      pressedKeys.shift();
    }

    if (eventKey.every((key, i) => key === pressedKeys[i])) {
      window.location.href = pLink;
      pressedKeys = [];
    }
  });

  /* 🖼 BACKGROUND IMAGE */
  const savedBackgroundImage = localStorage.getItem("backgroundImage");

  if (savedBackgroundImage) {
    document.body.style.backgroundImage = `url('${savedBackgroundImage}')`;
  }
});

/* 🎨 THEME SWITCH */
function themeChange(select) {
  const value = select.value;
  localStorage.setItem("theme", value);
  location.reload();
}
