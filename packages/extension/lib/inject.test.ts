import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LookupResult } from "@drexel-rmp/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSite } from "./inject";
import { BANNER_CONFIG, TMS_CONFIG } from "./sites";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

const found = (name: string, rating: number): LookupResult => ({
  status: "found",
  rating: {
    name, rating, difficulty: 3, wouldTakeAgain: 50, numRatings: 10, legacyId: 1,
    rmpUrl: "https://www.ratemyprofessors.com/professor/1",
  },
});

/** Resolve on the next macrotask so all pending lookups settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));
const badgeTexts = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLElement>(".rmp-badge-host")].map(
    (h) => h.shadowRoot!.querySelector(".badge")!.textContent,
  );

let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; document.body.innerHTML = ""; });

describe("runSite", () => {
  it("TMS: looks up the normalized name and appends the badge inside the instructor cell", async () => {
    document.body.innerHTML = fixture("tms.html");
    const lookup = vi.fn(async (name: string) => found(name, 4.2));
    stop = runSite(TMS_CONFIG, lookup);
    await settle();
    expect(lookup).toHaveBeenCalledWith("Daniel Moix");
    const cell = document.querySelector("tr.odd > td:last-child")!;
    expect(cell.textContent).toContain("Daniel W Moix");
    expect(badgeTexts(cell)).toEqual(["★ 4.2"]);
  });

  it("Banner: places the badge before the mailto link, not inside it", async () => {
    // Banner's instructor cell is ~86px, white-space: nowrap, overflow hidden + ellipsis:
    // anything after the name is clipped, so the badge must lead the line.
    document.body.innerHTML = fixture("banner.html");
    stop = runSite(BANNER_CONFIG, async (name) => found(name, 4.4));
    await settle();
    const link = document.querySelector("a.email")!;
    expect(link.querySelector(".rmp-badge-host")).toBeNull();
    const slot = link.previousElementSibling!;
    expect(slot.className).toBe("rmp-slot");
    expect(badgeTexts(slot)).toEqual(["★ 4.4"]);
    expect(slot.lastChild!.textContent).toBe(" "); // gap between badge and name
  });

  it("TMS: puts a space before the appended badge so it can wrap in narrow cells", async () => {
    document.body.innerHTML = fixture("tms.html");
    stop = runSite(TMS_CONFIG, async (name) => found(name, 4.2));
    await settle();
    const slot = document.querySelector(".rmp-slot")!;
    expect(slot.firstChild!.nodeType).toBe(Node.TEXT_NODE);
    expect(slot.firstChild!.textContent).toBe(" ");
    expect(slot.lastElementChild!.className).toBe("rmp-badge-host");
  });

  it("keeps badges in name order even when lookups finish out of order", async () => {
    document.body.innerHTML = fixture("tms.html").replace("Daniel W Moix", "Tammy R Pirmann, Matthew J Burlick");
    const resolvers: Record<string, (r: LookupResult) => void> = {};
    const lookup = (name: string) => new Promise<LookupResult>((res) => { resolvers[name] = res; });
    stop = runSite(TMS_CONFIG, lookup);
    resolvers["Matthew Burlick"]!(found("Matthew Burlick", 3.2)); // second name finishes first
    await settle();
    resolvers["Tammy Pirmann"]!(found("Tammy Pirmann", 4.1));
    await settle();
    expect(badgeTexts(document.body)).toEqual(["★ 4.1", "★ 3.2"]);
  });

  it("shows nothing (and leaves no placeholder) when the lookup returns null or throws", async () => {
    document.body.innerHTML = fixture("tms.html").replace("Daniel W Moix", "Tammy R Pirmann, Matthew J Burlick");
    stop = runSite(TMS_CONFIG, async (name) => {
      if (name === "Tammy Pirmann") return null;
      throw new Error("background unreachable");
    });
    await settle();
    const cell = document.querySelector("tr.odd > td:last-child")!;
    expect(cell.innerHTML.trim()).toBe("Tammy R Pirmann, Matthew J Burlick");
  });

  it("skips STAFF cells without calling lookup", async () => {
    document.body.innerHTML = fixture("tms.html").replace("Daniel W Moix", "STAFF");
    const lookup = vi.fn(async () => null);
    stop = runSite(TMS_CONFIG, lookup);
    await settle();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not insert into rows the page removed while the lookup was in flight", async () => {
    document.body.innerHTML = fixture("tms.html");
    let resolve!: (r: LookupResult) => void;
    stop = runSite(TMS_CONFIG, () => new Promise((res) => { resolve = res; }));
    const row = document.querySelector("tr.odd")!;
    row.remove();
    resolve(found("Daniel Moix", 4));
    await settle();
    expect(row.querySelector(".rmp-badge-host")).toBeNull();
  });
});
