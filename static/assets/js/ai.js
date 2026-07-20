const conversation = [];

let currentChatId = null;
let loadedChats = [];
let attachedImage = null;
let dragDepth = 0;
let requestInProgress = false;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

document.addEventListener("DOMContentLoaded", async () => {
  const aiPage = document.getElementById("ai-page");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const imageInput = document.getElementById("image-input");
  const attachButton = document.getElementById("attach-button");
  const newChatButton = document.getElementById("new-chat-button");

  if (
    !aiPage ||
    !form ||
    !input ||
    !imageInput ||
    !attachButton ||
    !newChatButton
  ) {
    console.error("Fuzz AI page elements are missing.");
    return;
  }

  configureMarkdown();

  await loadChatList();

  attachButton.addEventListener("click", () => {
    if (!requestInProgress) {
      imageInput.click();
    }
  });

  imageInput.addEventListener("change", async () => {
    const file = imageInput.files?.[0];

    if (file) {
      await attachImageFile(file);
    }
  });

  newChatButton.addEventListener("click", () => {
    if (requestInProgress) {
      return;
    }

    startNewChat();
  });

  input.addEventListener("input", () => {
    resizeTextarea(input);
    updateSendButton();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  input.addEventListener("paste", async (event) => {
    const items = Array.from(event.clipboardData?.items || []);

    const imageItem = items.find((item) => {
      return item.kind === "file" && item.type.startsWith("image/");
    });

    if (!imageItem) {
      return;
    }

    const file = imageItem.getAsFile();

    if (!file) {
      return;
    }

    event.preventDefault();
    await attachImageFile(file);
  });

  setupDragAndDrop(aiPage);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const message = input.value.trim();

    if (
      requestInProgress ||
      (!message && !attachedImage)
    ) {
      return;
    }

    const imageForMessage = attachedImage;

    const userMessage = {
      role: "user",
      content: message || "Please analyze this image.",
    };

    if (imageForMessage) {
      userMessage.image = {
        dataUrl: imageForMessage.dataUrl,
        name: imageForMessage.name,
        type: imageForMessage.type,
      };
    }

    setLoading(true);

    try {
      if (!currentChatId) {
        const newChat = await createChat();

        if (!newChat) {
          throw new Error("A new conversation could not be created.");
        }

        currentChatId = newChat.id;
      }

      conversation.push(userMessage);
      addUserMessage(userMessage);

      input.value = "";
      resizeTextarea(input);
      clearAttachedImage();

      await saveMessage(
        "user",
        userMessage.content,
        Boolean(userMessage.image),
        userMessage.image?.name || null,
      );

      await automaticallyTitleCurrentChat(userMessage.content);

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
          throw new Error(
            "Streaming is unavailable in this browser.",
          );
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

          fullReply += decoder.decode(value, {
            stream: true,
          });

          renderAssistantMarkdown(
            assistantBody,
            fullReply,
          );

          scrollToLatestMessage();
        }

        fullReply += decoder.decode();

        renderAssistantMarkdown(
          assistantBody,
          fullReply,
        );

        if (!fullReply.trim()) {
          throw new Error(
            "Fuzz AI returned an empty response.",
          );
        }

        conversation.push({
          role: "assistant",
          content: fullReply,
        });

        await saveMessage(
          "assistant",
          fullReply,
        );

        addCodeCopyButtons(assistantBody);
        await loadChatList();
      } catch (error) {
        console.error("Fuzz AI response error:", error);

        assistantBody.textContent =
          error.message ||
          "Fuzz AI could not answer. Try again.";

        assistantBody.classList.remove("thinking");
        assistantBody.classList.add("error");

        if (imageForMessage) {
          attachedImage = imageForMessage;
          renderImagePreview();
        }
      }
    } catch (error) {
      console.error("Fuzz AI message error:", error);

      showTemporaryComposerError(
        error.message ||
          "Your message could not be sent.",
      );

      if (imageForMessage) {
        attachedImage = imageForMessage;
        renderImagePreview();
      }
    } finally {
      setLoading(false);
      updateSendButton();
      input.focus();
    }
  });

  updateSendButton();
});

