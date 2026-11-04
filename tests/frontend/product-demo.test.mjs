import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentError,
  demoReply,
  mountProductDemo,
} from "../../mantis/web/js/product-demo.js";
import { revealSource } from "../../mantis/web/js/source-scroll.js";

// These doubles exercise state and callbacks; browser checks cover layout.
function element() {
  return {
    textContent: "",
    value: "",
    hidden: false,
    children: [],
    handlers: {},
    dataset: {},
    append(...items) {
      this.children.push(...items);
      for (const item of items) item.parent = this;
    },
    prepend(item) {
      this.children.unshift(item);
    },
    remove() {
      this.parent.children = this.parent.children.filter(
        (item) => item !== this,
      );
    },
    replaceChildren() {
      this.children = [];
    },
    removeAttribute(name) {
      delete this[name];
    },
    addEventListener(type, callback) {
      this.handlers[type] = callback;
    },
    focus() {},
    click() {},
  };
}
function view() {
  const ids = Object.fromEntries(
    [
      "demo-thread",
      "demo-message",
      "demo-file",
      "demo-send",
      "demo-feedback",
      "demo-attachment",
      "demo-preview",
      "demo-filename",
      "demo-form",
      "demo-reset",
      "demo-attach",
      "demo-remove",
    ].map((id) => [id, element()]),
  );
  const buttons = ["spindle", "alarm", "followup"].map((prompt) =>
    Object.assign(element(), { dataset: { prompt } }),
  );
  const root = {
    getElementById: (id) => ids[id],
    createElement: element,
    querySelectorAll: () => buttons,
  };
  return { root, ids, buttons };
}
function textOf(item) {
  return [item.textContent, ...item.children.map(textOf)].join(" ");
}

test("a new chat invalidates a pending reply and removes its transcript", async () => {
  const { root, ids, buttons } = view();
  let finish;
  const demo = mountProductDemo({
    root,
    wait: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const pending = demo.submit("spindle overload");
  assert.equal(ids["demo-thread"].children.length, 3);
  assert.equal(ids["demo-send"].disabled, true);
  assert.equal(buttons[0].disabled, true);
  demo.reset();
  finish();
  await pending;
  assert.equal(ids["demo-thread"].children.length, 1);
  assert.equal(ids["demo-send"].disabled, false);
});

test("an attached personal image cannot receive the prepared alarm interpretation", async () => {
  const { root, ids } = view();
  const demo = mountProductDemo({ root, wait: async () => {} });
  await demo.submit("These are my PLC alarms", {
    kind: "local",
    url: "blob:test",
  });
  const text = textOf(ids["demo-thread"]);
  assert.match(text, /hasn’t read or analyzed/);
  assert.doesNotMatch(text, /PLC 121/);
});

test("sample alarm button sends the illustrative attachment with its known labels", async () => {
  const { root, ids, buttons } = view();
  mountProductDemo({ root, wait: async () => {} });
  await buttons[1].handlers.click();
  const user = ids["demo-thread"].children[1];
  assert.equal(
    user.children[1].children[0].src,
    "/static/assets/demo-alarm.svg",
  );
  assert.match(textOf(ids["demo-thread"]), /prepared example lists/);
});

test("selected and sent local photo URLs are released on reset", async () => {
  const { root, ids } = view();
  let next = 0;
  const revoked = [];
  const demo = mountProductDemo({
    root,
    wait: async () => {},
    urls: {
      createObjectURL: () => `blob:${++next}`,
      revokeObjectURL: (url) => revoked.push(url),
    },
  });
  const select = () => {
    ids["demo-file"].files = [
      { type: "image/png", size: 100, name: "alarm.png" },
    ];
    ids["demo-file"].handlers.change();
  };
  select();
  await demo.submit("look");
  select();
  assert.deepEqual(revoked, []);
  demo.reset();
  assert.deepEqual(revoked, ["blob:1", "blob:2"]);
  assert.equal(ids["demo-attachment"].hidden, true);
});

test("photo selection cancellation preserves an existing attachment", () => {
  const { root, ids } = view();
  const demo = mountProductDemo({
    root,
    urls: { createObjectURL: () => "blob:photo", revokeObjectURL() {} },
  });
  ids["demo-file"].files = [{ type: "image/png", size: 1, name: "screen.png" }];
  ids["demo-file"].handlers.change();
  ids["demo-file"].files = [];
  ids["demo-file"].handlers.change();
  assert.equal(ids["demo-preview"].src, "blob:photo");
  assert.equal(ids["demo-attachment"].hidden, false);
  demo.reset();
});

test("unsupported questions explicitly describe the demo limits", () => {
  assert.match(
    demoReply("Can you order a replacement?"),
    /scripted interaction preview/,
  );
  assert.match(
    demoReply("Can you order a replacement?"),
    /photo analysis is not available/,
  );
});

test("image files are constrained by type and size", () => {
  assert.equal(attachmentError({ type: "image/jpeg", size: 100 }), null);
  assert.match(attachmentError({ type: "image/svg+xml", size: 100 }), /JPEG/);
  assert.match(
    attachmentError({ type: "image/png", size: 9 * 1024 * 1024 }),
    /8 MB/,
  );
});

test("blank submissions do not append messages", async () => {
  const { root, ids } = view();
  const demo = mountProductDemo({ root });
  await demo.submit("   ");
  assert.equal(ids["demo-thread"].children.length, 1);
});

test("handover follow-up contains documentation context rather than a diagnosis", () => {
  assert.match(
    demoReply("What should I record?"),
    /Equipment model and controller/,
  );
});

for (const [width, reduced, expected] of [
  [1000, false, "smooth"],
  [1000, true, "auto"],
  [1001, false, null],
]) {
  test(`workspace source reveal at ${width}px, reduced motion ${reduced}`, () => {
    const calls = [];
    revealSource(
      { scrollIntoView: (options) => calls.push(options) },
      1000,
      (query) => ({
        matches: query.includes("prefers-reduced-motion")
          ? reduced
          : width <= 1000,
      }),
    );
    assert.deepEqual(
      calls,
      expected ? [{ behavior: expected, block: "center" }] : [],
    );
  });
}
