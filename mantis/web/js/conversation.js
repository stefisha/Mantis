import { exampleResponse } from "./examples.js";

/** Own request lifetime and bounded text context independently of the interface. */
export function createConversation({ request }) {
  let turns = [];
  let generation = 0;
  let busy = false;
  let controller;
  return {
    get busy() {
      return busy;
    },
    get history() {
      return turns.map((turn) => ({ ...turn }));
    },
    reset() {
      generation += 1;
      controller?.abort();
      turns = [];
      busy = false;
    },
    restore(messages) {
      generation += 1;
      controller?.abort();
      turns = messages
        .slice(-8)
        .map(({ role, content }) => ({ role, content }));
      busy = false;
    },
    async send({
      question,
      documentId = "",
      demo = false,
      image = null,
      sample = false,
    }) {
      if (busy) return null;
      busy = true;
      const current = generation;
      controller = new AbortController();
      try {
        const result = demo
          ? await Promise.resolve(
              exampleResponse(
                question,
                sample ? "sample" : image ? "local" : null,
              ),
            )
          : await request("/questions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                question,
                document_id: documentId,
                history: turns,
                image,
                demo: false,
              }),
            });
        if (current !== generation) return null;
        // Retain only successful text turns; images are sent on the current request only.
        turns = [
          ...turns,
          { role: "user", content: question },
          { role: "assistant", content: result.answer },
        ].slice(-8);
        return result;
      } catch (error) {
        if (current !== generation) return null;
        throw error;
      } finally {
        if (current === generation) busy = false;
      }
    },
  };
}
