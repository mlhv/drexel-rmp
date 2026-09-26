# Chrome Web Store listing — DU ProfessorView

Paste these into the Developer Dashboard. Keep in sync with `site/privacy.html`
and `packages/extension/lib/manifest.ts`: any change to data handled or
permissions updates this file in the same PR.

## Store listing tab

**Name:** DU ProfessorView (from the manifest)

**Short description (manifest `description`, ≤132 chars):**
Professor ratings on Drexel's Term Master Schedule and Banner registration (unofficial).

**Detailed description:**

See Rate My Professors ratings right next to instructor names while you browse
Drexel's Term Master Schedule and register for classes in Banner.

• A color-coded ★ badge next to each instructor
• Hover for difficulty, would-take-again %, and number of ratings
• One click to the professor's full Rate My Professors page
• Multi-instructor sections get one badge per instructor
• If no confident match exists, you see "n/a" — never the wrong professor's rating

Privacy: the extension only reads instructor names on Drexel course pages to look
up their public ratings. No login data, no schedule, no browsing history, no
analytics. Full policy: https://mlhv.github.io/drexel-rmp/privacy.html

Open source: https://github.com/mlhv/drexel-rmp

Not affiliated with or endorsed by Drexel University or Rate My Professors.

**Category:** Education
**Language:** English

## Privacy practices tab

**Single purpose:**
Displays Rate My Professors ratings next to instructor names on Drexel's course
schedule and registration pages.

**Permission justifications:**
- `storage`: Caches rating lookups locally so the same professor isn't looked up again on every page load.
- Host `https://*.drexel.edu/*`: Reads instructor names on Drexel's Term Master Schedule and Banner registration pages to place rating badges next to them.
- Host `https://www.ratemyprofessors.com/*`: Fetches public professor ratings.
- Host `https://drexel-rmp-worker.mlhv.workers.dev/*`: The extension's own cache service for professor ratings, which reduces requests to Rate My Professors.

**Remote code:** No, I am not using remote code. (The cache service returns JSON data only; all executable code ships in the package.)

**Data usage — collected types:** Website content (instructor names read from Drexel course pages). No other category.

**Certifications (check all three):**
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://mlhv.github.io/drexel-rmp/privacy.html

## Distribution tab

**Visibility:** Unlisted (switch to Public per `runbook.md` go-public criteria)
**Regions:** All regions

## Assets

- Store icon: 128×128 — `packages/extension/.output/chrome-mv3/icons/128.png` after a production build
- Screenshots: ≥1 at 1280×800, captured by you from logged-in TMS/Banner pages; crop out your name, schedule, and anything personal
- Small promo tile 440×280: only if the dashboard requires it — the icon centered on a `#0F766E` background
