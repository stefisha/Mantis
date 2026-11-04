import { DEMO_PROMPTS, exampleResponse } from "./examples.js";

const thread = document.getElementById("preview-thread");
function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}
function addExample(key) {
  const result = exampleResponse(
    DEMO_PROMPTS[key],
    key === "alarm" ? "sample" : null,
  );
  const user = node("article", "preview-user");
  const userBubble = node("div", "preview-user-bubble");
  if (key === "alarm") {
    const photo = node("img", "preview-photo");
    photo.src = "/static/assets/demo-alarm.svg";
    photo.alt = "Illustrative CNC alarm screen";
    userBubble.append(photo);
  }
  userBubble.append(node("p", "", DEMO_PROMPTS[key]));
  user.append(node("span", "preview-author", "YOU"), userBubble);

  const assistant = node("article", "preview-assistant");
  const author = node("span", "preview-author");
  const mark = node("span", "tiny-mark");
  const logo = node("img");
  logo.src = "/static/assets/mantis-mark.png";
  logo.alt = "";
  mark.append(logo);
  author.append(mark, node("span", "", "MANTIS"));
  const bubble = node("div", "preview-answer");
  bubble.append(node("p", "", result.answer));
  for (const passage of result.sources) {
    const details = node("details", "preview-source");
    details.append(
      node("summary", "", `${passage.name} · p. ${passage.page}`),
      node("p", "", passage.text),
      node(
        "small",
        "",
        "Illustrative example · not an equipment service procedure.",
      ),
    );
    bubble.append(details);
  }
  assistant.append(author, bubble);
  // A single transcript: keep earlier questions, replies, and their own sources.
  thread.append(user, assistant);
  thread.scrollTop = thread.scrollHeight;
}
document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => addExample(button.dataset.example));
});
addExample("spindle");
