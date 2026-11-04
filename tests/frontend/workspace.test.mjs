import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mountWorkspace } from "../../mantis/web/js/workspace.js";

class Element {
  children = [];
  handlers = {};
  attributes = {};
  value = "";
  hidden = false;
  disabled = false;
  open = false;
  classList = { toggle() {} };
  append(...nodes) {
    this.children.push(...nodes);
  }
  prepend(...nodes) {
    this.children.unshift(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  remove() {}
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  removeAttribute(key) {
    delete this.attributes[key];
  }
  addEventListener(key, fn) {
    this.handlers[key] = fn;
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  focus() {}
  click() {
    if (!this.disabled) return this.handlers.click?.();
  }
}
const manual = { id: "manual", name: "manual.pdf", equipment: "CNC", pages: 1 };
const result = { answer: "Answer", sources: [] };
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function setup(
  handler = () => undefined,
  documents = [manual],
  confirmAction = () => true,
) {
  const html = readFileSync(
    new URL("../../mantis/web/pages/workspace.html", import.meta.url),
    "utf8",
  );
  const nodes = Object.fromEntries(
    [...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element()]),
  );
  const calls = [];
  const root = {
    getElementById: (id) => nodes[id],
    createElement: () => new Element(),
    querySelectorAll: () => [],
    defaultView: {
      location: { href: "http://localhost/workspace", hash: "" },
      history: { replaceState() {} },
      addEventListener() {},
    },
  };
  const app = mountWorkspace({
    root,
    confirmAction,
    schedule: () => 0,
    cancel() {},
    request: async (path, options = {}) => {
      calls.push({ path, ...options });
      const override = handler(path, options);
      if (override !== undefined) return override;
      if (path === "/health") return { configured: true };
      if (path === "/documents") return { documents };
      if (path === "/questions") return result;
      if (path.startsWith("/chats"))
        return { chat: { id: "chat", revision: 1 } };
      throw new Error(`Unexpected ${path}`);
    },
  });
  await app.ready;
  return { app, nodes, calls, documents };
}
async function ask(ctx) {
  ctx.nodes.question.value = "What should I record?";
  await ctx.app.ask();
}
function deleteButton(nodes) {
  return nodes["manual-list"].children[0].children[1];
}

test("manual deletion and upload switches are blocked during pending or failed saves", async () => {
  const save = deferred();
  const ctx = await setup((path) =>
    path === "/chats" ? save.promise : undefined,
  );
  ctx.app.choose(manual.id);
  const asking = ask(ctx);
  // Let the answer start its save.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(ctx.app.state.saving, true);
  await deleteButton(ctx.nodes).click();
  assert.equal(ctx.app.choose("", true), false);
  save.resolve(Promise.reject(new Error("Save failed")));
  await asking;
  assert.equal(ctx.app.state.unsaved, true);
  await deleteButton(ctx.nodes).click();
  await ctx.nodes["exit-demo"].click();
  ctx.nodes["file-input"].handlers.change({
    target: { files: [new File(["PDF"], "new.pdf")], value: "" },
  });
  assert.equal(ctx.nodes["upload-dialog"].open, false);
  assert.equal(ctx.nodes["manuals-dialog"].open, false);
  assert.equal(ctx.app.state.selected, manual.id);
  assert.equal(
    ctx.calls.some((c) => c.method === "DELETE"),
    false,
  );
  assert.equal(ctx.nodes.toast.textContent.includes("Manual connected"), false);
});

test("retry cannot race a follow-up answer and the complete transcript is saved", async () => {
  const answer = deferred();
  let questions = 0;
  let saves = 0;
  const ctx = await setup((path) => {
    if (path === "/questions" && ++questions === 2) return answer.promise;
    if (path === "/chats" && ++saves === 1)
      return Promise.reject(new Error("offline"));
  });
  ctx.app.choose(manual.id);
  await ask(ctx);
  assert.equal(ctx.app.state.unsaved, true);
  const asking = ask(ctx);
  assert.equal(ctx.nodes["retry-save"].disabled, true);
  await ctx.app.saveActiveChat();
  assert.equal(saves, 1);
  answer.resolve(result);
  await asking;
  const writes = ctx.calls.filter((c) => c.path === "/chats");
  assert.equal(JSON.parse(writes.at(-1).body).messages.length, 4);
  assert.equal(ctx.app.state.unsaved, false);
});

test("removed manual stays attached to old chat but New chat clears unavailable selection", async () => {
  const saved = {
    id: "saved",
    revision: 3,
    document_id: "removed",
    demo: false,
    messages: [
      { role: "user", content: "Question" },
      { role: "assistant", content: "Answer", sources: [] },
    ],
  };
  const ctx = await setup(
    (path) => (path === "/chats/saved" ? { chat: saved } : undefined),
    [],
  );
  await ctx.app.openSavedChat("saved");
  assert.equal(ctx.app.state.selected, "removed");
  assert.equal(ctx.app.state.missingManual, true);
  await ask(ctx);
  assert.equal(
    ctx.calls.some((c) => c.path === "/questions"),
    false,
  );
  ctx.app.newChat();
  assert.equal(ctx.app.state.selected, "");
  assert.equal(ctx.app.state.missingManual, false);
});

test("refresh preserves unsaved manual context and discard confirmation recovers permanent save failures", async () => {
  let discard = false;
  const ctx = await setup(
    (path) =>
      path === "/chats"
        ? Promise.reject(new Error("413 transcript too large"))
        : undefined,
    [manual],
    () => discard,
  );
  ctx.app.choose(manual.id);
  await ask(ctx);
  ctx.documents.splice(0);
  await ctx.app.refresh();
  assert.equal(ctx.app.state.selected, manual.id);
  assert.equal(ctx.app.state.missingManual, true);
  assert.equal(ctx.app.newChat(), false);
  assert.equal(ctx.app.state.transcript.length, 2);
  discard = true;
  assert.equal(ctx.app.newChat(), true);
  assert.equal(ctx.app.state.transcript.length, 0);
  assert.equal(ctx.app.state.unsaved, false);
  assert.equal(ctx.app.state.selected, "");
});

test("successful upload selects the uploaded manual and New chat retains a valid manual", async () => {
  const docs = [manual];
  const uploaded = { ...manual, id: "new", name: "new.pdf" };
  const ctx = await setup((path, options) => {
    if (path === "/documents" && options.method === "POST") {
      docs.push(uploaded);
      return { document: uploaded };
    }
  }, docs);
  ctx.app.choose("", true);
  ctx.nodes["file-input"].handlers.change({
    target: { files: [new File(["PDF"], "new.pdf")], value: "" },
  });
  await ctx.app.upload({ preventDefault() {} });
  assert.equal(ctx.app.state.selected, "new");
  assert.equal(ctx.app.state.demo, false);
  assert.equal(ctx.nodes["upload-dialog"].open, false);
  assert.match(ctx.nodes.toast.textContent, /Manual connected/);
  ctx.app.newChat();
  assert.equal(ctx.app.state.selected, "new");
});
