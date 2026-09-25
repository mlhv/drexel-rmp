import { DREXEL_LEGACY_SCHOOL_ID, type LookupResult } from "@drexel-rmp/shared";
import { attachTooltip } from "./tooltip";

const STYLES = `
  :host { all: initial; }
  .badge {
    display: inline-block; padding: 1px 6px;
    border-radius: 9px; font: 600 11px/1.5 system-ui, sans-serif;
    cursor: pointer; vertical-align: middle; white-space: nowrap;
  }
  .good { background: #dcf5dc; color: #146c2e; }
  .ok   { background: #fff3cd; color: #8a6d00; }
  .bad  { background: #fde2e1; color: #a12622; }
  .none { background: #ececec; color: #666; font-weight: 400; }
  a { text-decoration: none; color: inherit; }
  .tooltip {
    position: fixed; z-index: 2147483647; width: max-content; max-width: 260px;
    background: #1f1f1f; color: #f5f5f5; border-radius: 8px; padding: 10px 12px;
    font: 400 12px/1.6 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.25);
  }
  .tip-name { font-weight: 700; margin-bottom: 4px; }
  .tip-link { display: block; margin-top: 6px; color: #8ab4f8; }
`;

/** Tier from the value as displayed (1 decimal), so a shown "4.0" is never colored as 3.x. */
function tierClass(displayed: number): string {
  if (displayed >= 4) return "good";
  if (displayed >= 3) return "ok";
  return "bad";
}

/** Badge host element (shadow DOM) to append after an instructor name. */
export function createBadge(result: LookupResult, queriedName: string): HTMLElement {
  const host = document.createElement("span");
  host.className = "rmp-badge-host";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLES;
  shadow.appendChild(style);

  const link = document.createElement("a");
  link.target = "_blank";
  link.rel = "noopener";
  const badge = document.createElement("span");

  if (result.status === "found") {
    const { rating } = result;
    const displayed = Math.round(rating.rating * 10) / 10;
    badge.className = `badge ${tierClass(displayed)}`;
    badge.textContent = `★ ${displayed.toFixed(1)}`;
    link.href = rating.rmpUrl;
    link.setAttribute("aria-label", `Rate My Professors: ${displayed.toFixed(1)} out of 5`);
    attachTooltip(shadow, badge, link, rating);
  } else {
    badge.className = "badge none";
    badge.textContent = "n/a";
    badge.title = `No confident Rate My Professors match for ${queriedName}`;
    const search = new URL(`https://www.ratemyprofessors.com/search/professors/${DREXEL_LEGACY_SCHOOL_ID}`);
    search.searchParams.set("q", queriedName);
    link.href = search.toString();
  }

  link.appendChild(badge);
  shadow.appendChild(link);
  return host;
}