function configureMarkdown() {
  if (!window.marked) {
    return;
  }

  window.marked.setOptions({
    breaks: true,
    gfm: true,
  });
}

function setupDragAndDrop(element) {
  const overlay = document.getElementById("drop-overlay");

  if (!overlay) {
    return;
  }

  element.addEventListener("dragenter", (event) => {
    event.preventDefault();

    if (
      requestInProgress ||
      !containsImageFiles(event.dataTransfer)
    ) {
      return;
    }

    dragDepth += 1;
    overlay.classList.add("visible");
  });

  element.addEventListener("dragover", (event) => {
    event.preventDefault();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  });

  element.addEventListener("dragleave", (event) => {
    event.preventDefault();

    dragDepth = Math.max(0, dragDepth - 1);

    if (dragDepth === 0) {
      overlay.classList.remove("visible");
    }
  });

  element.addEventListener("drop", async (event) => {
    event.preventDefault();

    dragDepth = 0;
    overlay.classList.remove("visible");

    if (requestInProgress) {
      return;
    }

    const files = Array.from(
      event.dataTransfer?.files || [],
    );

    const imageFile = files.find((file) => {
      return file.type.startsWith("image/");
    });

    if (!imageFile) {
      showTemporaryComposerError(
        "Drop a PNG, JPEG, WebP, or GIF image.",
      );

      return;
    }

    await attachImageFile(imageFile);
  });
}

function containsImageFiles(dataTransfer) {
  if (!dataTransfer) {
    return false;
  }

  return Array.from(
    dataTransfer.items || [],
  ).some((item) => {
    return (
      item.kind === "file" &&
      item.type.startsWith("image/")
    );
  });
}

async function attachImageFile(file) {
  try {
    attachedImage = await prepareImage(file);

    renderImagePreview();
    updateSendButton();
  } catch (error) {
    attachedImage = null;

    const imageInput =
      document.getElementById("image-input");

    if (imageInput) {
      imageInput.value = "";
    }

    showTemporaryComposerError(
      error.message ||
        "That image could not be attached.",
    );
  }
}

async function prepareImage(file) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error(
      "Use a PNG, JPEG, WebP, or GIF image.",
    );
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      "The image must be smaller than 8 MB.",
    );
  }

  const dataUrl = await readFileAsDataUrl(file);

  return {
    name: file.name || "pasted-image",
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
      reject(
        new Error("The image could not be read."),
      );
    };

    reader.readAsDataURL(file);
  });
}

function renderImagePreview() {
  const previewArea =
    document.getElementById("image-preview-area");

  if (!previewArea) {
    return;
  }

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

  const details = document.createElement("div");
  details.className = "image-preview-details";

  const name = document.createElement("strong");
  name.textContent = attachedImage.name;

  const size = document.createElement("span");
  size.textContent = formatFileSize(
    attachedImage.size,
  );

  const removeButton =
    document.createElement("button");

  removeButton.type = "button";
  removeButton.className =
    "remove-image-button";

  removeButton.setAttribute(
    "aria-label",
    "Remove attached image",
  );

  removeButton.innerHTML =
    '<i class="fa-solid fa-xmark"></i>';

  removeButton.addEventListener("click", () => {
    clearAttachedImage();
    updateSendButton();
  });

  details.append(name, size);

  preview.append(
    image,
    details,
    removeButton,
  );

  previewArea.appendChild(preview);
  previewArea.classList.add("visible");
}

function clearAttachedImage() {
  attachedImage = null;

  const imageInput =
    document.getElementById("image-input");

  const previewArea =
    document.getElementById("image-preview-area");

  if (imageInput) {
    imageInput.value = "";
  }

  if (previewArea) {
    previewArea.innerHTML = "";
    previewArea.classList.remove("visible");
  }
}

