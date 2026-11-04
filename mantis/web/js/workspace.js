import { api } from "./api.js";
import { archiveExchange } from "./chat-history.js";
import { attachmentError, DEMO_PROMPTS } from "./examples.js";
import { createConversation } from "./conversation.js";

const $ = (id) => document.getElementById(id);
const chat = createConversation({ request: api });
const state = {
  documents: [],
  chats: [],
  transcript: [],
  chatId: "",
  chatRevision: 0,
  saving: false,
  unsaved: false,
  missingManual: false,
  selected: "",
  demo: false,
  configured: false,
  uploading: false,
  file: null,
  photo: null,
  photoGeneration: 0,
  chatGeneration: 0,
};
let toastTimer;
let historyRequest = 0;
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 6500);
}
function scrollChat() {
  $("chat-scroll").scrollTop = $("chat-scroll").scrollHeight;
}
function lock() {
  $("send-button").disabled = chat.busy || state.uploading || state.saving;
  $("new-chat").disabled = state.uploading || state.saving;
  $("retry-save").disabled = state.saving;
  $("attach-photo").disabled = state.uploading;
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.disabled = chat.busy || state.uploading || state.saving;
  });
}
function clearPhoto() {
  state.photoGeneration += 1;
  state.photo = null;
  $("photo-tray").hidden = true;
  $("photo-preview").removeAttribute("src");
  $("photo-input").value = "";
}
function updateMode() {
  const doc = state.documents.find((item) => item.id === state.selected);
  $("selected-label").textContent = state.demo
    ? "Example conversation"
    : doc
      ? doc.equipment || doc.name
      : "Your manuals";
  $("welcome-title").textContent = state.demo
    ? "Choose a sample question below"
    : doc
      ? "Ask about your manual"
      : "Upload a manual to start";
  $("upload-welcome").hidden = state.demo || Boolean(doc);
  $("mode-banner").hidden = !state.demo;
  $("suggestions").hidden = !state.demo;
  $("demo-button").textContent = state.demo ? "Exit example" : "Try an example";
  $("photo-note").textContent = state.demo
    ? "Local preview only · not analyzed in this example"
    : "Sent to OpenAI when you send this message.";
  $("composer-note").textContent = state.demo
    ? "Scripted examples · no AI calls."
    : !state.configured
      ? "Live answers need a configured AI service. Try an example."
      : doc
        ? "Verify sources. Photos are sent to OpenAI."
        : "Photos and questions are sent to OpenAI.";
}
function resetChat() {
  chat.reset();
  state.transcript = [];
  state.chatId = "";
  state.chatRevision = 0;
  state.unsaved = false;
  state.missingManual = false;
  $("retry-save").hidden = true;
  state.chatGeneration += 1;
  $("messages").replaceChildren();
  $("welcome").hidden = false;
  $("question").value = "";
  clearPhoto();
  lock();
  updateMode();
}
function choose(id, demo = false) {
  if (state.uploading || state.saving) return;
  if (state.unsaved) {
    toast("Use Retry save before changing this conversation.");
    return;
  }
  state.selected = id;
  state.demo = demo;
  const url = new URL(location.href);
  url.hash = demo ? "demo" : "";
  history.replaceState(null, "", url);
  resetChat();
  updateMode();
  renderDocuments();
  if ($("manuals-dialog").open) $("manuals-dialog").close();
}
function addMessage(role, text, { result = null, photo = null } = {}) {
  const node = element("article", "message " + role);
  const header = element("div", "message-header");
  header.append(element("span", "sr-only", role === "user" ? "You" : "Mantis"));
  if (role === "assistant") {
    const mark = element("img");
    mark.src = "/static/assets/mantis-mark.png";
    mark.alt = "";
    header.prepend(mark);
  }
  const body = element("div", "message-body");
  if (photo?.omitted)
    body.append(
      element("p", "photo-history-note", "Photo was attached · file not saved"),
    );
  else if (photo) {
    const image = element("img", "message-photo");
    image.src = photo.url;
    image.alt = photo.sample
      ? "Illustrative CNC alarm screen"
      : "Attached equipment photo";
    body.append(image);
  }
  body.append(element("span", "", text));
  node.append(header, body);
  if (result) {
    if (result.demo || result.insufficient_evidence)
      node.append(
        element(
          "p",
          "answer-note",
          result.demo
            ? "SCRIPTED EXAMPLE · ILLUSTRATIVE MATERIAL"
            : "LIMITED MANUAL EVIDENCE · OBSERVATIONS ARE NOT A DIAGNOSIS",
        ),
      );
    const citations = element("div", "citations");
    for (const source of result.sources || []) {
      const detail = element("details", "source-details");
      detail.append(
        element("summary", "", `${source.name} · p. ${source.page}`),
        element("p", "source-excerpt", source.text),
      );
      if (source.document_id !== "demo") {
        const link = element(
          "a",
          "",
          `Open original PDF · page ${source.page} ↗`,
        );
        link.href = `/api/documents/${encodeURIComponent(source.document_id)}/file#page=${source.page}`;
        link.target = "_blank";
        link.rel = "noopener";
        detail.append(link);
      } else
        detail.append(
          element(
            "p",
            "source-note",
            "Illustrative example · not a service procedure",
          ),
        );
      citations.append(detail);
    }
    node.append(citations);
  }
  $("messages").append(node);
  scrollChat();
  return node;
}
function startExample(prompt = "spindle") {
  if (state.uploading || state.saving || state.unsaved) return;
  choose("", true);
  $("welcome").hidden = true;
  $("question").value = DEMO_PROMPTS[prompt];
  ask(null, prompt === "alarm");
}
async function ask(event, samplePhoto = false) {
  event?.preventDefault();
  if (chat.busy || state.uploading || state.saving) return;
  if (state.missingManual)
    return toast(
      "This chat’s manual was removed. Select another manual to start a new conversation.",
    );
  if (state.transcript.length >= 100)
    return toast(
      "This chat has reached 50 exchanges. Start a new chat to continue.",
    );
  const photo = samplePhoto
    ? { sample: true, url: "/static/assets/demo-alarm.svg" }
    : state.photo;
  const question =
    $("question").value.trim() ||
    (photo ? "Can you help me understand this equipment photo?" : "");
  if (question.length < 3)
    return toast("Enter a question with at least three characters.");
  if (!state.demo && !state.configured)
    return toast(
      "Set OPENAI_API_KEY on the server for live answers, or choose Try an example.",
    );
  if (!state.demo && !state.selected && !photo && !chat.history.length)
    return toast("Upload a manual or attach a photo to start.");
  const generation = state.chatGeneration;
  $("welcome").hidden = true;
  const sent = addMessage("user", question, { photo });
  $("question").value = "";
  clearPhoto();
  const pending = element(
    "div",
    "pending",
    state.demo ? "•••" : "Reading context…",
  );
  $("messages").append(pending);
  scrollChat();
  try {
    const promise = chat.send({
      question,
      documentId: state.selected,
      demo: state.demo,
      image: photo && !photo.sample ? photo.url : null,
      sample: Boolean(photo?.sample),
    });
    lock();
    const result = await promise;
    if (generation !== state.chatGeneration || !result) return;
    pending.remove();
    addMessage("assistant", result.answer, { result });
    state.transcript.push(...archiveExchange(question, result, photo));
    await saveActiveChat();
  } catch (error) {
    if (generation !== state.chatGeneration) return;
    pending.remove();
    sent.remove();
    $("question").value = question;
    if (photo && !photo.sample) {
      state.photo = photo;
      renderPhoto();
    }
    toast(error.message + " Your draft is ready to retry.");
  } finally {
    if (generation === state.chatGeneration) lock();
  }
}
function renderPhoto() {
  $("photo-preview").src = state.photo.url;
  $("photo-name").textContent = state.photo.name;
  $("photo-tray").hidden = false;
}
async function stagePhoto(file) {
  if (!file) return;
  const error = attachmentError(file);
  if (error) return toast(error);
  const generation = ++state.photoGeneration;
  try {
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("This photo could not be read."));
      reader.readAsDataURL(file);
    });
    if (generation !== state.photoGeneration) return;
    state.photo = { url, name: file.name };
    renderPhoto();
    $("question").focus();
  } catch (error) {
    toast(error.message);
  }
}
function renderDocuments() {
  $("manual-count").textContent = state.documents.length;
  const list = $("manual-list");
  list.replaceChildren();
  const search = $("manual-search").value.toLowerCase();
  const docs = state.documents.filter((doc) =>
    `${doc.name} ${doc.equipment}`.toLowerCase().includes(search),
  );
  if (!docs.length)
    list.append(
      element(
        "p",
        "manual-empty",
        search
          ? "No matching manuals."
          : "Your manuals will appear here. Upload a PDF to connect your equipment knowledge.",
      ),
    );
  for (const doc of docs) {
    const row = element(
      "div",
      "manual-row" + (doc.id === state.selected ? " selected" : ""),
    );
    const select = element("button", "manual-choose");
    select.append(
      element("strong", "", doc.name),
      element(
        "small",
        "",
        `${doc.equipment || "Equipment manual"} · ${doc.pages} ${doc.pages === 1 ? "page" : "pages"}`,
      ),
    );
    select.addEventListener("click", () => choose(doc.id));
    const remove = element("button", "manual-delete", "Delete");
    remove.setAttribute("aria-label", `Delete ${doc.name}`);
    remove.addEventListener("click", async () => {
      if (chat.busy || state.uploading)
        return toast("Wait for the current request to finish.");
      if (!confirm(`Delete “${doc.name}” and its searchable passages?`)) return;
      remove.disabled = true;
      try {
        await api(`/documents/${encodeURIComponent(doc.id)}`, {
          method: "DELETE",
        });
        if (state.selected === doc.id) choose("");
        await refresh();
        toast("Manual and its index deleted.");
      } catch (error) {
        toast(error.message);
        remove.disabled = false;
      }
    });
    row.append(select, remove);
    list.append(row);
  }
}
async function refresh() {
  state.documents = (await api("/documents")).documents;
  if (
    state.selected &&
    !state.documents.some((doc) => doc.id === state.selected)
  )
    state.selected = "";
  renderDocuments();
  updateMode();
}
function pickManual() {
  if (state.uploading || chat.busy)
    return toast("Wait for the current request to finish.");
  $("file-input").click();
}
function stageManual(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".pdf"))
    return toast("Choose a PDF manual.");
  if (file.size > 20 * 1024 * 1024)
    return toast("Choose a PDF smaller than 20 MB.");
  if ($("manuals-dialog").open) $("manuals-dialog").close();
  state.file = file;
  $("upload-filename").textContent = file.name;
  $("equipment").value = "";
  $("upload-progress").textContent = state.configured
    ? ""
    : "AI indexing needs OPENAI_API_KEY configured on the server.";
  $("upload-dialog").showModal();
}
async function upload(event) {
  event.preventDefault();
  if (!state.file || state.uploading || chat.busy) return;
  state.uploading = true;
  lock();
  $("confirm-upload").disabled = true;
  $("close-upload").disabled = true;
  $("upload-progress").textContent = "Reading and indexing the manual…";
  const data = new FormData();
  data.append("file", state.file);
  data.append("equipment", $("equipment").value.trim());
  try {
    const result = await api("/documents", { method: "POST", body: data });
    await refresh();
    state.uploading = false;
    choose(result.document.id);
    $("upload-dialog").close();
    toast(
      result.duplicate
        ? "Manual already connected. Ready to ask."
        : "Manual connected. Ask your first question.",
    );
  } catch (error) {
    $("upload-progress").textContent = error.message;
  } finally {
    state.uploading = false;
    lock();
    $("confirm-upload").disabled = false;
    $("close-upload").disabled = false;
    $("file-input").value = "";
  }
}
async function saveActiveChat() {
  if (!state.transcript.length || state.saving) return;
  state.saving = true;
  lock();
  const generation = state.chatGeneration;
  try {
    const response = await api(
      state.chatId ? `/chats/${encodeURIComponent(state.chatId)}` : "/chats",
      {
        method: state.chatId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_id: state.selected,
          demo: state.demo,
          revision: state.chatRevision,
          messages: state.transcript,
        }),
      },
    );
    if (generation !== state.chatGeneration) return;
    state.chatId = response.chat.id;
    state.chatRevision = response.chat.revision;
    state.unsaved = false;
    $("retry-save").hidden = true;
  } catch (error) {
    if (generation === state.chatGeneration) {
      state.unsaved = true;
      $("retry-save").hidden = false;
      toast(`Chat could not be saved: ${error.message} Use Retry save.`);
    }
  } finally {
    state.saving = false;
    lock();
  }
}
function newChat() {
  if (state.uploading || state.saving) return;
  if (state.unsaved)
    return toast("Use Retry save before starting another conversation.");
  resetChat();
  if ($("chats-dialog").open) $("chats-dialog").close();
}
async function openSavedChat(id) {
  if (state.uploading || state.saving || state.unsaved)
    return toast("Save the current conversation before switching chats.");
  const current = ++historyRequest;
  const generation = state.chatGeneration;
  try {
    const { chat: saved } = await api(`/chats/${encodeURIComponent(id)}`);
    if (current !== historyRequest || generation !== state.chatGeneration)
      return;
    if (state.saving || state.uploading || state.unsaved)
      return toast("Wait for this chat to finish saving before switching.");
    choose(saved.document_id, Boolean(saved.demo));
    state.chatId = saved.id;
    state.chatRevision = saved.revision;
    state.transcript = saved.messages;
    chat.restore(saved.messages);
    for (const message of saved.messages) {
      const photo =
        message.photo === "sample"
          ? { sample: true, url: "/static/assets/demo-alarm.svg" }
          : message.photo === "omitted"
            ? { omitted: true }
            : null;
      addMessage(message.role, message.content, {
        photo,
        result:
          message.role === "assistant"
            ? { ...message, answer: message.content }
            : null,
      });
    }
    $("welcome").hidden = true;
    state.missingManual =
      !saved.demo &&
      Boolean(saved.document_id) &&
      !state.documents.some((doc) => doc.id === saved.document_id);
    if (state.missingManual)
      $("composer-note").textContent =
        "This chat’s manual was removed. Choose another manual to start a new chat.";
    $("chats-dialog").close();
  } catch (error) {
    toast(error.message);
  }
}
async function loadChats() {
  $("chat-list").replaceChildren(
    element("p", "manual-empty", "Loading chats…"),
  );
  try {
    state.chats = (await api("/chats")).chats;
    const list = $("chat-list");
    list.replaceChildren();
    if (!state.chats.length)
      list.append(
        element(
          "p",
          "manual-empty",
          "Your conversations will appear here after an answer.",
        ),
      );
    for (const saved of state.chats) {
      const row = element(
        "div",
        "manual-row" + (saved.id === state.chatId ? " selected" : ""),
      );
      const open = element("button", "manual-choose");
      const doc = state.documents.find((item) => item.id === saved.document_id);
      open.append(
        element("strong", "", saved.title),
        element(
          "small",
          "",
          `${saved.demo ? "Example" : doc?.equipment || doc?.name || "Conversation"} · ${new Date(saved.updated).toLocaleDateString()}`,
        ),
      );
      open.addEventListener("click", () => openSavedChat(saved.id));
      const remove = element("button", "manual-delete", "Delete");
      remove.setAttribute("aria-label", `Delete chat ${saved.title}`);
      remove.addEventListener("click", async () => {
        if (chat.busy || state.saving || state.uploading)
          return toast("Wait for the current request to finish.");
        if (!confirm(`Delete the saved chat “${saved.title}”?`)) return;
        remove.disabled = true;
        try {
          await api(`/chats/${encodeURIComponent(saved.id)}`, {
            method: "DELETE",
          });
          if (state.chatId === saved.id) resetChat();
          await loadChats();
        } catch (error) {
          toast(error.message);
          remove.disabled = false;
        }
      });
      row.append(open, remove);
      list.append(row);
    }
  } catch (error) {
    $("chat-list").replaceChildren(element("p", "manual-empty", error.message));
  }
}
["chats-rail", "chats-mobile"].forEach((id) =>
  $(id).addEventListener("click", () => {
    $("chats-dialog").showModal();
    loadChats();
  }),
);
$("close-chats").addEventListener("click", () => $("chats-dialog").close());
$("drawer-new-chat").addEventListener("click", newChat);
$("retry-save").addEventListener("click", saveActiveChat);
$("question-form").addEventListener("submit", ask);
$("question").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    ask();
  }
});
$("new-chat").addEventListener("click", newChat);
$("demo-button").addEventListener("click", () =>
  state.demo ? choose("") : startExample(),
);
$("exit-demo").addEventListener("click", () => {
  choose("");
  $("manuals-dialog").showModal();
});
document.querySelectorAll("[data-prompt]").forEach((button) =>
  button.addEventListener("click", () => {
    $("question").value = DEMO_PROMPTS[button.dataset.prompt];
    ask(null, button.dataset.prompt === "alarm");
  }),
);
$("manuals-button").addEventListener("click", () =>
  $("manuals-dialog").showModal(),
);
$("close-manuals").addEventListener("click", () => $("manuals-dialog").close());
$("manual-search").addEventListener("input", renderDocuments);
["upload-header", "upload-welcome", "upload-drawer"].forEach((id) =>
  $(id).addEventListener("click", pickManual),
);
$("file-input").addEventListener("change", (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  stageManual(file);
});
$("upload-form").addEventListener("submit", upload);
$("close-upload").addEventListener("click", () => $("upload-dialog").close());
$("upload-dialog").addEventListener("cancel", (event) => {
  if (state.uploading) event.preventDefault();
});
$("attach-photo").addEventListener("click", () => $("photo-input").click());
$("photo-input").addEventListener("change", (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  stagePhoto(file);
});
$("remove-photo").addEventListener("click", clearPhoto);
$("help-button").addEventListener("click", () => $("help-dialog").showModal());
$("close-help").addEventListener("click", () => $("help-dialog").close());
window.addEventListener("pagehide", resetChat);
(async () => {
  try {
    const health = await api("/health");
    state.configured = health.configured;
    $("connection-dot").classList.toggle("connected", health.configured);
    $("connection-label").textContent = health.configured
      ? "AI service configured"
      : "Example ready · AI not configured";
    await refresh();
    if (location.hash === "#demo") startExample();
  } catch (error) {
    $("connection-label").textContent = "Server unavailable";
    toast(error.message);
  }
})();

$("help-drawer").addEventListener("click", () => {
  $("manuals-dialog").close();
  $("help-dialog").showModal();
});
