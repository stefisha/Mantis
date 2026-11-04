import { api } from "./api.js";
import { attachmentError, DEMO_PROMPTS } from "./examples.js";
import { createConversation } from "./conversation.js";

const $ = (id) => document.getElementById(id);
const chat = createConversation({ request: api });
const state = {
  documents: [],
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
  $("send-button").disabled = chat.busy || state.uploading;
  $("attach-photo").disabled = state.uploading;
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.disabled = chat.busy || state.uploading;
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
  $("mode-banner").hidden = !state.demo;
  $("suggestions").hidden = !state.demo;
  $("demo-button").textContent = state.demo ? "Exit example" : "Try an example";
  $("photo-note").textContent = state.demo
    ? "Local preview only · not analyzed in this example"
    : "Sent to OpenAI when you send this message.";
  $("composer-note").textContent = state.demo
    ? "Scripted example · no AI calls. Attachments stay in your browser."
    : !state.configured
      ? "AI service isn’t configured. Try the example, or set OPENAI_API_KEY on the server."
      : doc
        ? "Answers use this manual and recent text context. Verify citations. Photos are sent to OpenAI."
        : "Attach a photo for observations, or upload a manual for source-backed answers. Sent to OpenAI.";
}
function resetChat() {
  chat.reset();
  state.chatGeneration += 1;
  $("messages").replaceChildren();
  $("welcome").hidden = false;
  $("question").value = "";
  clearPhoto();
  lock();
}
function choose(id, demo = false) {
  if (state.uploading) return;
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
  if (photo) {
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
  if (state.uploading) return;
  choose("", true);
  $("welcome").hidden = true;
  $("question").value = DEMO_PROMPTS[prompt];
  ask(null, prompt === "alarm");
}
async function ask(event, samplePhoto = false) {
  event?.preventDefault();
  if (chat.busy || state.uploading) return;
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
$("question-form").addEventListener("submit", ask);
$("question").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    ask();
  }
});
$("new-chat").addEventListener("click", () => {
  if (!state.uploading) resetChat();
});
$("demo-button").addEventListener("click", () =>
  state.demo ? choose("") : startExample(),
);
document
  .querySelectorAll("[data-starter]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      startExample(button.dataset.starter),
    ),
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
["manuals-rail", "manuals-button"].forEach((id) =>
  $(id).addEventListener("click", () => $("manuals-dialog").showModal()),
);
$("close-manuals").addEventListener("click", () => $("manuals-dialog").close());
$("manual-search").addEventListener("input", renderDocuments);
["upload-header", "upload-drawer"].forEach((id) =>
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
