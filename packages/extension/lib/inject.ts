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
  return startScanner(config, (el, rawText) => {
    let previous: Element = el;
    for (const name of parseInstructorCell(rawText, config.nameSeparator)) {
      const slot = document.createElement("span");
      slot.className = "rmp-slot";
      if (config.badgePlacement === "append") {
        el.appendChild(slot);
      } else {
        previous.after(slot);
        previous = slot;
      }
      void fillSlot(slot, name, lookup);
    }
  });
}

async function fillSlot(slot: HTMLElement, name: string, lookup: LookupFn): Promise<void> {
  try {
    const result = await lookup(name);
    if (result && slot.isConnected) {
      slot.appendChild(createBadge(result, name));
      return;
    }
  } catch {
    // background unreachable (e.g. extension reloading) — silently skip
  }
  slot.remove();
}
