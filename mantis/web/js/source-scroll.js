/** Reveal a docked inspector only when its responsive layout puts it below chat. */
export function revealSource(
  element,
  breakpoint,
  matchMedia = (query) => window.matchMedia(query),
) {
  if (!matchMedia(`(max-width: ${breakpoint}px)`).matches) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({
    behavior: reduced ? "auto" : "smooth",
    block: "center",
  });
}
