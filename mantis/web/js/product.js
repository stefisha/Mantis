import { api } from "./api.js";
const buttons = [...document.querySelectorAll("[data-question]")];
let requestNumber = 0;
async function showExample(button) {
  const current = ++requestNumber;
  buttons.forEach((item) => item.classList.toggle("active", item === button));
  document.getElementById("demo-question").textContent =
    button.dataset.question;
  document.getElementById("demo-answer").textContent =
    "Finding the supporting passage…";
  document.getElementById("demo-citation").hidden = true;
  try {
    // Initialize the opaque workspace cookie before sending a stateful API request.
    await api("/health");
    const result = await api("/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: button.dataset.question, demo: true }),
    });
    if (current !== requestNumber) return;
    document.getElementById("demo-answer").textContent = result.answer;
    const source = result.sources[0];
    document.getElementById("demo-source-text").textContent = source
      ? source.text
      : "No source passage found.";
    document.getElementById("demo-page").textContent = source
      ? `Page ${source.page} · source excerpt`
      : "Insufficient evidence";
    document.getElementById("demo-citation").hidden = !source;
  } catch (error) {
    if (current !== requestNumber) return;
    document.getElementById("demo-answer").textContent = error.message;
  }
}
buttons.forEach((button) =>
  button.addEventListener("click", () => showExample(button)),
);
document.getElementById("demo-citation").addEventListener("click", () => {
  const source = document.getElementById("demo-source");
  source.classList.add("inspected");
  if (innerWidth < 900)
    source.scrollIntoView({ behavior: "smooth", block: "center" });
});
showExample(buttons[0]);
