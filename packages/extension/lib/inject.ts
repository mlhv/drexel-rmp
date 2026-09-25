import type { LookupResult } from "@drexel-rmp/shared";
import { browser } from "wxt/browser";
import { createBadge } from "@/components/badge";
import { parseInstructorCell } from "@/lib/names";
import { startScanner } from "@/lib/scanner";
import type { SiteConfig } from "@/lib/sites";

export type LookupFn = (name: string) => Promise<LookupResult | null>;

/** Ask the background service worker (Task 10's message protocol). */
const lookupViaBackground: LookupFn = async (name) =>
  (await browser.runtime.sendMessage({ type: "LOOKUP_PROFESSOR", name })) as LookupResult | null;

/**
 * Wire scanner -> name parsing -> lookup -> badge injection for one site. Returns a stop function.
 * Each name gets an empty slot synchronously, in name order, so badges line up with names
 * no matter which lookup finishes first.
 */
export function runSite(config: SiteConfig, lookup: LookupFn = lookupViaBackground): () => void {
  const before = config.badgePlacement === "before";
  return startScanner(config, (el, rawText) => {
    for (const name of parseInstructorCell(rawText, config.nameSeparator)) {
      const slot = document.createElement("span");
      slot.className = "rmp-slot";
      // el.before() repeatedly still yields name order: each slot lands after the previous one.
      if (before) el.before(slot);
      else el.appendChild(slot);
      void fillSlot(slot, name, lookup, before);
    }
  });
}

async function fillSlot(slot: HTMLElement, name: string, lookup: LookupFn, before: boolean): Promise<void> {
  try {
    const result = await lookup(name);
    if (result && slot.isConnected) {
      const badge = createBadge(result, name);
      // The space separates badge from name; when appended it is also a line-break
      // opportunity, so the badge wraps in narrow cells instead of being clipped.
      if (before) slot.append(badge, " ");
      else slot.append(" ", badge);
      return;
    }
  } catch {
    // background unreachable (e.g. extension reloading) — silently skip
  }
  slot.remove();
}
