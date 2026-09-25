import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseInstructorCell } from "./names";
import { startScanner } from "./scanner";
import { BANNER_CONFIG, TMS_CONFIG } from "./sites";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name), "utf8");

/** The single <tr> from a fixture, for inserting into an empty table later. */
const fixtureRow = (name: string) => fixture(name).match(/<tr[\s\S]*<\/tr>/)![0];

const afterDebounce = () => new Promise((r) => setTimeout(r, 300));

let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; document.body.innerHTML = ""; });

function collect(config = TMS_CONFIG) {
  const seen: string[] = [];
  const els: HTMLElement[] = [];
  stop = startScanner(config, (el, text) => { seen.push(text); els.push(el); });
  return { seen, els };
}

describe("startScanner", () => {
  it("finds exactly the instructor cell in the TMS fixture (not the nested day/time table)", () => {
    document.body.innerHTML = fixture("tms.html");
    expect(collect(TMS_CONFIG).seen).toEqual(["Daniel W Moix"]);
  });

  it("finds each instructor link in the Banner fixture, without the (Primary) marker", () => {
    document.body.innerHTML = fixture("banner.html");
    const { seen, els } = collect(BANNER_CONFIG);
    expect(seen).toEqual(["Drew Parkinson"]);
    expect(els[0]!.tagName).toBe("A");
  });

  it("fixture names normalize to lookup names with each site's separator", () => {
    expect(parseInstructorCell("Daniel W Moix", TMS_CONFIG.nameSeparator)).toEqual(["Daniel Moix"]);
    expect(parseInstructorCell("Drew Parkinson", BANNER_CONFIG.nameSeparator)).toEqual(["Drew Parkinson"]);
    // Real TMS multi-instructor cell, captured 2026-09-24
    expect(parseInstructorCell("Tammy R Pirmann, Matthew J Burlick", TMS_CONFIG.nameSeparator))
      .toEqual(["Tammy Pirmann", "Matthew Burlick"]);
  });

  it("never fires twice for the same element", async () => {
    document.body.innerHTML = fixture("tms.html");
    const { seen } = collect();
    document.body.appendChild(document.createElement("div")); // trigger a mutation
    await afterDebounce();
    expect(seen).toEqual(["Daniel W Moix"]);
  });

  it("picks up dynamically added rows", async () => {
    document.body.innerHTML = "<table><tbody id='t'></tbody></table>";
    const { seen } = collect(BANNER_CONFIG);
    document.getElementById("t")!.innerHTML = fixtureRow("banner.html");
    await afterDebounce();
    expect(seen).toEqual(["Drew Parkinson"]);
  });

  it("picks up TMS rows once the table plugin adds their odd/even class", async () => {
    document.body.innerHTML = fixture("tms.html").replace('class="odd" role="row"', "");
    const { seen } = collect();
    expect(seen).toEqual([]);
    document.querySelector("tr")!.className = "odd";
    await afterDebounce();
    expect(seen).toEqual(["Daniel W Moix"]);
  });

  it("keeps scanning other elements when the callback throws", () => {
    document.body.innerHTML = fixture("tms.html") + fixture("tms.html");
    let calls = 0;
    stop = startScanner(TMS_CONFIG, () => { calls++; throw new Error("boom"); });
    expect(calls).toBe(2);
  });

  it("stops observing after the stop function is called", async () => {
    document.body.innerHTML = "<table><tbody id='t'></tbody></table>";
    const { seen } = collect(BANNER_CONFIG);
    stop!();
    document.getElementById("t")!.innerHTML = fixtureRow("banner.html");
    await afterDebounce();
    expect(seen).toEqual([]);
  });
});
