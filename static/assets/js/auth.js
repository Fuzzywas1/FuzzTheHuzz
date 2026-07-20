document.addEventListener("DOMContentLoaded", () => {
  const signupForm = document.getElementById("signup-form");

  if (signupForm) {
    setupSignupForm(signupForm);
  }
});

function setupSignupForm(form) {
  const messageElement = document.getElementById("auth-message");
  const submitButton = document.getElementById("signup-button");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    clearMessage(messageElement);

    const username = document.getElementById("username").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const confirmPassword =
      document.getElementById("confirm-password").value;

    const inviteCode = document
      .getElementById("invite-code")
      .value.trim()
      .toUpperCase();

    const acceptedTerms = document.getElementById("terms").checked;

    const usernamePattern = /^[A-Za-z0-9_]{3,20}$/;

    if (!usernamePattern.test(username)) {
      showMessage(
        messageElement,
        "Username must be 3–20 characters and only contain letters, numbers, or underscores.",
        "error",
      );

      return;
    }

    if (!email) {
      showMessage(messageElement, "Enter your email address.", "error");
      return;
    }

    if (password.length < 8) {
      showMessage(
        messageElement,
        "Password must be at least 8 characters.",
        "error",
      );

      return;
    }

    if (password !== confirmPassword) {
      showMessage(messageElement, "The passwords do not match.", "error");
      return;
    }

    if (!inviteCode) {
      showMessage(messageElement, "Enter your invite code.", "error");
      return;
    }

    if (!acceptedTerms) {
      showMessage(
        messageElement,
        "You must accept the account rules before signing up.",
        "error",
      );

      return;
    }

    setLoading(submitButton, true);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          email,
          password,
          inviteCode,
        }),
      });

      const result = await response.json().catch(() => ({
        error: "The server returned an invalid response.",
      }));

      if (!response.ok) {
        throw new Error(result.error || "Account creation failed.");
      }

      form.reset();

      showMessage(
        messageElement,
        result.message ||
          "Account created. Check your email to verify your account.",
        "success",
      );
    } catch (error) {
      console.error("Signup request failed:", error);

      showMessage(
        messageElement,
        error.message || "Account creation failed. Please try again.",
        "error",
      );
    } finally {
      setLoading(submitButton, false);
    }
  });
}

function setLoading(button, loading) {
  if (!button) {
    return;
  }

  button.disabled = loading;
  button.textContent = loading ? "Creating account..." : "Create account";
}

function clearMessage(element) {
  if (!element) {
    return;
  }

  element.textContent = "";
  element.className = "auth-message";
}

function showMessage(element, message, type) {
  if (!element) {
    return;
  }

  element.textContent = message;
  element.className = `auth-message ${type}`;
}