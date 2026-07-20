const conversation = [];

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const sendButton = document.getElementById("send-button");

  input.addEventListener("input", () => {
    resizeTextarea(input);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const message = input.value.trim();

    if (!message || sendButton.disabled) {
      return;
    }

    conversation.push({
      role: "user",
      content: message,
    });

    addMessage("user", message);

    input.value = "";
    resizeTextarea(input);
    setLoading(true);

    const assistantBody = addMessage("assistant", "");
    assistantBody.classList.add("thinking");

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          messages: conversation,
        }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({
          error: "The server returned an invalid response.",
        }));

        throw new Error(
          result.error || "Fuzz AI request failed.",
        );
      }

      if (!response.body) {
        throw new Error("Streaming is not supported by this browser.");
      }

      assistantBody.classList.remove("thinking");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let fullReply = "";

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, {
          stream: true,
        });

        fullReply += chunk;
        assistantBody.textContent = fullReply;

        assistantBody.parentElement.scrollIntoView({
          behavior: "smooth",
          block: "end",
        });
      }

      fullReply += decoder.decode();
      assistantBody.textContent = fullReply;

      if (!fullReply.trim()) {
        throw new Error("Fuzz AI returned an empty response.");
      }

      conversation.push({
        role: "assistant",
        content: fullReply,
      });
    } catch (error) {
      console.error("Fuzz AI error:", error);

      assistantBody.textContent =
        error.message ||
        "Fuzz AI could not answer. Try again.";

      assistantBody.classList.remove("thinking");
      assistantBody.classList.add("error");
    } finally {
      setLoading(false);
      input.focus();
    }
  });
});

function addMessage(role, content) {
  const welcome = document.getElementById("welcome-screen");
  const messages = document.getElementById("chat-messages");

  welcome.classList.add("hidden");

  const wrapper = document.createElement("article");
  wrapper.className = `chat-message ${role}`;

  const label = document.createElement("strong");
  label.textContent = role === "user" ? "You" : "Fuzz AI";

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = content;

  wrapper.append(label, body);
  messages.appendChild(wrapper);

  wrapper.scrollIntoView({
    behavior: "smooth",
    block: "end",
  });

  return body;
}

function setLoading(loading) {
  const button = document.getElementById("send-button");
  const input = document.getElementById("chat-input");

  button.disabled = loading;
  input.disabled = loading;
}

function resizeTextarea(textarea) {
  textarea.style.height = "auto";

  textarea.style.height = `${Math.min(
    textarea.scrollHeight,
    180,
  )}px`;
}