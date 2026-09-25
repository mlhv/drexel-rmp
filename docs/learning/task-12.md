# Learning notes — Task 12: Finding instructor names on real pages

## What we built

- `lib/fixtures/banner.html`, `lib/fixtures/tms.html`: real rows copied from the live sites (the pages are behind Drexel login, so tests can't fetch them).
- `lib/sites.ts`: one `SiteConfig` per site: which URLs, which elements hold names, and where the badge goes.
- `lib/scanner.ts`: `startScanner(config, onInstructor)` finds those elements now *and* whenever the page changes, calling back exactly once per element.

8 tests; 69 in the extension.

## Concept 1: Fixtures beat guesses

The plan guessed both sites' markup. The real HTML proved almost every guess wrong:

| Plan's guess | Reality |
|---|---|
| Banner URL `…/StudentRegistrationSsb/*` | `banner.drexel.edu/registration/ssb/*` |
| Names like `Popyack, Jeffrey L` | `Drew Parkinson`, `Daniel W Moix` (First Last) |
| TMS cell `td.instructor` | a plain `<td>` with no class at all |
| Multiple instructors separated by `;` | Banner uses separate links split by `<br>` |

Code written against the guesses would have passed its own tests and matched *nothing* on the real sites. That's why the plan said "do not fabricate fixtures": a test is only as true as its inputs. Committing a real snapshot also makes the tests **repeatable without a login**, and when Drexel changes its HTML, you re-capture the fixture and the failing test shows exactly what moved.

## Concept 2: Choosing a selector is choosing what you depend on

A CSS selector is a bet on which parts of someone else's HTML will stay stable.

**Banner:** `td[data-property="instructor"] a.email`. `data-property` is a *semantic* attribute (it names what the cell means), so it's likely to stay stable. It's much safer than "the 8th column". Selecting each `a.email` link instead of the whole cell means each element holds exactly one name. Reading the whole cell's text would give `"Drew Parkinson (Primary) "`, and with two instructors, `"A (Primary) B"` glued together, which no parser can safely split.

**TMS:** no class, no data attribute. The only signal is *position*: `tr.odd > td:last-child, tr.even > td:last-child`. Two subtleties:

- `>` means *direct* child. Each row contains a nested day/time table whose rows also end in a `<td>` (the time). Without `>`, "11:00 am - 12:50 pm" would be looked up as a professor.
- Only *course* rows have `odd`/`even`; the nested rows don't. That's what excludes them, and a test asserts the fixture yields exactly `["Daniel W Moix"]`.

Positional selectors are the most fragile kind, which is why the reasoning is written in the `sites.ts` doc comments.

## Concept 3: Where the badge goes matters

The Banner name is a `mailto:` link. Putting the badge *inside* it would nest one link in another: clicking the badge could open RMP **and** your email client. So `SiteConfig` gained `badgePlacement`: `"after"` for Banner (a sibling of the link), `"append"` for TMS (inside the cell; putting it *after* a `<td>` would add a stray node into the table row). Task 13's injection code reads this field.

## Concept 4: MutationObserver, watching a page that keeps changing

Both sites render results with JavaScript: Banner loads rows after you search, and paginating replaces them. A one-time scan at load would find nothing. `MutationObserver` calls us back when the DOM changes:

```ts
observer.observe(document.body, {
  childList: true, subtree: true,          // nodes added/removed anywhere
  attributes: true, attributeFilter: ["class"], // plus class changes
});
```

Three techniques make this safe on a busy page:

- **Debounce (200ms):** a table render can fire hundreds of mutations. Each one resets a timer, so only one scan runs once things settle.
- **Idempotency marker:** each handled element gets `data-rmp-processed`, and rescans skip it. That's also why our own badge insertions (which are mutations too) don't cause a loop: the rescan finds nothing new and stops.
- **`attributeFilter: ["class"]`:** TMS rows likely get `odd`/`even` from a table plugin *after* they're inserted. A plain `childList` observer would never see that change. Watching only `class` keeps the noise down (it ignores our own `data-rmp-processed` writes, for example). A test proves it's needed: removing those two lines makes "picks up TMS rows once the table plugin adds their odd/even class" fail.

## Concept 5: Contain your failures

The callback runs inside `try/catch`, and a test makes it throw on every element and checks that the scanner still visits all of them. On someone else's page, one bad row must not stop the badges for the others, and an exception must not surface in Drexel's console.

## Open questions this surfaced

- **TMS multi-instructor format is unknown.** If TMS joins names with a comma, the normalizer would read it as "Last, First" and produce nonsense. The matcher would then reject it (showing n/a, not a wrong rating). Check it during Task 13's manual test.
- **Middle names:** both sites use First-Last order, so a full middle name ("Mary Anne Smith") becomes part of the last name and fails to match RMP's "Mary Smith". The fix belongs in the shared matcher, and would need a Worker redeploy.
- **Nicknames:** "Drew" vs the email's "andrew". This case still passes the matcher (~0.87), but the email is a possible extra signal later.

### Update: the TMS multi-instructor format (resolved)

A real cell showed TMS joins instructors with commas: `Tammy R Pirmann, Matthew J Burlick`. The normalizer treats a comma as "Last, First", so this became **"Matthew Tammy Pirmann"**, one made-up person. The fix is about *order of operations*: split into names **first** (on the site's separator), then normalize each piece. Since the separator is a property of the site, not of names in general, it lives in `SiteConfig.nameSeparator` (`","` for TMS, `";"` for Banner), and `parseInstructorCell(text, separator)` takes it as a parameter, defaulting to `";"` so earlier callers and tests are unchanged.

Takeaway: the same character can mean different things in different sources, and a comma is the classic case (CSV, "Last, First", lists). Put knowledge that belongs to one source in that source's config, not in shared code.
