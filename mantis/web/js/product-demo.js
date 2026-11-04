export const DEMO_PROMPTS = {
  spindle:
    "My CNC machine reports “spindle overload” and sounds louder than usual. What should I check first?",
  alarm:
    "I’m getting these alarms on the machine screen. Can you help me understand them?",
  followup:
    "What should I record before handing this over to a maintenance technician?",
};

/** Deliberately fixed scenarios: no inference, machine diagnosis, or provider calls. */
export function demoReply(question, attachmentKind = null) {
  if (attachmentKind === "local") {
    return "Your photo is visible in this chat, but this demo hasn’t read or analyzed it.\n\nTo explore the prepared photo conversation, choose “Try an alarm photo”. It uses an illustrative screen with known sample labels.\n\nFor a real incident, record the exact alarm text and equipment model, then consult the matching manual and your qualified maintenance team.";
  }
  if (attachmentKind === "sample") {
    return "This prepared example lists three alarm labels:\n\n01 / PLC 121 — Machine off\n02 / PLC 122 — Door / safety device\n03 / Battery voltage range\n\nWhat machine model and controller is this? Code meanings vary by equipment. Record the exact messages and when they appeared, then compare them with the matching manual before planning checks.";
  }
  if (/record|handover|handing|technician|log|zabele/i.test(question)) {
    return "Here’s a sample handover note to build on:\n\n• Equipment model and controller\n• Exact alarm code and message\n• Time of the event and operating conditions\n• Any unusual noise, vibration, or heat\n• Recent tool changes or maintenance\n• A photo of the screen, if your site permits it\n\nInclude what happened before the alarm. The maintenance team can then compare it with the correct manual and decide the next safe step.";
  }
  if (/spindle|overload|noise|vibrat|vreten|preoptere/i.test(question)) {
    return "Let’s start with the context, before assuming a cause.\n\nAn overload message and a change in sound are useful observations, but they don’t identify a fault on their own. Follow the site’s stop and isolation procedures if abnormal operation is suspected.\n\nFor the maintenance handover, capture:\n01 / The exact alarm and machine model\n02 / When the sound changed\n03 / The operation and tool in use\n04 / Any recent setup or maintenance changes\n\nDo you also have a photo of the alarm screen? You can try the sample photo below.";
  }
  return "This is a scripted interaction preview, so I can’t diagnose that issue or search your manuals here.\n\nTry “Spindle overload”, “Try an alarm photo”, or “What should I record?” to explore the prepared conversation.\n\nTo ask questions about your own PDF manual, open the maintenance workspace. Live manual answers require a configured API key; photo analysis is not available yet.";
}

export function attachmentError(file) {
  if (!file) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return "Choose a JPEG, PNG, or WebP image.";
  }
  if (file.size > 8 * 1024 * 1024) return "Choose an image smaller than 8 MB.";
  return null;
}