function addUserMessage(message) {
  const body = addMessage("user", "");

  if (message.image) {
    const image = document.createElement("img");

    image.className = "message-image";
    image.src = message.image.dataUrl;
    image.alt = message.image.name;

    body.appendChild(image);
  }

  if (message.content) {
    const text = document.createElement("div");

    text.className = "message-text";
    text.textContent = message.content;

    body.appendChild(text);
  }
}

function addSavedUserMessage(message) {
  const body = addMessage("user", "");

  if (message.has_image) {
    const imageNotice =
      document.createElement("div");

    imageNotice.className = "saved-image-notice";

    imageNotice.innerHTML = `
      <i class="fa-regular fa-image"></i>
      <span>
        Image attached${
          message.image_name
            ? `: ${escapeHtml(message.image_name)}`
            : ""
        }
      </span>
    `;

    body.appendChild(imageNotice);
  }

  if (message.content) {
    const text = document.createElement("div");

    text.className = "message-text";
    text.textContent = message.content;

    body.appendChild(text);
  }
}

function addMessage(role, content) {
  const welcome =
    document.getElementById("welcome-screen");

  const messages =
    document.getElementById("chat-messages");

  if (!welcome || !messages) {
    throw new Error(
      "The chat interface could not be found.",
    );
  }

  welcome.classList.add("hidden");

  const wrapper = document.createElement("article");
  wrapper.className = `chat-message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";

  avatar.innerHTML =
    role === "user"
      ? '<i class="fa-solid fa-user"></i>'
      : '<i class="fa-solid fa-robot"></i>';

  const contentWrapper =
    document.createElement("div");

  contentWrapper.className = "message-content";

  const label = document.createElement("strong");
  label.className = "message-label";

  label.textContent =
    role === "user" ? "You" : "Fuzz AI";

  const body = document.createElement("div");
  body.className = "message-body";

  if (content) {
    if (role === "assistant") {
      renderAssistantMarkdown(body, content);
    } else {
      body.textContent = content;
    }
  }

  contentWrapper.append(label, body);
  wrapper.append(avatar, contentWrapper);
  messages.appendChild(wrapper);

  scrollToLatestMessage();

  return body;
}

function renderAssistantMarkdown(element, markdown) {
  if (!window.marked || !window.DOMPurify) {
    element.textContent = markdown;
    return;
  }

  const rendered = window.marked.parse(markdown);

  element.innerHTML =
    window.DOMPurify.sanitize(rendered);
}

function addCodeCopyButtons(container) {
  const codeBlocks =
    container.querySelectorAll("pre");

  codeBlocks.forEach((pre) => {
    if (
      pre.querySelector(".copy-code-button")
    ) {
      return;
    }

    const code = pre.querySelector("code");

    if (!code) {
      return;
    }

    const button =
      document.createElement("button");

    button.type = "button";
    button.className = "copy-code-button";

    button.innerHTML =
      '<i class="fa-regular fa-copy"></i><span>Copy</span>';

    button.addEventListener(
      "click",
      async () => {
        try {
          await navigator.clipboard.writeText(
            code.textContent || "",
          );

          button.innerHTML =
            '<i class="fa-solid fa-check"></i><span>Copied</span>';

          window.setTimeout(() => {
            button.innerHTML =
              '<i class="fa-regular fa-copy"></i><span>Copy</span>';
          }, 1600);
        } catch (error) {
          console.error(
            "Copy failed:",
            error,
          );
        }
      },
    );

    pre.appendChild(button);
  });
}

function startNewChat() {
  const messages =
    document.getElementById("chat-messages");

  const welcome =
    document.getElementById("welcome-screen");

  const input =
    document.getElementById("chat-input");

  conversation.length = 0;
  currentChatId = null;

  if (messages) {
    messages.innerHTML = "";
  }

  if (welcome) {
    welcome.classList.remove("hidden");
  }

  clearAttachedImage();

  if (input) {
    input.value = "";
    resizeTextarea(input);
    input.focus();
  }

  renderChatList();
  updateSendButton();
}

function setLoading(loading) {
  requestInProgress = loading;

  const sendButton =
    document.getElementById("send-button");

  const attachButton =
    document.getElementById("attach-button");

  const input =
    document.getElementById("chat-input");

  const newChatButton =
    document.getElementById("new-chat-button");

  if (sendButton) {
    sendButton.disabled = loading;
  }

  if (attachButton) {
    attachButton.disabled = loading;
  }

  if (input) {
    input.disabled = loading;
  }

  if (newChatButton) {
    newChatButton.disabled = loading;
  }
}

function updateSendButton() {
  const sendButton =
    document.getElementById("send-button");

  const input =
    document.getElementById("chat-input");

  if (
    !sendButton ||
    !input ||
    input.disabled
  ) {
    return;
  }

  sendButton.disabled =
    input.value.trim().length === 0 &&
    !attachedImage;
}

function resizeTextarea(textarea) {
  textarea.style.height = "auto";

  textarea.style.height = `${Math.min(
    textarea.scrollHeight,
    180,
  )}px`;
}

function scrollToLatestMessage() {
  const messages =
    document.getElementById("chat-messages");

  if (!messages) {
    return;
  }

  window.requestAnimationFrame(() => {
    messages.scrollTo({
      top: messages.scrollHeight,
      behavior: "smooth",
    });
  });
}

function showTemporaryComposerError(message) {
  const composer =
    document.getElementById("chat-form");

  if (!composer) {
    return;
  }

  let error =
    composer.querySelector(".composer-error");

  if (!error) {
    error = document.createElement("div");
    error.className = "composer-error";
    composer.prepend(error);
  }

  error.textContent = message;

  window.setTimeout(() => {
    error.remove();
  }, 3500);
}

function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(
    bytes /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}

/* -------------------------------------------------------
   SAVED CHAT FUNCTIONS
------------------------------------------------------- */

async function loadChatList() {
  try {
    const response = await fetch(
      "/api/ai/chats",
      {
        credentials: "same-origin",
      },
    );

    const result =
      await response.json().catch(() => ({
        error:
          "The server returned an invalid response.",
      }));

    if (!response.ok) {
      throw new Error(
        result.error ||
          "Saved chats could not be loaded.",
      );
    }

    loadedChats = result.chats || [];

    renderChatList();
  } catch (error) {
    console.error(
      "Could not load chat list:",
      error,
    );

    showTemporaryComposerError(
      error.message ||
        "Saved chats could not be loaded.",
    );
  }
}

function renderChatList() {
  const container =
    document.getElementById("chat-list");

  if (!container) {
    return;
  }

  container.innerHTML = "";

  if (loadedChats.length === 0) {
    const empty =
      document.createElement("p");

    empty.className = "empty-chat-list";
    empty.textContent =
      "No saved chats yet.";

    container.appendChild(empty);
    return;
  }

  loadedChats.forEach((chat) => {
    const item =
      document.createElement("button");

    item.type = "button";

    item.className =
      currentChatId === chat.id
        ? "chat-item active"
        : "chat-item";

    const title =
      document.createElement("div");

    title.className = "chat-item-title";
    title.textContent = chat.title;

    item.appendChild(title);

    item.addEventListener("click", () => {
      if (
        requestInProgress ||
        currentChatId === chat.id
      ) {
        return;
      }

      openChat(chat.id);
    });

    container.appendChild(item);
  });
}

async function createChat() {
  const response = await fetch(
    "/api/ai/chats",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({
        title: "New chat",
      }),
    },
  );

  const result =
    await response.json().catch(() => ({
      error:
        "The server returned an invalid response.",
    }));

  if (!response.ok || !result.chat) {
    throw new Error(
      result.error ||
        "A new chat could not be created.",
    );
  }

  currentChatId = result.chat.id;

  loadedChats = [
    result.chat,
    ...loadedChats.filter(
      (chat) => chat.id !== result.chat.id,
    ),
  ];

  renderChatList();

  return result.chat;
}

async function openChat(chatId) {
  setLoading(true);

  try {
    const response = await fetch(
      `/api/ai/chats/${encodeURIComponent(
        chatId,
      )}`,
      {
        credentials: "same-origin",
      },
    );

    const result =
      await response.json().catch(() => ({
        error:
          "The server returned an invalid response.",
      }));

    if (!response.ok) {
      throw new Error(
        result.error ||
          "That conversation could not be loaded.",
      );
    }

    currentChatId = chatId;
    conversation.length = 0;

    const messagesContainer =
      document.getElementById(
        "chat-messages",
      );

    const welcome =
      document.getElementById(
        "welcome-screen",
      );

    if (messagesContainer) {
      messagesContainer.innerHTML = "";
    }

    clearAttachedImage();

    const savedMessages =
      result.messages || [];

    if (savedMessages.length === 0) {
      if (welcome) {
        welcome.classList.remove("hidden");
      }
    } else if (welcome) {
      welcome.classList.add("hidden");
    }

    savedMessages.forEach((message) => {
      conversation.push({
        role: message.role,
        content: message.content,
      });

      if (message.role === "user") {
        addSavedUserMessage(message);
      } else {
        const body = addMessage(
          "assistant",
          message.content,
        );

        addCodeCopyButtons(body);
      }
    });

    renderChatList();
    scrollToLatestMessage();
  } catch (error) {
    console.error(
      "Could not open chat:",
      error,
    );

    showTemporaryComposerError(
      error.message ||
        "That conversation could not be loaded.",
    );
  } finally {
    setLoading(false);
    updateSendButton();
  }
}

async function saveMessage(
  role,
  content,
  hasImage = false,
  imageName = null,
) {
  if (!currentChatId) {
    throw new Error(
      "No active conversation exists.",
    );
  }

  const response = await fetch(
    `/api/ai/chats/${encodeURIComponent(
      currentChatId,
    )}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({
        role,
        content,
        hasImage,
        imageName,
      }),
    },
  );

  const result =
    await response.json().catch(() => ({
      error:
        "The server returned an invalid response.",
    }));

  if (!response.ok) {
    throw new Error(
      result.error ||
        "The message could not be saved.",
    );
  }

  return result.message;
}

