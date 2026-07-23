import { api } from "./api.js";
import {
  errorState,
  loadingState,
  panel,
  serviceList,
} from "./components.js";
import { showToast } from "./toast.js";
import {
  escapeHtml,
  formatBytes,
  formatDate,
  formatUptime,
  setButtonBusy,
} from "./utils.js";

export async function renderSettings(container) {
  container.innerHTML = loadingState("Loading system settings...");

  try {
    const [systemPayload, platformPayload] = await Promise.all([
      api.system(),
      api.platformSettings(),
    ]);

    paint(container, systemPayload, platformPayload);
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container.querySelector("[data-action='retry']")?.addEventListener("click", () => {
      renderSettings(container);
    });
  }
}

function paint(container, systemPayload, platformPayload) {
  const services = systemPayload.services || {};
  const processInfo = systemPayload.process || {};
  const memory = processInfo.memory || {};
  const settings = platformPayload.settings || {};

  container.innerHTML = `
    <div class="page-section">
      <section class="split-grid">
        ${panel({
          title: "Service status",
          subtitle: `Last checked ${escapeHtml(systemPayload.checkedAt || "now")}`,
          body: serviceList([
            {
              name: "Server",
              icon: "◉",
              online: services.server?.online,
            },
            {
              name: "Supabase",
              icon: "◆",
              online: services.supabase?.online,
            },
            {
              name: "OpenAI",
              icon: "✦",
              online: services.openai?.online,
            },
            {
              name: "Bare Server",
              icon: "◈",
              online: services.bareServer?.online,
            },
            {
              name: "Authentication",
              icon: "⌁",
              online: services.authentication?.online,
            },
          ]),
        })}

        ${panel({
          title: "Runtime",
          subtitle: "Current Node process details",
          body: `
            <div class="settings-list">
              <div class="setting-row">
                <div class="setting-copy">
                  <strong>Node version</strong>
                  <span>Server JavaScript runtime</span>
                </div>
                <strong>${escapeHtml(processInfo.nodeVersion || "Unknown")}</strong>
              </div>

              <div class="setting-row">
                <div class="setting-copy">
                  <strong>Platform</strong>
                  <span>Host operating system</span>
                </div>
                <strong>${escapeHtml(processInfo.platform || "Unknown")}</strong>
              </div>

              <div class="setting-row">
                <div class="setting-copy">
                  <strong>Server uptime</strong>
                  <span>Time since the current process started</span>
                </div>
                <strong>${escapeHtml(formatUptime(services.server?.uptimeSeconds))}</strong>
              </div>

              <div class="setting-row">
                <div class="setting-copy">
                  <strong>Resident memory</strong>
                  <span>Current process RSS</span>
                </div>
                <strong>${escapeHtml(formatBytes(memory.rss))}</strong>
              </div>
            </div>
          `,
        })}
      </section>

      <div style="height:14px"></div>

      <form id="platform-settings-form">
        ${panel({
          title: "Maintenance mode",
          subtitle: "Temporarily replace the website with a maintenance screen",
          body: `
            <div class="maintenance-status-card ${
              settings.maintenanceActive ? "is-active" : ""
            }">
              <div>
                <span class="maintenance-status-dot"></span>
                <strong>
                  ${settings.maintenanceActive ? "Maintenance is active" : "Website is live"}
                </strong>
                <p>
                  ${
                    settings.maintenanceActive
                      ? `Users currently see the maintenance screen${
                          settings.maintenanceEndAt
                            ? ` until ${escapeHtml(formatDate(settings.maintenanceEndAt))}`
                            : "."
                        }`
                      : "Turn this on when you need to safely work on the website."
                  }
                </p>
              </div>

              <label class="switch switch-large">
                <input
                  id="maintenance-enabled"
                  type="checkbox"
                  ${settings.maintenanceEnabled ? "checked" : ""}
                />
                <span class="switch-track"></span>
              </label>
            </div>

            <div class="form-grid settings-form-grid">
              <label class="field-group field-span-two">
                <span>Maintenance message</span>
                <textarea
                  class="field textarea-field"
                  id="maintenance-message"
                  maxlength="500"
                  placeholder="Fuzz is temporarily undergoing maintenance."
                >${escapeHtml(
                  settings.maintenanceMessage ||
                    "Fuzz is temporarily undergoing maintenance. Please check back soon.",
                )}</textarea>
              </label>

              <label class="field-group">
                <span>Optional end time</span>
                <input
                  class="field"
                  id="maintenance-end-at"
                  type="datetime-local"
                  value="${escapeHtml(toDateTimeLocal(settings.maintenanceEndAt))}"
                />
                <small>The site automatically reopens after this time.</small>
              </label>

              <div class="field-group">
                <span>Staff access</span>
                ${toggleSetting(
                  "allow-admin-bypass",
                  "Allow admin bypass",
                  "Admins and owners may continue using protected pages.",
                  settings.allowAdminBypass !== false,
                )}
              </div>
            </div>
          `,
        })}

        <div style="height:14px"></div>

        ${panel({
          title: "Feature switches",
          subtitle: "Disable individual parts of FuzzTheHuzz without taking down the entire site",
          body: `
            <div class="feature-toggle-grid">
              ${featureToggle(
                "ai-enabled",
                "Fuzz AI",
                "AI chat, saved chats and AI API responses.",
                "✦",
                settings.aiEnabled !== false,
              )}
              ${featureToggle(
                "proxy-enabled",
                "Proxy",
                "Bare server browsing and proxy request logging.",
                "◈",
                settings.proxyEnabled !== false,
              )}
              ${featureToggle(
                "apps-enabled",
                "Apps",
                "The apps catalog and app-launch page.",
                "▦",
                settings.appsEnabled !== false,
              )}
              ${featureToggle(
                "games-enabled",
                "Games",
                "The games catalog and play routes.",
                "◇",
                settings.gamesEnabled !== false,
              )}
              ${featureToggle(
                "registrations-enabled",
                "Registrations",
                "New invite-code account creation.",
                "◎",
                settings.registrationsEnabled !== false,
              )}
              ${featureToggle(
                "image-uploads-enabled",
                "AI image uploads",
                "Images attached to Fuzz AI prompts.",
                "▧",
                settings.imageUploadsEnabled !== false,
              )}
            </div>
          `,
        })}

        <div class="settings-save-bar">
          <div>
            <strong>Platform configuration</strong>
            <span>
              Last changed ${escapeHtml(formatDate(settings.updatedAt))}
              ${settings.updatedByUsername ? ` by ${escapeHtml(settings.updatedByUsername)}` : ""}
            </span>
          </div>

          <button class="button button-primary" id="save-platform-settings" type="submit">
            Save platform settings
          </button>
        </div>
      </form>

      <div style="height:14px"></div>

      ${panel({
        title: "System actions",
        subtitle: "Owner-only maintenance operations",
        body: `
          <div class="settings-list">
            <div class="setting-row">
              <div class="setting-copy">
                <strong>Clear remote asset cache</strong>
                <span>
                  Deletes ${systemPayload.cache?.entries || 0} cached remote assets.
                  New requests will download them again.
                </span>
              </div>

              <button class="button button-danger" id="clear-cache-button" type="button">
                Clear cache
              </button>
            </div>

            <div class="setting-row">
              <div class="setting-copy">
                <strong>Dashboard cache</strong>
                <span>
                  Dashboard responses are cached for
                  ${Math.round((systemPayload.cache?.dashboardTtlMs || 0) / 1000)} seconds.
                </span>
              </div>

              <span class="badge badge-info">Automatic</span>
            </div>
          </div>
        `,
      })}
    </div>
  `;

  bindPlatformForm(container);
  bindCacheButton(container);
}

