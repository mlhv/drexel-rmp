# Manual E2E checklist (run before each release)

Setup: `pnpm -F @drexel-rmp/extension build`, then chrome://extensions →
Developer mode → Load unpacked → `packages/extension/.output/chrome-mv3`.
After a rebuild, click the reload icon on the extension card and refresh the Drexel tab.

Debugging: chrome://extensions → the extension's "service worker" link opens the
background console (Network tab shows Worker/RMP requests).

- [ ] Term Master Schedule (e.g. `webtms_du/courseList/CS`): ★ badges appear next to instructors
- [ ] Banner (Browse Classes): search a subject → badges appear after each instructor name, before "(Primary)"
- [ ] Banner: go to the next results page → badges appear on the new rows too
- [ ] Clicking a Banner badge opens RMP only (no email client from the mailto link)
- [ ] Badge color: green ≥ 4.0, yellow ≥ 3.0, red < 3.0, gray n/a for unmatched
- [ ] Spot-check 3 professors: badge rating matches their actual RMP page (click through)
- [ ] Tooltip on hover: quality, difficulty, would-take-again %, count; its RMP link is clickable
- [ ] Tooltip isn't clipped by the table and doesn't flash in the page corner
- [ ] Tab to a badge with the keyboard → tooltip opens
- [ ] n/a badge links to an RMP search for that name; its hover text names the professor
- [ ] Multi-instructor TMS section (e.g. "Tammy R Pirmann, Matthew J Burlick") shows one badge per instructor, in name order
- [ ] STAFF/TBD sections show no badge
- [ ] Reload the page: badges reappear fast (local cache — service worker Network tab
      shows no Worker/RMP requests for repeated names)
- [ ] Kill switch drill: `WXT_WORKER_URL=https://nonexistent.invalid pnpm -F @drexel-rmp/extension build`,
      reload the extension → badges still appear (direct RMP fallback). Rebuild normally after.
- [ ] No layout breakage or console errors injected into either Drexel page
