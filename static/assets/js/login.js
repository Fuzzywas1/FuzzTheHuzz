import { supabase } from "/assets/js/supabase.js";

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("login-form");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const submitButton = document.getElementById("login-button");
  const messageElement = document.getElementById("auth-message");

  if (!form) {
    return;
  }

  const nextPage = getSafeNextPage();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    const recoveryAttempted =
      sessionStorage.getItem("fuzz-session-recovery") === "true";

    if (!recoveryAttempted) {
      sessionStorage.setItem("fuzz-session-recovery", "true");

      const serverSessionCreated = await createServerSession(session);

      if (serverSessionCreated) {
        sessionStorage.removeItem("fuzz-session-recovery");
        window.location.replace(nextPage);
        return;
      }
    }

    sessionStorage.removeItem("fuzz-session-recovery");
    await supabase.auth.signOut();

    showMessage(
      messageElement,
      "Your previous session expired. Please sign in again.",
      "error",
    );
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
      const { data, error } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        });

      if (error) {
        throw error;
      }

      if (!data.session || !data.user) {
        throw new Error("The login session could not be created.");
      }

      const serverSessionCreated = await createServerSession(
        data.session,
      );

      if (!serverSessionCreated) {
        throw new Error(
          "The secure login session could not be created.",
        );
      }

      sessionStorage.removeItem("fuzz-session-recovery");

      showMessage(
        messageElement,
        "Signed in successfully. Opening FuzzTheHuzz...",
        "success",
      );

      window.setTimeout(() => {
        window.location.replace(nextPage);
      }, 400);
    } catch (error) {
      console.error("Login failed:", error);

      let message = "Incorrect email or password.";

      if (
        error.message &&
        error.message.toLowerCase().includes("email not confirmed")
      ) {
        message = "Verify your email before signing in.";
      } else if (error.message) {
        message = error.message;
      }

      showMessage(messageElement, message, "error");
    } finally {
      setLoading(submitButton, false);
    }
  });
});

async function createServerSession(session) {
  try {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      }),
    });

    return response.ok;
  } catch (error) {
    console.error("Server session request failed:", error);
    return false;
  }
}

function getSafeNextPage() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");

  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/";
  }

  return next;
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