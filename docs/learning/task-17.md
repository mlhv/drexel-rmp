# Learning notes — Task 17: Landing page and privacy policy on GitHub Pages

## What we built

- `site/index.html`, `site/privacy.html`, `site/style.css`, `site/icon.svg`: plain static HTML with no build step. Light and dark themes come from `prefers-color-scheme`.
- `.github/workflows/pages.yml`: when `site/**` changes on main, it uploads the folder and deploys it to `https://mlhv.github.io/drexel-rmp/`.

## Concept 1: Why `site/` and not `docs/`

GitHub Pages' classic mode serves the `docs/` folder, but yours holds internal specs, plans and these notes, which aren't meant to be a public website. With **Pages from Actions**, the workflow chooses exactly which folder becomes the site (`path: site`). Nothing else leaks.

The workflow's permissions are unusual: `pages: write` plus `id-token: write`. The deploy action proves to GitHub that "this run, in this repo, is allowed to publish" with a short-lived OIDC token instead of a stored secret. The `environment: github-pages` line is what shows the deployment URL in the Actions UI.

## Concept 2: A privacy policy is a claim about your code

Store reviewers compare three things: the manifest's permissions, the privacy-practices form, and the policy page. So before writing the policy, we **audited the code**. We grepped every `fetch`, `storage.*` call and URL in the extension and shared packages. The result: only the Worker and RMP's GraphQL endpoint are contacted, and only `storage.local` is used.

The audit caught a real inaccuracy in the plan. The planned text said ratings are cached "for about 24 hours". But `cache.ts` never deletes anything: after 24h an entry becomes *stale*, not gone, because the design serves stale data when the network is down. The policy now says exactly that. This is why the spec has the rule "any change that sends or stores new data updates the privacy page in the same PR": the policy and the code must describe the same system.

## Concept 3: Mock instead of screenshot

The page shows a small HTML table row with a `★ 4.3` badge instead of a screenshot, because real screenshots need your Drexel login. The page is complete now, and the runbook has you add a real screenshot after approval.
