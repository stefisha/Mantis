import assert from "node:assert/strict";
import test from "node:test";
import { mountProductDemo } from "../../mantis/web/js/product-demo.js";
import { revealSource } from "../../mantis/web/js/source-scroll.js";

// Minimal element doubles test view state and callbacks, not browser layout.
function element() {
  const classes = new Set();
  return {
    textContent: "",
    hidden: false,
    handlers: {},
    scrolls: [],
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
      contains: (value) => classes.has(value),
      toggle: (value, on) => (on ? classes.add(value) : classes.delete(value)),
    },
    addEventListener(type, callback) {
      this.handlers[type] = callback;
    },
    scrollIntoView(options) {
      this.scrolls.push(options);
    },
  };
}
function view() {
  const ids = Object.fromEntries(
    [
      "demo-source",
      "demo-source-text",
      "demo-page",
      "demo-citation",
      "demo-answer",
      "demo-question",
    ].map((id) => [id, element()]),
  );
  const buttons = ["vibration", "overheating", "records"].map((question) =>
    Object.assign(element(), { dataset: { question } }),
  );
  return {
    ids,
    buttons,
    root: { getElementById: (id) => ids[id], querySelectorAll: () => buttons },
  };
}
function media(width, reduced = false) {
  return (query) => ({
    matches: query.includes("prefers-reduced-motion")
      ? reduced
      : width <= Number(query.match(/\d+/)[0]),
  });
}
const response = (name, page) => ({
  answer: name,
  sources: [{ text: `${name} evidence`, page }],
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test("a failed replacement request cannot retain the previous source or highlight", async () => {
  const { root, ids, buttons } = view();
  const pending = deferred();
  await mountProductDemo({
    root,
    matchMedia: media(1000),
    request: async (path, options) =>
      path === "/health"
        ? {}
        : JSON.parse(options.body).question === "vibration"
          ? response("Vibration", 4)
          : pending.promise,
  });
  assert.equal(ids["demo-page"].textContent, "Page 4 · source excerpt");
  ids["demo-citation"].handlers.click();
  const next = buttons[1].handlers.click();
  assert.equal(ids["demo-source"].classList.contains("inspected"), false);
  assert.equal(ids["demo-page"].textContent, "Retrieving source");
  assert.equal(
    ids["demo-source-text"].textContent.includes("Vibration evidence"),
    false,
  );
  assert.equal(ids["demo-citation"].hidden, true);
  pending.reject(new Error("Too many requests. Please wait a minute."));
  await next;
  assert.equal(
    ids["demo-answer"].textContent,
    "Too many requests. Please wait a minute.",
  );
  assert.equal(ids["demo-page"].textContent, "Source unavailable");
  assert.equal(
    ids["demo-source-text"].textContent.includes("Vibration evidence"),
    false,
  );
  assert.equal(ids["demo-citation"].hidden, true);
});

test("an older response cannot restore a stale source after a newer question fails", async () => {
  const { root, ids, buttons } = view();
  const old = deferred();
  await mountProductDemo({
    root,
    matchMedia: media(1000),
    request: async (path, options) => {
      if (path === "/health") return {};
      const question = JSON.parse(options.body).question;
      if (question === "vibration") return response("Vibration", 4);
      if (question === "overheating") return old.promise;
      throw new Error("Request failed");
    },
  });
  const earlier = buttons[1].handlers.click();
  await buttons[2].handlers.click();
  old.resolve(response("Overheating", 7));
  await earlier;
  assert.equal(ids["demo-question"].textContent, "records");
  assert.equal(ids["demo-answer"].textContent, "Request failed");
  assert.equal(ids["demo-page"].textContent, "Source unavailable");
  assert.equal(
    ids["demo-source-text"].textContent.includes("Overheating evidence"),
    false,
  );
});

for (const [width, breakpoint, reduced, behavior] of [
  [1000, 1100, false, "smooth"],
  [1100, 1100, false, "smooth"],
  [1000, 1100, true, "auto"],
  [1101, 1100, false, null],
  [1000, 1000, true, "auto"],
  [1001, 1000, false, null],
]) {
  test(`source reveal: width ${width}, breakpoint ${breakpoint}, reduced motion ${reduced}`, () => {
    const target = element();
    revealSource(target, breakpoint, media(width, reduced));
    assert.deepEqual(
      target.scrolls,
      behavior ? [{ behavior, block: "center" }] : [],
    );
  });
}
