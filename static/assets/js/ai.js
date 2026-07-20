const conversation = [];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

let attachedImage = null;

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const imageInput = document.getElementById("image-input");
  const attachButton = document.getElementById("attach-button");
  const sendButton = document.getElementById("send-button");

  attachButton.addEventListener("click", () => {
    if (!sendButton.disabled) {
      imageInput.click();
    }
  });

  imageInput.addEventListener("change", async () => {
    const file = imageInput.files?.[0];

    if (!file) {
      return;
    }

    try {
      attachedImage = await prepareImage(file);
      renderImagePreview();
    } catch (error) {
      attachedImage = null;
      imageInput.value = "";

      alert(error.message || "That image could not be attached.");
    }
  });

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

    if ((!message && !attachedImage) || sendButton.disabled) {
      return;
    }

    const userMessage = {
      role: "user",
      content: message || "Please analyze this image.",
    };

    if (attachedImage) {
      userMessage.image = {
        dataUrl: attachedImage.dataUrl,
        name: attachedImage.name,
        type: attachedImage.type,
      };
    }

    conversation.push(userMessage);

    addUserMessage(userMessage);

    input.value = "";
    resizeTextarea(input);

    const sentImage = attachedImage;
    clearAttachedImage();

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
        throw new Error("Streaming is unavailable in this browser.");
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

      if (sentImage) {
        attachedImage = sentImage;
        renderImagePreview();
      }
    } finally {
      setLoading(false);
      input.focus();
    }
  });
});

async function prepareImage(file) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Use a PNG, JPEG, WebP, or GIF image.");
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("The image must be smaller than 8 MB.");
  }

  const dataUrl = await readFileAsDataUrl(file);

  return {
    name: file.name,
    type: file.type,
    size: file.size,
    dataUrl,
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(String(reader.result));
    };

    reader.onerror = () => {
      reject(new Error("The image could not be read."));
    };

    reader.readAsDataURL(file);
  });
}

function renderImagePreview() {
  const previewArea = document.getElementById("image-preview-area");

  previewArea.innerHTML = "";

  if (!attachedImage) {
    previewArea.classList.remove("visible");
    return;
  }

  const preview = document.createElement("div");
  preview.className = "image-preview";

  const image = document.createElement("img");
  image.src = attachedImage.dataUrl;
  image.alt = attachedImage.name;

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "remove-image-button";
  removeButton.setAttribute("aria-label", "Remove attached image");
  removeButton.innerHTML = '<i class="fa-solid fa-xmark"></i>';

  removeButton.addEventListener("click", () => {
    clearAttachedImage();
  });

  preview.append(image, removeButton);
  previewArea.appendChild(preview);
  previewArea.classList.add("visible");
}

function clearAttachedImage() {
  attachedImage = null;

  const imageInput = document.getElementById("image-input");
  const previewArea = document.getElementById("image-preview-area");

  imageInput.value = "";
  previewArea.innerHTML = "";
  previewArea.classList.remove("visible");
}

function addUserMessage(message) {
  const body = addMessage("user", message.content);

  if (!message.image) {
    return;
  }

  const image = document.createElement("img");
  image.className = "message-image";
  image.src = message.image.dataUrl;
  image.alt = message.image.name;

  body.prepend(image);
}

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

  if (content) {
    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = content;
    body.appendChild(text);
  }

  wrapper.append(label, body);
  messages.appendChild(wrapper);

  wrapper.scrollIntoView({
    behavior: "smooth",
    block: "end",
  });

  return body;
}

function setLoading(loading) {
  const sendButton = document.getElementById("send-button");
  const attachButton = document.getElementById("attach-button");
  const input = document.getElementById("chat-input");

  sendButton.disabled = loading;
  attachButton.disabled = loading;
  input.disabled = loading;
}

function resizeTextarea(textarea) {
  textarea.style.height = "auto";

  textarea.style.height = `${Math.min(
    textarea.scrollHeight,
    180,
  )}px`;
}