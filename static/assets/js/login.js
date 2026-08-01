document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("login-form");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const submitButton = document.getElementById("login-button");
  const messageElement = document.getElementById("auth-message");

  if (!form || !emailInput || !passwordInput || !submitButton || !messageElement) {
    console.error("The sign-in page is missing required controls.");
    return;
  }

  const requestedNextPage = getSafeNextPage();

  try {
    const statusResponse = await fetch("/api/auth/status", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    if (statusResponse.ok) {
      window.location.replace(await getPreferredNextPage(requestedNextPage));
      return;
    }
  } catch {
    // The form remains available if the status check is temporarily unavailable.
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;

    showMessage(messageElement, "", "");

    if (!email || !password) {
      showMessage(
        messageElement,
        "Enter your email and password.",
        "error",
      );
      return;
    }

    setLoading(submitButton, true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          result.error ||
            `Sign-in failed (${response.status}).`,
        );
      }

      sessionStorage.removeItem("fuzz-session-recovery");

      showMessage(
        messageElement,
        "Signed in successfully. Opening FuzzTheHuzz...",
        "success",
      );

      const destination = await getPreferredNextPage(requestedNextPage);
      window.setTimeout(() => {
        window.location.replace(destination);
      }, 250);
    } catch (error) {
      console.error("Login failed:", error);

      let message =
        error?.message || "Incorrect email or password.";

      if (message.toLowerCase().includes("email not confirmed")) {
        message = "Verify your email before signing in.";
      }

      showMessage(messageElement, message, "error");
    } finally {
      setLoading(submitButton, false);
    }
  });
});

function getSafeNextPage() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");

  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return null;
  }

  return next;
}

async function getPreferredNextPage(requestedNextPage) {
  if (requestedNextPage) return requestedNextPage;

  try {
    const response = await fetch("/api/personalization", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return "/";
    const data = await response.json();
    const destination = data?.preferences?.defaultPage;
    return ["/", "/chat", "/ai", "/b", "/d"].includes(destination)
      ? destination
      : "/";
  } catch {
    return "/";
  }
}

function setLoading(button, loading) {
  button.disabled = loading;
  button.textContent = loading ? "Signing in..." : "Sign in";
}

function showMessage(element, message, type) {
  element.textContent = message;
  element.className = type
    ? `auth-message ${type}`
    : "auth-message";
}
