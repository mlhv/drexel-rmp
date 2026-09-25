import type { LookupResult } from "@drexel-rmp/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBadge } from "./badge";

const rating = (r: number, name = "Jeffrey Popyack"): LookupResult => ({
  status: "found",
  rating: {
    name, rating: r, difficulty: 3.6, wouldTakeAgain: 43,
    numRatings: 28, legacyId: 565937,
    rmpUrl: "https://www.ratemyprofessors.com/professor/565937",
  },
});

function badgeEl(result: LookupResult) {
  const host = createBadge(result, "Jeffrey Popyack");
  document.body.appendChild(host);
  const shadow = host.shadowRoot!;
  const badge = shadow.querySelector<HTMLElement>(".badge")!;
  const tooltip = () => shadow.querySelector<HTMLElement>(".tooltip");
  return { host, shadow, badge, tooltip };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("createBadge", () => {
  it("renders the rating in a shadow root with a link to the professor's RMP page", () => {
    const { host, badge } = badgeEl(rating(4.2));
    expect(host.shadowRoot).not.toBeNull();
    expect(badge.textContent).toContain("4.2");
    const link = host.shadowRoot!.querySelector("a")!;
    expect(link.href).toBe("https://www.ratemyprofessors.com/professor/565937");
    expect(link.target).toBe("_blank");
  });

  it.each([
    [4.2, "good"],
    [3.96, "good"], // displays as "4.0", so it must be colored as 4.0
    [3.1, "ok"],
    [2.3, "bad"],
  ])("rating %f gets tier class %s", (r, tier) => {
    const { badge } = badgeEl(rating(r));
    expect(badge.classList.contains(tier)).toBe(true);
  });

  it("renders n/a linking to an RMP search for not_found", () => {
    const { host, badge } = badgeEl({ status: "not_found" });
    expect(badge.textContent).toContain("n/a");
    expect(badge.classList.contains("none")).toBe(true);
    const link = host.shadowRoot!.querySelector("a")!;
    expect(link.href).toContain("/search/professors/1521");
    expect(link.href).toContain("q=Jeffrey");
  });
});

describe("tooltip", () => {
  it("shows details on mouseenter and hides shortly after mouseleave", () => {
    vi.useFakeTimers();
    const { badge, tooltip } = badgeEl(rating(4.2));
    badge.dispatchEvent(new Event("mouseenter"));
    const text = tooltip()!.textContent!;
    expect(text).toContain("Difficulty");
    expect(text).toContain("3.6");
    expect(text).toContain("43%");
    expect(text).toContain("28");
    badge.dispatchEvent(new Event("mouseleave"));
    expect(tooltip()).not.toBeNull(); // grace period to reach the tooltip
    vi.advanceTimersByTime(500);
    expect(tooltip()).toBeNull();
  });

  it("stays open while the pointer is over the tooltip so its link is clickable", () => {
    vi.useFakeTimers();
    const { badge, tooltip } = badgeEl(rating(4.2));
    badge.dispatchEvent(new Event("mouseenter"));
    badge.dispatchEvent(new Event("mouseleave"));
    tooltip()!.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(500);
    expect(tooltip()).not.toBeNull();
    expect(tooltip()!.querySelector("a")!.href).toBe("https://www.ratemyprofessors.com/professor/565937");
    tooltip()!.dispatchEvent(new Event("mouseleave"));
    vi.advanceTimersByTime(500);
    expect(tooltip()).toBeNull();
  });

  it("opens on keyboard focus and closes on blur", () => {
    vi.useFakeTimers();
    const { shadow, tooltip } = badgeEl(rating(4.2));
    const link = shadow.querySelector("a")!;
    link.dispatchEvent(new Event("focus"));
    expect(tooltip()).not.toBeNull();
    link.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(500);
    expect(tooltip()).toBeNull();
  });

  it("never renders more than one tooltip", () => {
    const { badge, shadow } = badgeEl(rating(4.2));
    badge.dispatchEvent(new Event("mouseenter"));
    badge.dispatchEvent(new Event("mouseenter"));
    expect(shadow.querySelectorAll(".tooltip")).toHaveLength(1);
  });

  it("renders the professor name as text, not HTML", () => {
    const { badge, tooltip } = badgeEl(rating(4.2, '<img src=x onerror="alert(1)">'));
    badge.dispatchEvent(new Event("mouseenter"));
    expect(tooltip()!.querySelector("img")).toBeNull();
    expect(tooltip()!.textContent).toContain("<img");
  });

  it("has no tooltip for not_found badges", () => {
    const { badge, tooltip } = badgeEl({ status: "not_found" });
    badge.dispatchEvent(new Event("mouseenter"));
    expect(tooltip()).toBeNull();
  });
});