function bindPlatformForm(container) {
  const form = container.querySelector("#platform-settings-form");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = container.querySelector("#save-platform-settings");
    const maintenanceEndAt = dateInputToIso(
      container.querySelector("#maintenance-end-at").value,
    );

    const payload = {
      maintenanceEnabled: container.querySelector("#maintenance-enabled").checked,
      maintenanceMessage: container
        .querySelector("#maintenance-message")
        .value.trim(),
      maintenanceEndAt,
      allowAdminBypass: container.querySelector("#allow-admin-bypass").checked,
      aiEnabled: container.querySelector("#ai-enabled").checked,
      proxyEnabled: container.querySelector("#proxy-enabled").checked,
      appsEnabled: container.querySelector("#apps-enabled").checked,
      gamesEnabled: container.querySelector("#games-enabled").checked,
      registrationsEnabled: container.querySelector("#registrations-enabled").checked,
      imageUploadsEnabled: container.querySelector("#image-uploads-enabled").checked,
    };

    if (payload.maintenanceEnabled && !payload.maintenanceMessage) {
      showToast("Add a maintenance message before enabling maintenance mode.", "error");
      return;
    }

    setButtonBusy(button, true, "Saving...");

    try {
      await api.updatePlatformSettings(payload);
      showToast("Platform settings were saved.", "success", "Settings updated");
      await renderSettings(container);
    } catch (error) {
      showToast(error.message, "error");
      setButtonBusy(button, false);
    }
  });
}

function bindCacheButton(container) {
  const button = container.querySelector("#clear-cache-button");

  button?.addEventListener("click", async () => {
    if (!window.confirm("Clear the remote asset cache now?")) {
      return;
    }

    setButtonBusy(button, true, "Clearing...");

    try {
      const result = await api.clearCache();

      showToast(
        `Cleared ${result.clearedEntries || 0} cached assets.`,
        "success",
        "Cache cleared",
      );

      await renderSettings(container);
    } catch (error) {
      showToast(error.message, "error");
      setButtonBusy(button, false);
    }
  });
}

function featureToggle(id, title, description, icon, checked) {
  return `
    <label class="feature-toggle" for="${escapeHtml(id)}">
      <span class="feature-toggle-icon">${escapeHtml(icon)}</span>
      <span class="feature-toggle-copy">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(description)}</span>
      </span>
      <span class="switch">
        <input id="${escapeHtml(id)}" type="checkbox" ${checked ? "checked" : ""} />
        <span class="switch-track"></span>
      </span>
    </label>
  `;
}

function toggleSetting(id, title, description, checked) {
  return `
    <label class="toggle-setting compact" for="${escapeHtml(id)}">
      <span class="toggle-copy">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(description)}</span>
      </span>
      <span class="switch">
        <input id="${escapeHtml(id)}" type="checkbox" ${checked ? "checked" : ""} />
        <span class="switch-track"></span>
      </span>
    </label>
  `;
}

function toDateTimeLocal(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function dateInputToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
