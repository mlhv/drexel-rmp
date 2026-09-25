import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import type { ProfessorRating } from "@drexel-rmp/shared";

/** Grace period so the pointer can cross from the badge onto the tooltip (and its link). */
const HIDE_DELAY_MS = 150;

function row(label: string, value: string): HTMLElement {
  const div = document.createElement("div");
  div.className = "tip-row";
  const b = document.createElement("b");
  b.textContent = value;
  div.append(`${label}: `, b);
  return div;
}

function buildTooltip(rating: ProfessorRating): HTMLElement {
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.style.visibility = "hidden"; // revealed once positioned, so it never flashes at (0,0)

  const name = document.createElement("div");
  name.className = "tip-name";
  name.textContent = rating.name; // textContent: name is external data

  const count = document.createElement("div");
  count.className = "tip-row";
  count.textContent = `${rating.numRatings} rating${rating.numRatings === 1 ? "" : "s"}`;

  const link = document.createElement("a");
  link.className = "tip-link";
  link.target = "_blank";
  link.rel = "noopener";
  link.href = rating.rmpUrl;
  link.textContent = "View on Rate My Professors →";

  tip.append(
    name,
    row("Quality", `${rating.rating.toFixed(1)} / 5`),
    row("Difficulty", `${rating.difficulty.toFixed(1)} / 5`),
    row("Would take again", rating.wouldTakeAgain === null ? "—" : `${rating.wouldTakeAgain}%`),
    count,
    link,
  );
  return tip;
}

/**
 * Hover/focus card for a found rating, rendered inside the badge's shadow root.
 * Opens on `anchor` hover or `focusTarget` focus; stays open while the pointer is over it.
 */
export function attachTooltip(
  shadow: ShadowRoot,
  anchor: HTMLElement,
  focusTarget: HTMLElement,
  rating: ProfessorRating,
): void {
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelHide = () => clearTimeout(hideTimer);
  const scheduleHide = () => {
    cancelHide();
    hideTimer = setTimeout(() => shadow.querySelector(".tooltip")?.remove(), HIDE_DELAY_MS);
  };

  const show = () => {
    cancelHide();
    if (shadow.querySelector(".tooltip")) return;
    const tip = buildTooltip(rating);
    tip.addEventListener("mouseenter", cancelHide);
    tip.addEventListener("mouseleave", scheduleHide);
    shadow.appendChild(tip);
    // "fixed" escapes overflow:hidden table cells on the host page.
    computePosition(anchor, tip, {
      strategy: "fixed",
      placement: "top",
      middleware: [offset(6), flip(), shift({ padding: 4 })],
    })
      .then(({ x, y }) => {
        tip.style.left = `${x}px`;
        tip.style.top = `${y}px`;
        tip.style.visibility = "visible";
      })
      .catch(() => tip.remove()); // never let a positioning error escape onto the host page
  };

  anchor.addEventListener("mouseenter", show);
  anchor.addEventListener("mouseleave", scheduleHide);
  focusTarget.addEventListener("focus", show);
  focusTarget.addEventListener("blur", scheduleHide);
}