export function mountProductDemo({
  root,
  wait = () => new Promise((resolve) => setTimeout(resolve, 650)),
  urls = URL,
}) {
  const el = (id) => root.getElementById(id);
  const thread = el("demo-thread");
  const input = el("demo-message");
  const fileInput = el("demo-file");
  const send = el("demo-send");
  const feedback = el("demo-feedback");
  const prompts = [...root.querySelectorAll("[data-prompt]")];
  const objectUrls = new Set();
  let attachment = null;
  let generation = 0;
  let busy = false;
  let turns = 0;

  function addMessage(role, text, image = null, pending = false) {
    const item = root.createElement("div");
    item.className = `conversation-message ${role}${pending ? " message-pending" : ""}`;
    const author = root.createElement("div");
    author.className = "message-author";
    author.textContent = role === "user" ? "YOU" : "MANTIS";
    if (role === "assistant") {
      const mark = root.createElement("img");
      mark.src = "/static/assets/mantis-mark.png";
      mark.alt = "";
      author.prepend(mark);
    }
    const bubble = root.createElement("div");
    bubble.className = "message-bubble";
    if (image) {
      const preview = root.createElement("img");
      preview.src = image.url;
      preview.alt =
        image.kind === "sample"
          ? "Illustrative CNC alarm screen"
          : "Your attached photo (not analyzed)";
      bubble.append(preview);
    }
    const body = root.createElement("p");
    body.textContent = text;
    bubble.append(body);
    item.append(author, bubble);
    if (role === "assistant" && !pending) {
      const caption = root.createElement("p");
      caption.className = "message-caption";
      caption.textContent = "SCRIPTED EXAMPLE";
      item.append(caption);
    }
    thread.append(item);
    // Scroll only this transcript; never move the surrounding page on load/reply.
    thread.scrollTop = thread.scrollHeight;
    return item;
  }

  function setBusy(value) {
    busy = value;
    send.disabled = value;
    prompts.forEach((button) => (button.disabled = value));
  }

  function clearAttachment(release = false) {
    if (release && attachment?.kind === "local") {
      urls.revokeObjectURL(attachment.url);
      objectUrls.delete(attachment.url);
    }
    attachment = null;
    el("demo-attachment").hidden = true;
    el("demo-preview").removeAttribute("src");
    fileInput.value = "";
  }

  async function submit(question, image = attachment) {
    question = question.trim().slice(0, 600);
    if (busy || (!question && !image)) return;
    if (turns >= 20) {
      feedback.textContent =
        "This demo chat is full. Choose New chat to start again.";
      return;
    }
    const current = generation;
    turns += 1;
    setBusy(true);
    addMessage("user", question || "Can you help with this photo?", image);
    input.value = "";
    clearAttachment(); // Keep sent object URLs alive until New chat.
    const pending = addMessage("assistant", "•••", null, true);
    feedback.textContent = "Preparing the scripted example…";
    try {
      await wait();
      if (current !== generation) return;
      pending.remove();
      addMessage("assistant", demoReply(question, image?.kind));
      feedback.textContent =
        "Example complete. Try a follow-up or start a new chat.";
    } catch {
      if (current !== generation) return;
      pending.remove();
      feedback.textContent = "The preview couldn’t finish. Please try again.";
    } finally {
      if (current === generation) setBusy(false);
    }
  }

  function reset() {
    generation += 1;
    objectUrls.forEach((url) => urls.revokeObjectURL(url));
    objectUrls.clear();
    clearAttachment();
    input.value = "";
    turns = 0;
    setBusy(false);
    thread.replaceChildren();
    addMessage(
      "assistant",
      "Hi, I’m Mantis. Let’s put the machine’s symptoms into context.\n\nTry a spindle-overload question or the prepared alarm photo. You can also attach your own image for a local preview—this demo won’t analyze it.",
    );
    feedback.textContent =
      "Try an example, or type a question about a CNC alarm.";
  }

  el("demo-form").addEventListener("submit", (event) => {
    event.preventDefault();
    return submit(input.value);
  });
  prompts.forEach((button) =>
    button.addEventListener("click", () => {
      if (busy) return;
      if (button.dataset.prompt === "alarm") {
        clearAttachment(true);
        return submit(DEMO_PROMPTS.alarm, {
          kind: "sample",
          url: "/static/assets/demo-alarm.svg",
        });
      }
      return submit(DEMO_PROMPTS[button.dataset.prompt]);
    }),
  );
  el("demo-reset").addEventListener("click", reset);
  el("demo-attach").addEventListener("click", () => fileInput.click());
  el("demo-remove").addEventListener("click", () => clearAttachment(true));
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return; // Cancelling preserves the previous selection.
    const error = attachmentError(file);
    if (error) {
      feedback.textContent = error;
      fileInput.value = "";
      return;
    }
    clearAttachment(true);
    const url = urls.createObjectURL(file);
    objectUrls.add(url);
    attachment = { kind: "local", url };
    el("demo-preview").src = url;
    el("demo-filename").textContent = file.name;
    el("demo-attachment").hidden = false;
    feedback.textContent =
      "Photo ready. It stays in your browser and will not be analyzed.";
    input.focus();
  });
  // Release local photo references when leaving the page, including bfcache entry.
  root.defaultView?.addEventListener("pagehide", reset);
  reset();
  return { reset, submit };
}
