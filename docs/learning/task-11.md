# Learning notes — Task 11: The badge and tooltip (UI on someone else's page)

## What we built

```
Jeffrey Popyack [★ 2.3]      ← badge: color by tier, links to the RMP profile
                   │ hover or keyboard focus
                   ▼
        ┌──────────────────────────┐
        │ Jeffrey Popyack          │
        │ Quality: 2.3 / 5         │
        │ Difficulty: 3.6 / 5      │
        │ Would take again: 43%    │
        │ 28 ratings               │
        │ View on Rate My Profs →  │
        └──────────────────────────┘

Unknown Person  [n/a]        ← gray, links to an RMP search, no tooltip
```

`components/badge.ts` (`createBadge(result, queriedName)` → a `<span>` ready to drop next to a name) and `components/tooltip.ts` (`attachTooltip`). 12 tests; 61 in the extension.

## Concept 1: Shadow DOM, a style firewall

A content script's elements live inside Drexel's page, so Drexel's CSS applies to them. A rule like `span { font-size: 18px }` or `a { color: blue }` would mangle the badge. And the badge's own CSS (`.badge`, `.good`) could leak out and restyle Drexel's elements if they share a class name.

`host.attachShadow({ mode: "open" })` creates a separate DOM subtree whose styles are scoped in **both directions**: page CSS doesn't match elements inside it, and the `<style>` inside only applies inside. The page just sees one `<span class="rmp-badge-host">`.

One leak remains: *inherited* properties (font, color, line-height) still flow from the parent element into the shadow tree. That's what `:host { all: initial; }` is for. It resets every property on the host element, so the badge starts from browser defaults no matter what Drexel's table cell has set.

## Concept 2: Never build HTML from external data with `innerHTML`

The professor's name comes from RMP. If anything in the chain (RMP, our Worker, a corrupted cache) ever produced a "name" like `<img src=x onerror="...">`, then `innerHTML` would *execute* it, running inside the content script on a page where the student is logged into Drexel. That's **cross-site scripting (XSS)**.

The plan's tooltip used `innerHTML` for the layout and patched only the name with `textContent`. That was safe as written, but fragile: the next person to add a field to the template might forget. The tooltip is now built entirely with `createElement` + `textContent`/`append`, so there's no HTML parsing at all, and a test feeds in an `<img onerror>` name and asserts no `<img>` element appears. Safe by construction beats safe by carefulness.

## Concept 3: The hover gap problem

The plan hid the tooltip on the badge's `mouseleave`. But the tooltip sits 6px above the badge and contains a link. To click it, the pointer has to *leave* the badge, which instantly deleted the tooltip. The link was unreachable.

The standard fix (used by every dropdown menu) is a **hide delay with cancellation**:

```
leave badge ──▶ schedule hide in 150ms
enter tooltip ─▶ cancel the scheduled hide
leave tooltip ─▶ schedule hide again
```

`setTimeout` returns an id and `clearTimeout(id)` cancels it. The tests use `vi.useFakeTimers()` + `vi.advanceTimersByTime(500)` to jump the clock forward instantly, so "wait 150ms" costs nothing and never flakes.

## Concept 4: Accessibility is part of "works"

Hover-only UI is invisible to keyboard users. The badge is inside an `<a>`, which is already focusable with Tab, so listening for `focus`/`blur` on the link gives keyboard users the same tooltip. `aria-label` gives screen readers "Rate My Professors: 2.3 out of 5" instead of "star two point three".

## Concept 5: Display and logic must agree

The plan picked the color from the raw rating but displayed it rounded. A 3.96 would show **"★ 4.0" in yellow**, while a 4.0 shows green: two badges with the same number, different colors. Users trust what they see. The fix computes the displayed value once (`Math.round(r * 10) / 10`) and derives *both* the text and the tier from it. General rule: when two outputs must be consistent, derive them from one value instead of computing each separately.

## Concept 6: Positioning on a hostile page

`@floating-ui/dom`'s `computePosition` works out where to place the tooltip (`placement: "top"`, `flip()` to go below if there's no room above, `shift()` to stay on-screen). Two choices beyond the plan:

- **`strategy: "fixed"`** positions relative to the viewport instead of the nearest positioned ancestor. Course listings are tables, and a cell with `overflow: hidden` would clip an absolutely-positioned tooltip. Fixed elements escape that clipping.
- **Hidden until placed.** The tooltip starts `visibility: hidden` and only becomes visible once coordinates arrive, so it never flashes in the page's top-left corner for a frame. If positioning ever fails, the tooltip is removed rather than throwing onto Drexel's page (the "failures must be silent" constraint).

What tests *can't* show: happy-dom doesn't do layout, so real positioning and appearance get checked by eye in Task 13's manual E2E.
