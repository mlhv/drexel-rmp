# Learning notes — Task 16: CI and tagged releases

## What we built

```
git push (main / PR) ──▶ ci.yml:      install → pnpm test → pnpm build
git push tag v1.0.0  ──▶ release.yml: tag == version? → install → test → wxt zip
                                        → GitHub Release "v1.0.0" + du-professorview-1.0.0-chrome.zip
```

- `.github/workflows/ci.yml` and `release.yml`
- Root `package.json`: `"packageManager": "pnpm@11.10.0"`

## Concept 1: What a GitHub Actions workflow is

A workflow is a YAML file in `.github/workflows/`. `on:` says *when* it runs (a push to main, a PR, a tag). `jobs:` run on a fresh virtual machine (`ubuntu-latest`), and each `steps:` entry either **uses** a published action (`actions/checkout@v4` clones your repo) or **runs** a shell command. Every run starts from an empty machine, which is the point: if it passes in CI, it doesn't secretly depend on something on your laptop.

## Concept 2: Reproducibility, three ways

1. **`packageManager`**: `pnpm/action-setup` reads it and installs exactly pnpm 11.10.0. Without it, CI could use a different pnpm that resolves or lays out dependencies differently.
2. **`--frozen-lockfile`**: install exactly what `pnpm-lock.yaml` records, and *fail* if `package.json` and the lockfile disagree, instead of silently re-resolving.
3. **`cache: pnpm`**: this only affects speed. The downloaded package store is cached between runs; what gets installed is still decided by the lockfile.

## Concept 3: The tag/version guard

```bash
if [ "${GITHUB_REF_NAME#v}" != "$PKG_VERSION" ]; then exit 1; fi
```

`GITHUB_REF_NAME` is the tag (`v1.0.0`), and `${VAR#v}` is shell syntax for "strip a leading `v`". If you tag `v1.0.1` but forget to bump `package.json`, the zip would claim to be 1.0.0 while the Release says 1.0.1. The store would also reject it, because the version didn't increase. Failing fast, before spending minutes on install and test, turns a confusing downstream error into an obvious one. We tested the check locally with three tag values.

## Concept 4: Least-privilege tokens

`permissions: contents: write` grants the workflow's automatic `GITHUB_TOKEN` just enough to create a Release, and nothing else. There are no store credentials in CI yet. Automated store upload (the follow-up project) will add OAuth secrets and one final step to this same file.
