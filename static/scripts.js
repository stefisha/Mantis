"use strict";
const $ = (id) => document.getElementById(id);
const state = {
  documents: [],
  selected: "",
  demo: false,
  busy: false,
  file: null,
  configured: false,
};
let toastTimer;
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 7000);
}
async function api(path, options = {}) {
  const response = await fetch("/api" + path, options);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "The server returned an unexpected response. Please retry.",
    );
  }
  if (!response.ok)
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : "Please check the submitted information.",
    );
  return body;
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function view(name) {
  $("assistant-view").hidden = name !== "assistant";
  $("library-view").hidden = name !== "library";
  $("assistant-nav").classList.toggle("active", name === "assistant");
  $("library-nav").classList.toggle("active", name === "library");
  $("page-label").textContent =
    name === "assistant" ? "Maintenance assistant" : "Manual library";
}
function resetChat() {
  $("messages").replaceChildren();
  $("welcome").hidden = false;
  $("source-detail").replaceChildren(
    element("div", "source-empty", "▧"),
    element("h4", "", "Answers you can trace."),
    element(
      "p",
      "",
      "Select a citation in an answer to see the exact manual passage here.",
    ),
  );
}
function updateMode() {
  $("mode-label").textContent = state.demo
    ? "Demo workspace"
    : state.selected
      ? "Manual connected"
      : "Ready to get started";
  $("mode-description").textContent = state.demo
    ? "Illustrative excerpts · no AI calls"
    : state.selected
      ? "Answers scoped to the selected equipment manual"
      : "Add a manual or explore the sample workspace";
  $("composer-mode").textContent = state.demo
    ? "Sample excerpts · demo mode"
    : "Grounded in your selected manual";
  $("demo-button").textContent = state.demo
    ? "Exit demo ↗"
    : "Explore demo ↗";
}
function choose(id, demo = false) {
  if (state.busy) {
    toast("Wait for the current answer before changing manuals.");
    return;
  }
  state.selected = id;
  state.demo = demo;
  resetChat();
  renderDocuments();
  updateMode();
  view("assistant");
}
function renderDocuments() {
  $("nav-count").textContent = state.documents.length;
  const sidebar = $("sidebar-documents");
  sidebar.replaceChildren();
  if (!state.documents.length)
    sidebar.append(
      element("p", "muted small", "Your manuals will appear here."),
    );
  for (const doc of state.documents) {
    const b = element("button");
    b.append(element("span", "", "▤"), element("span", "", doc.name));
    b.addEventListener("click", () => choose(doc.id));
    sidebar.append(b);
  }
  const select = $("manual-select");
  select.replaceChildren(new Option("Select an equipment manual", ""));
  if (state.demo)
    select.append(new Option("Training scenario · sample manual", "demo"));
  state.documents.forEach((doc) =>
    select.append(
      new Option(
        (doc.equipment ? doc.equipment + " · " : "") + doc.name,
        doc.id,
      ),
    ),
  );
  select.value = state.demo ? "demo" : state.selected;
  renderLibrary();
}
function renderLibrary() {
  const list = $("library-list");
  list.replaceChildren();
  const search = $("library-search").value.toLowerCase();
  const docs = state.documents.filter((d) =>
    (d.name + " " + d.equipment).toLowerCase().includes(search),
  );
  $("clear-library").disabled = !state.documents.length;
  if (!docs.length) {
    const empty = element("div", "library-empty");
    empty.append(
      element(
        "h2",
        "",
        search
          ? "No matching manuals."
          : "A home for your equipment knowledge.",
      ),
      element(
        "p",
        "",
        search
          ? "Try a different filename or equipment model."
          : "Upload your first PDF manual to start asking grounded questions.",
      ),
    );
    list.append(empty);
  }
  docs.forEach((doc) => {
    const row = element("div", "document-row"),
      info = element("div", "document-info");
    info.append(
      element("strong", "", doc.name),
      element(
        "p",
        "",
        `${doc.equipment || "Equipment not specified"} · ${doc.pages} pages · ${doc.chunks} passages`,
      ),
    );
    const ask = element("button", "primary-button", "Ask manual ↗");
    ask.addEventListener("click", () => choose(doc.id));
    const remove = element("button", "danger-text", "Delete");
    remove.addEventListener("click", async () => {
      if (state.busy)
        return toast("Wait for the current answer before deleting a manual.");
      if (!confirm(`Delete “${doc.name}” and its searchable passages?`)) return;
      remove.disabled = true;
      try {
        await api("/documents/" + doc.id, { method: "DELETE" });
        if (state.selected === doc.id) {
          state.selected = "";
          resetChat();
        }
        await refresh();
        toast("Manual and its index deleted.");
      } catch (e) {
        toast(e.message);
        remove.disabled = false;
      }
    });
    row.append(element("span", "document-icon", "▤"), info, ask, remove);
    list.append(row);
  });
}
async function refresh() {
  const result = await api("/documents");
  state.documents = result.documents;
  if (state.selected && !state.documents.some((d) => d.id === state.selected))
    state.selected = "";
  renderDocuments();
  updateMode();
}
function pickFile() {
  if (state.busy) return toast("Wait for the current request to finish.");
  $("file-input").click();
}
function stageFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".pdf"))
    return toast("Choose a PDF manual.");
  if (file.size > 20 * 1024 * 1024)
    return toast("Choose a PDF smaller than 20 MB.");
  state.file = file;
  $("upload-filename").textContent = file.name;
  $("equipment").value = "";
  $("upload-progress").textContent = "";
  $("upload-dialog").showModal();
}
async function upload(event) {
  event.preventDefault();
  if (!state.file || state.busy) return;
  state.busy = true;
  $("confirm-upload").disabled = true;
  $("close-upload").disabled = true;
  $("upload-progress").textContent =
    "Reading and indexing the manual. Larger files may take a moment…";
  const data = new FormData();
  data.append("file", state.file);
  data.append("equipment", $("equipment").value.trim());
  try {
    const result = await api("/documents", { method: "POST", body: data });
    await refresh();
    state.busy = false;
    choose(result.document.id);
    $("upload-dialog").close();
    toast(
      result.duplicate
        ? "This manual is already in your library."
        : "Manual indexed. You’re ready to ask a question.",
    );
  } catch (e) {
    $("upload-progress").textContent = e.message;
  } finally {
    state.busy = false;
    $("confirm-upload").disabled = false;
    $("close-upload").disabled = false;
    $("file-input").value = "";
  }
}
function inspect(source) {
  const detail = $("source-detail");
  detail.replaceChildren();
  detail.append(
    element("p", "card-kicker", "SOURCE PASSAGE"),
    element("strong", "small", source.name),
    element("p", "", "Page " + source.page),
    element("p", "source-excerpt", source.text),
  );
  if (source.document_id !== "demo") {
    const link = element("a", "", "Open manual at page " + source.page + " ↗");
    link.href =
      "/api/documents/" +
      encodeURIComponent(source.document_id) +
      "/file#page=" +
      source.page;
    link.target = "_blank";
    link.rel = "noopener";
    detail.append(link);
  } else
    detail.append(
      element("p", "", "Illustrative demo material. Not a service procedure."),
    );
  if (window.innerWidth < 900)
    detail.scrollIntoView({ behavior: "smooth", block: "center" });
}
function addMessage(role, text, result) {
  const node = element("article", "message " + role);
  node.append(
    element("div", "message-header", role === "user" ? "YOU" : "✳  MANTIS"),
    element("div", "message-body", text),
  );
  if (result) {
    if (result.demo || result.insufficient_evidence)
      node.append(
        element(
          "p",
          "answer-note",
          result.demo
            ? "Demo · illustrative source excerpt"
            : "Insufficient evidence · verify the selected manual",
        ),
      );
    const sources = element("div", "citations");
    result.sources.forEach((source, i) => {
      const button = element(
        "button",
        "citation",
        `${i + 1} · ${source.name} · p. ${source.page}`,
      );
      button.addEventListener("click", () => inspect(source));
      sources.append(button);
    });
    node.append(sources);
    if (result.sources.length) inspect(result.sources[0]);
  }
  $("messages").append(node);
  $("chat-scroll").scrollTop = $("chat-scroll").scrollHeight;
}
async function ask(event) {
  if (event) event.preventDefault();
  if (state.busy) return;
  const question = $("question").value.trim();
  if (question.length < 3)
    return toast("Enter a question with at least three characters.");
  if (!state.demo && !state.selected)
    return toast("Select or upload a manual, or choose Explore demo first.");
  state.busy = true;
  $("send-button").disabled = true;
  $("manual-select").disabled = true;
  $("welcome").hidden = true;
  addMessage("user", question);
  $("question").value = "";
  const pending = element(
    "div",
    "pending",
    state.demo
      ? "Finding the sample passage…"
      : "Searching your manual and checking sources…",
  );
  $("messages").append(pending);
  try {
    const result = await api("/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        document_id: state.selected,
        demo: state.demo,
      }),
    });
    pending.remove();
    addMessage("assistant", result.answer, result);
  } catch (e) {
    pending.remove();
    addMessage("assistant", e.message);
    $("question").value = question;
  } finally {
    state.busy = false;
    $("send-button").disabled = false;
    $("manual-select").disabled = false;
    $("question").focus();
  }
}
document.querySelectorAll("[data-question]").forEach((button) =>
  button.addEventListener("click", () => {
    $("question").value = button.dataset.question;
    ask();
  }),
);
$("question-form").addEventListener("submit", ask);
$("question").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    ask();
  }
});
$("manual-select").addEventListener("change", (event) =>
  choose(
    event.target.value === "demo" ? "" : event.target.value,
    event.target.value === "demo",
  ),
);
$("new-chat").addEventListener("click", () => {
  if (!state.busy) resetChat();
});
$("demo-button").addEventListener("click", () => choose("", !state.demo));
$("assistant-nav").addEventListener("click", () => view("assistant"));
$("library-nav").addEventListener("click", () => view("library"));
["add-manual", "upload-sidebar", "library-upload", "drop-zone"].forEach((id) =>
  $(id).addEventListener("click", pickFile),
);
$("file-input").addEventListener("change", (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  stageFile(file);
});
$("upload-form").addEventListener("submit", upload);
$("close-upload").addEventListener("click", () => $("upload-dialog").close());
$("upload-dialog").addEventListener("cancel", (event) => {
  if (state.busy) event.preventDefault();
});
$("help-button").addEventListener("click", () => $("help-dialog").showModal());
$("close-help").addEventListener("click", () => $("help-dialog").close());
$("library-search").addEventListener("input", renderLibrary);
$("clear-library").addEventListener("click", async () => {
  if (state.busy) return toast("Wait for the current request to finish.");
  if (!confirm("Delete all manuals and their indexes from this workspace?"))
    return;
  try {
    await api("/documents", { method: "DELETE" });
    state.selected = "";
    resetChat();
    await refresh();
    toast("Library cleared.");
  } catch (e) {
    toast(e.message);
  }
});
const zone = $("drop-zone");
["dragenter", "dragover"].forEach((type) =>
  zone.addEventListener(type, (event) => {
    event.preventDefault();
    zone.classList.add("dragging");
  }),
);
["dragleave", "drop"].forEach((type) =>
  zone.addEventListener(type, (event) => {
    event.preventDefault();
    zone.classList.remove("dragging");
  }),
);
zone.addEventListener("drop", (event) => {
  if (!state.busy) stageFile(event.dataTransfer.files[0]);
});
(async () => {
  try {
    const health = await api("/health");
    state.configured = health.configured;
    $("connection-label").textContent = health.configured
      ? "AI service configured"
      : "Demo ready · AI not configured";
    await refresh();
  } catch (e) {
    $("connection-label").textContent = "Server unavailable";
    $("connection-dot").style.backgroundColor = "#c48d6c";
    toast(e.message);
  }
})();
