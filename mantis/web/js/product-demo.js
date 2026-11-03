import { revealSource } from "./source-scroll.js";

/** Bind the product demo; dependencies keep failure/race behavior testable without a browser. */
export function mountProductDemo({ root, request, matchMedia }) {
  const buttons = [...root.querySelectorAll("[data-question]")];
  const source = root.getElementById("demo-source");
  const sourceText = root.getElementById("demo-source-text");
  const page = root.getElementById("demo-page");
  const citation = root.getElementById("demo-citation");
  const answer = root.getElementById("demo-answer");
  let requestNumber = 0;

  async function showExample(button) {
    const current = ++requestNumber;
    buttons.forEach((item) => item.classList.toggle("active", item === button));
    root.getElementById("demo-question").textContent = button.dataset.question;
    answer.textContent = "Finding the supporting passage…";
    citation.hidden = true;
    sourceText.textContent = "Retrieving the source for this question…";
    page.textContent = "Retrieving source";
    source.classList.remove("inspected");
    try {
      // Initialize the workspace cookie before sending a stateful API request.
      await request("/health");
      const result = await request("/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: button.dataset.question, demo: true }),
      });
      if (current !== requestNumber) return;
      answer.textContent = result.answer;
      const passage = result.sources[0];
      sourceText.textContent = passage
        ? passage.text
        : "No source passage found.";
      page.textContent = passage
        ? `Page ${passage.page} · source excerpt`
        : "Insufficient evidence";
      citation.hidden = !passage;
    } catch (error) {
      if (current !== requestNumber) return;
      answer.textContent = error.message;
      sourceText.textContent =
        "No source is available for this request. Try again in a moment.";
      page.textContent = "Source unavailable";
    }
  }

  buttons.forEach((button) =>
    button.addEventListener("click", () => showExample(button)),
  );
  citation.addEventListener("click", () => {
    source.classList.add("inspected");
    revealSource(source, 1100, matchMedia);
  });
  return showExample(buttons[0]);
}
