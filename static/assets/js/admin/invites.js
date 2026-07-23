import { api } from "./api.js";
import {
  badge,
  emptyState,
  errorState,
  loadingState,
  panel,
} from "./components.js";
import { showToast } from "./toast.js";
import {
  copyText,
  escapeHtml,
  setButtonBusy,
} from "./utils.js";

let invites = [];

export async function renderInvites(container) {
  container.innerHTML = loadingState("Loading invite codes...");

  try {
    const payload = await api.invites();
    invites = payload.invites || [];
    paint(container);
  } catch (error) {
    container.innerHTML = errorState(error.message);
    container.querySelector("[data-action='retry']")?.addEventListener("click", () => {
      renderInvites(container);
    });
  }
}

function paint(container) {
  const available = invites.filter((invite) => !invite.used).length;
  const used = invites.filter((invite) => invite.used).length;

  container.innerHTML = `
    <div class="page-section">
      <section class="metric-grid">
        <article class="metric-card">
          <span>Total codes</span>
          <strong>${invites.length}</strong>
          <small>All generated invite codes</small>
        </article>

        <article class="metric-card">
          <span>Available</span>
          <strong>${available}</strong>
          <small>Ready for signup</small>
        </article>

        <article class="metric-card">
          <span>Redeemed</span>
          <strong>${used}</strong>
          <small>Used by registered accounts</small>
        </article>
      </section>

      ${panel({
        title: "Generate invite codes",
        subtitle: "Create one custom code or up to 25 random codes",
        body: `
          <form class="form-grid" id="invite-form">
            <input
              class="field"
              id="invite-code"
              type="text"
              maxlength="32"
              placeholder="Optional custom code"
            />

            <input
              class="field"
              id="invite-amount"
              type="number"
              min="1"
              max="25"
              value="1"
              aria-label="Number of codes"
            />

            <button class="button button-primary" id="generate-invite" type="submit">
              Generate
            </button>
          </form>
        `,
      })}

      <div style="height:14px"></div>

      ${panel({
        title: "Invite code history",
        subtitle: "Unused codes may be deleted; redeemed codes are retained",
        flush: true,
        body:
          invites.length === 0
            ? emptyState(
                "No invite codes",
                "Generate your first invite code above.",
              )
            : `
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Status</th>
                      <th>Redeemed by</th>
                      <th style="text-align:right">Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    ${invites.map(inviteRow).join("")}
                  </tbody>
                </table>
              </div>
            `,
      })}
    </div>
  `;

  const amountInput = container.querySelector("#invite-amount");
  const codeInput = container.querySelector("#invite-code");

  amountInput?.addEventListener("input", () => {
    const amount = Number(amountInput.value || 1);
    codeInput.disabled = amount > 1;

    if (amount > 1) {
      codeInput.value = "";
      codeInput.placeholder = "Custom code disabled for batches";
    } else {
      codeInput.placeholder = "Optional custom code";
    }
  });

  container.querySelector("#invite-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = container.querySelector("#generate-invite");
    const amount = Math.max(1, Math.min(25, Number(amountInput.value || 1)));
    const code = codeInput.value.trim();

    setButtonBusy(button, true, "Generating...");

    try {
      const result = await api.createInvites({ code, amount });
      invites = [...(result.invites || []), ...invites];

      showToast(
        `Created ${result.invites?.length || 0} invite code${result.invites?.length === 1 ? "" : "s"}.`,
        "success",
        "Invites generated",
      );

      paint(container);
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setButtonBusy(button, false);
    }
  });

  container.querySelectorAll("[data-copy-code]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await copyText(button.dataset.copyCode);
        showToast("Invite code copied to your clipboard.", "success", "Copied");
      } catch {
        showToast("The invite code could not be copied.", "error");
      }
    });
  });

  container.querySelectorAll("[data-delete-invite]").forEach((button) => {
    button.addEventListener("click", async () => {
      const inviteId = button.dataset.deleteInvite;
      const invite = invites.find((item) => String(item.id) === String(inviteId));

      if (!invite || invite.used) {
        return;
      }

      if (!window.confirm(`Delete invite code ${invite.code}?`)) {
        return;
      }

      setButtonBusy(button, true, "Deleting...");

      try {
        await api.deleteInvite(inviteId);
        invites = invites.filter((item) => String(item.id) !== String(inviteId));

        showToast("The unused invite code was deleted.", "success", "Invite deleted");
        paint(container);
      } catch (error) {
        showToast(error.message, "error");
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
}

function inviteRow(invite) {
  const redeemedBy = invite.usedByProfile?.username || invite.used_by || "—";

  return `
    <tr>
      <td>
        <span class="code-box">${escapeHtml(invite.code)}</span>
      </td>

      <td>
        ${invite.used
          ? badge("Redeemed", "badge-success")
          : badge("Available", "badge-warning")}
      </td>

      <td>${escapeHtml(redeemedBy)}</td>

      <td style="text-align:right">
        <button
          class="button button-small button-secondary"
          type="button"
          data-copy-code="${escapeHtml(invite.code)}"
        >
          Copy
        </button>

        <button
          class="button button-small button-danger"
          type="button"
          data-delete-invite="${escapeHtml(invite.id)}"
          ${invite.used ? "disabled" : ""}
        >
          Delete
        </button>
      </td>
    </tr>
  `;
}
