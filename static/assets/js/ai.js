const conversation = [];

let currentChatId = null;
let loadedChats = [];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

let attachedImage = null;
let dragDepth = 0;
let activeRequestController = null;
let chatFilter = "";

document.addEventListener("DOMContentLoaded", () => {
  const aiPage = document.getElementById("ai-page");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const imageInput = document.getElementById("image-input");
  const attachButton = document.getElementById("attach-button");
  const sendButton = document.getElementById("send-button");
  const newChatButton = document.getElementById("new-chat-button");
  const stopButton = document.getElementById("stop-button");
  const chatSearch = document.getElementById("chat-search");
  const historyToggle = document.querySelector("[data-ai-history-toggle]");
  const historyCloseButtons = document.querySelectorAll("[data-ai-history-close]");

  if (
    !aiPage ||
    !form ||
    !input ||
    !imageInput ||
    !attachButton ||
    !sendButton ||
    !newChatButton ||
    !stopButton
  ) {
    console.error("Novaris AI could not initialize because required page controls are missing.");
    return;
  }

  configureMarkdown();

  attachButton.addEventListener("click", () => {
    if (!sendButton.disabled) {
      imageInput.click();
    }
  });

  imageInput.addEventListener("change", async () => {
    const file = imageInput.files?.[0];

    if (file) {
      await attachImageFile(file);
    }
  });

  document.querySelectorAll("[data-new-chat]").forEach((button) => {
    button.addEventListener("click", () => {
      startNewChat();
    });
  });

  historyToggle?.addEventListener("click", () => {
    const open = !aiPage.classList.contains("ai-history-open");
    setHistoryOpen(open);
  });

  historyCloseButtons.forEach((button) => {
    button.addEventListener("click", () => setHistoryOpen(false));
  });

  chatSearch?.addEventListener("input", () => {
    chatFilter = chatSearch.value.trim().toLowerCase();
    renderChatList();
  });

  document.querySelectorAll("[data-ai-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      input.value = button.dataset.aiPrompt || "";
      resizeTextarea(input);
      updateSendButton();
      input.focus();
    });
  });

  stopButton.addEventListener("click", () => {
    activeRequestController?.abort();
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

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      startNewChat();
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
    let fullReply = "";

    activeRequestController = new AbortController();
    setAiStatus("Thinking", "working");

    try {
      if (!currentChatId) {
        try {
          await createChat(userMessage.content);
        } catch (saveError) {
          console.error("Chat creation failed:", saveError);
          showTemporaryComposerError(
            `${saveError.message} Your reply can still generate, but this conversation may not be saved.`,
          );
        }
      }

      if (currentChatId) {
        try {
          await saveMessage(
            "user",
            userMessage.content,
            Boolean(sentImage),
            sentImage?.name || null,
          );
        } catch (saveError) {
          console.error("User message save failed:", saveError);
          showTemporaryComposerError(
            `${saveError.message} Novaris AI will still try to answer.`,
          );
        }
      }

      const response = await fetch("/api/ai/chat", {
        method: "POST",
        signal: activeRequestController.signal,
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
          result.error || "Novaris AI request failed.",
        );
      }

      if (!response.body) {
        throw new Error("Streaming is unavailable in this browser.");
      }

      assistantBody.classList.remove("thinking");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        fullReply += decoder.decode(value, {
          stream: true,
        });

        renderAssistantMarkdown(assistantBody, fullReply);
        scrollToLatestMessage();
      }

      fullReply += decoder.decode();
      renderAssistantMarkdown(assistantBody, fullReply);

      if (!fullReply.trim()) {
        throw new Error("Novaris AI returned an empty response.");
      }

      conversation.push({
        role: "assistant",
        content: fullReply,
      });

      if (currentChatId) {
        try {
          await saveMessage("assistant", fullReply);
          await loadChatList();
        } catch (saveError) {
          console.error("Assistant message save failed:", saveError);
          showTemporaryComposerError(saveError.message);
        }
      }

      addCodeCopyButtons(assistantBody);
    } catch (error) {
      if (error?.name === "AbortError") {
        assistantBody.classList.remove("thinking");

        if (fullReply.trim()) {
          renderAssistantMarkdown(assistantBody, fullReply);
          conversation.push({ role: "assistant", content: fullReply });
          addCodeCopyButtons(assistantBody);

          if (currentChatId) {
            try {
              await saveMessage("assistant", fullReply);
              await loadChatList();
            } catch (saveError) {
              console.error("Stopped response save failed:", saveError);
            }
          }
        } else {
          assistantBody.textContent = "Generation stopped.";
          assistantBody.classList.add("stopped");
        }

        setAiStatus("Stopped", "ready");
      } else {
        console.error("Novaris AI error:", error);

        assistantBody.textContent =
          error.message ||
          "Novaris AI could not answer. Try again.";

        assistantBody.classList.remove("thinking");
        assistantBody.classList.add("error");
        setAiStatus("Error", "error");
        window.setTimeout(() => setAiStatus("Ready", "ready"), 3200);

        if (sentImage) {
          attachedImage = sentImage;
          renderImagePreview();
        }
      }
    } finally {
      activeRequestController = null;
      setLoading(false);
      updateSendButton();
      input.focus();

      if (document.getElementById("ai-connection-status")?.dataset.state !== "error") {
        window.setTimeout(() => setAiStatus("Ready", "ready"), 700);
      }
    }
  });

  updateSendButton();
  setAiStatus("Ready", "ready");
  void loadChatList();
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

  element.addEventListener("dragenter", (event) => {
    event.preventDefault();

    if (!containsImageFiles(event.dataTransfer)) {
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

    const files = Array.from(event.dataTransfer?.files || []);
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

  return Array.from(dataTransfer.items || []).some((item) => {
    return item.kind === "file" && item.type.startsWith("image/");
  });
}

async function attachImageFile(file) {
  try {
    attachedImage = await prepareImage(file);
    renderImagePreview();
    updateSendButton();
  } catch (error) {
    attachedImage = null;

    const imageInput = document.getElementById("image-input");

    if (imageInput) {
      imageInput.value = "";
    }

    showTemporaryComposerError(
      error.message || "That image could not be attached.",
    );
  }
}

async function prepareImage(file) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Use a PNG, JPEG, WebP, or GIF image.");
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("The image must be smaller than 8 MB.");
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

  const details = document.createElement("div");
  details.className = "image-preview-details";

  const name = document.createElement("strong");
  name.textContent = attachedImage.name;

  const size = document.createElement("span");
  size.textContent = formatFileSize(attachedImage.size);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "remove-image-button";
  removeButton.setAttribute("aria-label", "Remove attached image");
  removeButton.innerHTML = '<i class="fa-solid fa-xmark"></i>';

  removeButton.addEventListener("click", () => {
    clearAttachedImage();
    updateSendButton();
  });

  details.append(name, size);
  preview.append(image, details, removeButton);
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

function addMessage(role, content) {
  const welcome = document.getElementById("welcome-screen");
  const messages = document.getElementById("chat-messages");

  welcome.classList.add("hidden");

  const wrapper = document.createElement("article");
  wrapper.className = `chat-message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.innerHTML =
    role === "user"
      ? '<i class="fa-solid fa-user"></i>'
      : '<i class="fa-solid fa-robot"></i>';

  const contentWrapper = document.createElement("div");
  contentWrapper.className = "message-content";

  const label = document.createElement("strong");
  label.className = "message-label";
  label.textContent = role === "user" ? "You" : "Novaris AI";

  const body = document.createElement("div");
  body.className = "message-body";

  if (content) {
    body.textContent = content;
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

  element.innerHTML = window.DOMPurify.sanitize(rendered);
}

function addCodeCopyButtons(container) {
  const codeBlocks = container.querySelectorAll("pre");

  codeBlocks.forEach((pre) => {
    if (pre.querySelector(".copy-code-button")) {
      return;
    }

    const code = pre.querySelector("code");

    if (!code) {
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-code-button";
    button.innerHTML =
      '<i class="fa-regular fa-copy"></i><span>Copy</span>';

    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.textContent || "");

        button.innerHTML =
          '<i class="fa-solid fa-check"></i><span>Copied</span>';

        window.setTimeout(() => {
          button.innerHTML =
            '<i class="fa-regular fa-copy"></i><span>Copy</span>';
        }, 1600);
      } catch (error) {
        console.error("Copy failed:", error);
      }
    });

    pre.appendChild(button);
  });
}

function startNewChat() {
  if (activeRequestController) {
    showTemporaryComposerError("Stop the current response before starting a new chat.");
    return;
  }

  const messages = document.getElementById("chat-messages");
  const welcome = document.getElementById("welcome-screen");
  const input = document.getElementById("chat-input");

  currentChatId = null;
  conversation.length = 0;
  setActiveChatTitle("New conversation");
  setHistoryOpen(false);
  messages.innerHTML = "";
  welcome.classList.remove("hidden");

  clearAttachedImage();

  input.value = "";
  resizeTextarea(input);
  updateSendButton();
  input.focus();
}

function setLoading(loading) {
  const sendButton = document.getElementById("send-button");
  const stopButton = document.getElementById("stop-button");
  const attachButton = document.getElementById("attach-button");
  const input = document.getElementById("chat-input");

  sendButton.hidden = loading;
  stopButton.hidden = !loading;
  sendButton.disabled = loading;
  attachButton.disabled = loading;
  input.disabled = loading;
  document.querySelectorAll("[data-new-chat]").forEach((button) => {
    button.disabled = loading;
  });
}

function updateSendButton() {
  const sendButton = document.getElementById("send-button");
  const input = document.getElementById("chat-input");

  if (!sendButton || !input || input.disabled) {
    return;
  }

  sendButton.disabled =
    input.value.trim().length === 0 && !attachedImage;
}

function resizeTextarea(textarea) {
  textarea.style.height = "auto";

  textarea.style.height = `${Math.min(
    textarea.scrollHeight,
    180,
  )}px`;
}

function scrollToLatestMessage() {
  const messages = document.getElementById("chat-messages");

  window.requestAnimationFrame(() => {
    messages.scrollTo({
      top: messages.scrollHeight,
      behavior: "smooth",
    });
  });
}

function showTemporaryComposerError(message) {
  const composer = document.getElementById("chat-form");

  let error = composer.querySelector(".composer-error");

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

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadChatList() {
  const container = document.getElementById("chat-list");

  try {
    const response = await fetch("/api/ai/chats", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    const result = await response.json().catch(() => ({}));

    if (response.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent("/ai")}`;
      return;
    }

    if (!response.ok) {
      throw new Error(
        result.error || "Saved chats could not be loaded.",
      );
    }

    loadedChats = Array.isArray(result.chats) ? result.chats : [];
    renderChatList();
    setAiStatus("Ready", "ready");
  } catch (error) {
    console.error("Saved chat list failed:", error);

    if (container) {
      container.innerHTML = `
        <p class="empty-chat-list">
          ${escapeHtml(error.message || "Saved chats are unavailable.")}
        </p>
      `;
    }
  }
}

