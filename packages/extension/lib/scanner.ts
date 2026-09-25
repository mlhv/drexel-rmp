import type { SiteConfig } from "./sites";

const PROCESSED_ATTR = "data-rmp-processed";
const DEBOUNCE_MS = 200;

/**
 * Scan now and on future DOM mutations for instructor elements.
 * Fires onInstructor exactly once per element; returns a stop function.
 */
export function startScanner(
  config: SiteConfig,
  onInstructor: (el: HTMLElement, rawText: string) => void,
): () => void {
  const scan = () => {
    for (const el of document.querySelectorAll<HTMLElement>(config.instructorSelector)) {
      if (el.hasAttribute(PROCESSED_ATTR)) continue;
      el.setAttribute(PROCESSED_ATTR, "1");
      const text = el.textContent?.trim();
      if (text) {
        try {
          onInstructor(el, text);
        } catch {
          // never let our errors escape into the host page
        }
      }
    }
  };

  scan();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, DEBOUNCE_MS);
  });
  // Class changes too: TMS rows only match once the table plugin adds odd/even.
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  return () => {
    clearTimeout(timer);
    observer.disconnect();
  };
}
