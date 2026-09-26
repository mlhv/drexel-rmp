# Learning notes — Task 18: Store listing copy and the submission runbook

## What we built

- `docs/store/listing.md`: every piece of text the Developer Dashboard asks for, ready to paste.
- `docs/store/runbook.md`: a checklist of the steps only you can do, in order.
- `docs/testing-checklist.md`: now runs twice per release, plus an "IDs match" item.

## Concept 1: Treat listing text like code

Dashboard text lives only in Google's web form, with no history and no review. Keeping the source in the repo means that when a permission changes, the PR diff shows the manifest, the listing justification and the privacy page changing *together*. Task 18's consistency check (grep for the three hosts across all three files) is a tiny version of what a store reviewer does.

## Concept 2: What reviewers actually check

- **Single purpose:** MV3 policy says an extension must do one narrow thing. Ours does: "ratings next to instructor names on Drexel pages".
- **Permission justifications:** one sentence per permission, saying *why this feature needs it*. Broad hosts (`<all_urls>`, `*.workers.dev`) trigger manual review and delays. That's why Task 14 made them exact.
- **Remote code:** MV3 forbids running code that isn't in the package. Your Worker returns JSON, which is *data*, so the honest answer is "No". An extension that fetched and `eval`'d a script would be rejected.
- **Data usage:** the instructor names the extension reads count as "website content". Declaring it, even though it's public data, is the honest and safe choice.

## Concept 3: The bootstrap chicken-and-egg

The Worker's CORS allowlist and the dev `key` both need the extension ID, but the store only assigns an ID once you upload something. The runbook breaks the loop: upload a **draft** zip (not submitted), read the ID and public key, commit them, deploy, then build the real release. Everything before that point is safe with empty values, which Tasks 14 and 19 test explicitly.

## Concept 4: Deciding "go public" in advance

The criteria (2 weeks unlisted, one registration period, no complaints) are written down *before* launch. Deciding under excitement ("it works, ship it!") or under pressure is how people skip the soak period. It's the same idea as a pre-registered experiment.
