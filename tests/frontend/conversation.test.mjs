import assert from "node:assert/strict";
import test from "node:test";
import { createConversation } from "../../mantis/web/js/conversation.js";
import {
  attachmentError,
  exampleResponse,
} from "../../mantis/web/js/examples.js";
const answer = (text) => ({
  answer: text,
  sources: [],
  demo: false,
  insufficient_evidence: true,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test("live follow-ups include successful text turns and the selected manual", async () => {
  const calls = [];
  const chat = createConversation({
    request: async (_, options) => {
      calls.push(JSON.parse(options.body));
      return answer("Read the manual.");
    },
  });
  await chat.send({ question: "Spindle overload", documentId: "manual-1" });
  await chat.send({
    question: "What about that alarm?",
    documentId: "manual-1",
  });
  assert.equal(calls[1].document_id, "manual-1");
  assert.deepEqual(
    calls[1].history.map((turn) => turn.role),
    ["user", "assistant"],
  );
  assert.equal(calls[1].history[0].content, "Spindle overload");
});
test("history is bounded to the most recent four successful exchanges", async () => {
  const chat = createConversation({ request: async () => answer("response") });
  for (let i = 0; i < 8; i++) await chat.send({ question: `question ${i}` });
  assert.equal(chat.history.length, 8);
  assert.equal(chat.history[0].content, "question 4");
});
test("a reset aborts and invalidates a pending answer", async () => {
  const pending = deferred();
  let signal;
  const chat = createConversation({
    request: async (_, options) => {
      signal = options.signal;
      return pending.promise;
    },
  });
  const first = chat.send({ question: "overload" });
  chat.reset();
  assert.equal(signal.aborted, true);
  pending.resolve(answer("old"));
  assert.equal(await first, null);
  assert.deepEqual(chat.history, []);
  assert.equal(chat.busy, false);
});
test("a stale request cannot unlock a newer pending request", async () => {
  const one = deferred(),
    two = deferred();
  let calls = 0;
  const chat = createConversation({
    request: () => (++calls === 1 ? one.promise : two.promise),
  });
  const first = chat.send({ question: "old" });
  chat.reset();
  const second = chat.send({ question: "new" });
  one.resolve(answer("old response"));
  await first;
  assert.equal(chat.busy, true);
  two.resolve(answer("new response"));
  await second;
  assert.equal(chat.history[0].content, "new");
});
test("failed requests do not enter context and allow a retry", async () => {
  let fail = true;
  const chat = createConversation({
    request: async () => {
      if (fail) throw new Error("Provider unavailable");
      return answer("ready");
    },
  });
  await assert.rejects(
    chat.send({ question: "failed question" }),
    /unavailable/,
  );
  assert.deepEqual(chat.history, []);
  assert.equal(chat.busy, false);
  fail = false;
  await chat.send({ question: "retry" });
  assert.equal(chat.history[0].content, "retry");
});
test("photos are included only in the current live request", async () => {
  const calls = [];
  const chat = createConversation({
    request: async (_, options) => {
      calls.push(JSON.parse(options.body));
      return answer("observations");
    },
  });
  await chat.send({
    question: "Read this screen",
    image: "data:image/png;base64,test",
  });
  await chat.send({ question: "What details should I record?" });
  assert.equal(calls[0].image, "data:image/png;base64,test");
  assert.equal(calls[1].image, null);
  assert.equal(JSON.stringify(calls[1].history).includes("base64"), false);
});
test("the same conversation supports examples without an API request", async () => {
  const chat = createConversation({
    request: () => assert.fail("Example must not call the provider"),
  });
  const result = await chat.send({ question: "spindle overload", demo: true });
  assert.equal(result.demo, true);
  assert.equal(result.sources[0].document_id, "demo");
  assert.equal(chat.history.length, 2);
});
test("personal example photos cannot receive the sample alarm interpretation", () => {
  const local = exampleResponse("alarm", "local");
  assert.match(local.answer, /hasn’t read or analyzed/);
  assert.deepEqual(local.sources, []);
  assert.doesNotMatch(local.answer, /PLC 121/);
  assert.match(exampleResponse("alarm", "sample").answer, /PLC 121/);
});
test("example attachments never reach the server", async () => {
  const chat = createConversation({
    request: () => assert.fail("No image upload in example mode"),
  });
  const result = await chat.send({
    question: "read photo",
    demo: true,
    image: "data:image/png;base64,test",
  });
  assert.match(result.answer, /hasn’t read or analyzed/);
});
test("attachment type and file size are constrained", () => {
  assert.equal(attachmentError({ type: "image/jpeg", size: 1 }), null);
  assert.match(attachmentError({ type: "image/svg+xml", size: 1 }), /JPEG/);
  assert.match(
    attachmentError({ type: "image/png", size: 9 * 1024 * 1024 }),
    /8 MB/,
  );
});
test("reset clears previous manual context", async () => {
  const calls = [];
  const chat = createConversation({
    request: async (_, options) => {
      calls.push(JSON.parse(options.body));
      return answer("ok");
    },
  });
  await chat.send({ question: "first", documentId: "one" });
  chat.reset();
  await chat.send({ question: "second", documentId: "two" });
  assert.deepEqual(calls[1].history, []);
  assert.equal(calls[1].document_id, "two");
});
test("repeated send while busy does not duplicate the provider call", async () => {
  const pending = deferred();
  let count = 0;
  const chat = createConversation({
    request: () => {
      count++;
      return pending.promise;
    },
  });
  const first = chat.send({ question: "first" });
  assert.equal(await chat.send({ question: "second" }), null);
  pending.resolve(answer("done"));
  await first;
  assert.equal(count, 1);
});