async function automaticallyTitleCurrentChat(
  firstMessage,
) {
  if (!currentChatId) {
    return;
  }

  const existingChat = loadedChats.find(
    (chat) => chat.id === currentChatId,
  );

  if (
    existingChat &&
    existingChat.title.toLowerCase() !==
      "new chat"
  ) {
    return;
  }

  const title = createTitleFromMessage(
    firstMessage,
  );

  try {
    const response = await fetch(
      `/api/ai/chats/${encodeURIComponent(
        currentChatId,
      )}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type":
            "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          title,
        }),
      },
    );

    const result =
      await response.json().catch(() => ({
        error:
          "The server returned an invalid response.",
      }));

    if (!response.ok || !result.chat) {
      throw new Error(
        result.error ||
          "The chat title could not be updated.",
      );
    }

    loadedChats = loadedChats.map(
      (chat) => {
        if (chat.id === currentChatId) {
          return result.chat;
        }

        return chat;
      },
    );

    renderChatList();
  } catch (error) {
    console.error(
      "Could not title chat:",
      error,
    );
  }
}

function createTitleFromMessage(message) {
  const cleaned = String(message || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "Image analysis";
  }

  if (cleaned.length <= 42) {
    return cleaned;
  }

  return `${cleaned.slice(0, 39).trim()}...`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}