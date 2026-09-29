# Chrome Web Store submission runbook

Steps only you can do (accounts, login, deploys). Work top to bottom; check items off.

## 1. One-time accounts
- [ ] Register a Chrome Web Store developer account at https://chrome.google.com/webstore/devconsole ($5 one-time; 2-step verification required on the Google account).
- [ ] GitHub repo → Settings → Pages → Build and deployment → Source: **GitHub Actions**. Then Actions → Pages → Run workflow (or push a change under `site/`).
- [ ] Confirm https://mlhv.github.io/drexel-rmp/privacy.html loads.

## 2. Bootstrap the extension ID
The store assigns the ID on first upload. Dev builds and the Worker CORS allowlist need it.
- [ ] `pnpm -F @drexel-rmp/extension zip`
- [ ] Dashboard → New item → upload `packages/extension/.output/du-professorview-1.0.0-chrome.zip`. Do **not** submit; leave it as a draft.
- [ ] Copy the item ID (32 letters, shown on the item page).
- [ ] Item → Package → "View public key". Copy the key body (between the BEGIN/END lines, joined into one line).
- [ ] Paste the key into `EXTENSION_PUBLIC_KEY` in `packages/extension/lib/manifest.ts`.
- [ ] Set `ALLOWED_ORIGIN = "chrome-extension://<item id>"` in `packages/worker/wrangler.toml`.
- [ ] `pnpm test`, then commit: `chore: record Chrome Web Store extension ID`.
- [ ] `pnpm -F @drexel-rmp/worker run deploy`.
- [ ] `pnpm -F @drexel-rmp/extension exec wxt build --mode development`, load `packages/extension/.output/chrome-mv3-dev` unpacked, and confirm chrome://extensions shows the same ID as the store item.
- [ ] Remove that unpacked dev copy (two installs with one ID conflict).

## 3. Pre-release check
The step 2 dev copy only proved the ID; this step tests the build you will actually ship.
- [ ] `pnpm -F @drexel-rmp/extension build`, then chrome://extensions → Load unpacked → `packages/extension/.output/chrome-mv3` (note: no `-dev`).
      Its ID will differ from the store ID. That's expected: the production manifest has no `key`, and the extension's own requests don't depend on the ID.
- [ ] Run `docs/testing-checklist.md` against it.
- [ ] Remove this unpacked copy when done (before installing from the store later).

## 4. Release and submit
- [ ] Confirm `packages/extension/package.json` version is `1.0.0`.
- [ ] `git push && git tag v1.0.0 && git push origin v1.0.0`
- [ ] Wait for the Release workflow; download `du-professorview-1.0.0-chrome.zip` from the GitHub Release.
- [ ] Dashboard → the draft item → Package → upload the Release zip (replacing the bootstrap draft).
- [ ] Fill every tab from `docs/store/listing.md`; upload screenshots.
- [ ] Distribution → Visibility: **Unlisted**.
- [ ] Submit for review.

## 5. After approval
- [ ] Install from the store link; run `docs/testing-checklist.md` against the store install.
- [ ] Replace the "Add to Chrome" `href` in `site/index.html` with the store URL; optionally save a screenshot as `site/screenshot.png` and add it below the sample row; commit and push.

## 6. Go public (criteria decided in advance)
All must hold:
- [ ] ≥2 weeks unlisted without breakages
- [ ] Used through at least one real registration period
- [ ] No issues raised by Rate My Professors or Drexel

Then Distribution → Visibility: **Public**. Check at the time whether a visibility-only change triggers a new review.

## Later releases
Bump `packages/extension/package.json` version → commit → `git tag vX.Y.Z && git push origin vX.Y.Z` → upload the Release zip → submit.
