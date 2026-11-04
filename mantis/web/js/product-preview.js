import { DEMO_PROMPTS, exampleResponse } from "./examples.js";

const buttons = [...document.querySelectorAll("[data-example]")];
const question = document.getElementById("preview-question");
const answer = document.getElementById("preview-answer");
const photo = document.getElementById("preview-photo");
const source = document.getElementById("preview-source");
const sourceTitle = document.getElementById("preview-source-title");
const sourceText = document.getElementById("preview-source-text");

function showExample(key) {
  const result = exampleResponse(
    DEMO_PROMPTS[key],
    key === "alarm" ? "sample" : null,
  );
  buttons.forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.example === key)),
  );
  question.textContent = DEMO_PROMPTS[key];
  answer.textContent = result.answer;
  photo.hidden = key !== "alarm";
  if (key === "alarm") photo.src = "/static/assets/demo-alarm.svg";
  else photo.removeAttribute("src");
  // Switching examples cannot retain the previous example's open source.
  source.open = false;
  const passage = result.sources[0];
  source.hidden = !passage;
  sourceTitle.textContent = passage
    ? `${passage.name} · p. ${passage.page}`
    : "";
  sourceText.textContent = passage?.text || "";
}
buttons.forEach((button) =>
  button.addEventListener("click", () => showExample(button.dataset.example)),
);
showExample("spindle");