function renderChatList() {
  const container = document.getElementById("chat-list");
  const count = document.getElementById("chat-count");

  if (!container) {
    return;
  }

  const visibleChats = loadedChats.filter((chat) => {
    if (!chatFilter) return true;
    return String(chat.title || "New chat").toLowerCase().includes(chatFilter);
  });

  if (count) {
    count.textContent = String(visibleChats.length);
  }

  container.innerHTML = "";

  if (visibleChats.length === 0) {
    container.innerHTML = `<p class="empty-chat-list">${
      chatFilter
        ? "No conversations match your search."
        : "Your saved conversations will appear here."
    }</p>`;
    return;
  }

  visibleChats.forEach((chat) => {
    const item = document.createElement("div");
    item.className =
      currentChatId === chat.id
        ? "chat-item active"
        : "chat-item";

    const titleButton = document.createElement("button");
    titleButton.type = "button";
    titleButton.className = "chat-item-title-button";
    titleButton.title = chat.title || "Open chat";
    titleButton.innerHTML = `
      <span class="chat-item-copy">
        <span class="chat-item-title">${escapeHtml(chat.title || "New chat")}</span>
        <span class="chat-item-time">${escapeHtml(formatChatDate(chat.updatedAt || chat.updated_at || chat.createdAt || chat.created_at))}</span>
      </span>
    `;
    titleButton.addEventListener("click", () => {
      void openChat(chat.id);
    });

    const actions = document.createElement("span");
    actions.className = "chat-item-actions";

    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.className = "chat-action-button";
    renameButton.title = "Rename chat";
    renameButton.setAttribute("aria-label", "Rename chat");
    renameButton.innerHTML = '<i class="fa-solid fa-pen"></i>';
    renameButton.addEventListener("click", () => {
      void renameChat(chat);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "chat-action-button delete-chat-button";
    deleteButton.title = "Delete chat";
    deleteButton.setAttribute("aria-label", "Delete chat");
    deleteButton.innerHTML = '<i class="fa-solid fa-trash"></i>';
    deleteButton.addEventListener("click", () => {
      void deleteChat(chat);
    });

    actions.append(renameButton, deleteButton);
    item.append(titleButton, actions);
    container.appendChild(item);
  });
}

async function createChat(firstMessage = "") {
  const title = String(firstMessage || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 55) || "New chat";

  const response = await fetch("/api/ai/chats", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify({ title }),
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result.chat?.id) {
    throw new Error(
      result.error || "The conversation could not be created.",
    );
  }

  currentChatId = result.chat.id;
  setActiveChatTitle(result.chat.title || title);
  await loadChatList();
  return result.chat;
}

async function openChat(chatId) {
  try {
    const response = await fetch(
      `/api/ai/chats/${encodeURIComponent(chatId)}`,
      {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      },
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result.error || "That conversation could not be loaded.",
      );
    }

    currentChatId = chatId;
    conversation.length = 0;
    const selectedChat = loadedChats.find((chat) => chat.id === chatId);
    setActiveChatTitle(selectedChat?.title || result.chat?.title || "Conversation");
    setHistoryOpen(false);

    const messages = document.getElementById("chat-messages");
    const welcome = document.getElementById("welcome-screen");

    messages.innerHTML = "";
    welcome.classList.add("hidden");

    for (const message of result.messages || []) {
      const normalized = {
        role: message.role,
        content: message.content,
      };

      conversation.push(normalized);

      const body = addMessage(message.role, "");

      if (message.role === "assistant") {
        renderAssistantMarkdown(body, message.content);
        addCodeCopyButtons(body);
      } else {
        if (message.has_image || message.hasImage) {
          const imageNotice = document.createElement("div");
          imageNotice.className = "saved-image-notice";
          imageNotice.innerHTML = '<i class="fa-regular fa-image" aria-hidden="true"></i>';

          const imageLabel = document.createElement("span");
          imageLabel.textContent = message.image_name || message.imageName || "Image attached";
          imageNotice.appendChild(imageLabel);
          body.appendChild(imageNotice);
        }

        const messageText = document.createElement("div");
        messageText.className = "message-text";
        messageText.textContent = message.content;
        body.appendChild(messageText);
      }
    }

    renderChatList();
    document.getElementById("chat-input")?.focus();
  } catch (error) {
    console.error("Open chat failed:", error);
    showTemporaryComposerError(error.message);
  }
}

async function saveMessage(
  role,
  content,
  hasImage = false,
  imageName = null,
) {
  if (!currentChatId) {
    throw new Error("The current conversation does not have a saved chat ID.");
  }

  const response = await fetch(
    `/api/ai/chats/${encodeURIComponent(currentChatId)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
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

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result.error || "The message could not be saved.",
    );
  }

  return result.message;
}

async function renameChat(chat) {
  const requested = window.prompt(
    "Rename this chat:",
    chat.title || "New chat",
  );

  if (requested === null) {
    return;
  }

  const title = requested.replace(/\s+/g, " ").trim().slice(0, 80);

  if (!title) {
    showTemporaryComposerError("Enter a chat title.");
    return;
  }

  try {
    const response = await fetch(
      `/api/ai/chats/${encodeURIComponent(chat.id)}`,
      {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ title }),
      },
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || "That chat could not be renamed.");
    }

    if (currentChatId === chat.id) {
      setActiveChatTitle(title);
    }
    await loadChatList();
  } catch (error) {
    console.error("Rename chat failed:", error);
    showTemporaryComposerError(error.message);
  }
}

async function deleteChat(chat) {
  if (!window.confirm(`Delete “${chat.title || "this chat"}”?`)) {
    return;
  }

  try {
    const response = await fetch(
      `/api/ai/chats/${encodeURIComponent(chat.id)}`,
      {
        method: "DELETE",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      },
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || "That chat could not be deleted.");
    }

    if (currentChatId === chat.id) {
      startNewChat();
    }

    await loadChatList();
  } catch (error) {
    console.error("Delete chat failed:", error);
    showTemporaryComposerError(error.message);
  }
}

function setAiStatus(label, state = "ready") {
  const status = document.getElementById("ai-connection-status");
  if (!status) return;
  status.dataset.state = state;
  const text = status.querySelector("strong");
  if (text) text.textContent = label;
}

function setActiveChatTitle(title) {
  const element = document.getElementById("active-chat-title");
  if (element) element.textContent = String(title || "New conversation");
}

function setHistoryOpen(open) {
  const page = document.getElementById("ai-page");
  const toggle = document.querySelector("[data-ai-history-toggle]");
  if (!page) return;
  page.classList.toggle("ai-history-open", Boolean(open));
  toggle?.setAttribute("aria-expanded", String(Boolean(open)));
}

function formatChatDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Saved chat";

  const difference = Date.now() - date.getTime();
  if (difference < 60_000) return "Just now";
  if (difference < 3_600_000) return `${Math.max(1, Math.floor(difference / 60_000))} min ago`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} hr ago`;
  if (difference < 604_800_000) {
    return date.toLocaleDateString([], { weekday: "short" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
