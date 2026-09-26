# Learning notes — Task 15: Branding, generated icons, version 1.0.0

## What we built

- `packages/extension/assets/icon.svg`: one 128×128 source image (teal tile, white lens with a star).
- `@wxt-dev/auto-icons` renders it to `icons/16.png`, `32`, `48` and `128` at build time and adds the `icons` map to the manifest.
- Zip renamed via `zip.artifactTemplate` to `du-professorview-1.0.0-chrome.zip`. Version bumped to `1.0.0`.
- README leads with the new name and the non-affiliation disclaimer.

## Concept 1: One source of truth for images

Chrome wants several icon sizes: 16 for the toolbar, 32/48 for the extensions page, 128 for the store and install dialog. Hand-exporting four PNGs means four files that drift apart the first time you tweak the design. Instead, the SVG is the only committed artifact, and the build derives the rest. It's the same principle as `buildManifest`: store the *input*, compute the *outputs*.

Why SVG? It's a vector (shapes, not pixels), so it renders sharply at any size. The build uses **sharp**, an image library with prebuilt native binaries. Your `pnpm-workspace.yaml` blocks sharp's install script (`allowBuilds: sharp: false`), but modern sharp ships ready-made binaries per platform as optional dependencies, so no script was needed.

At 16px, fine detail disappears. That's why the design is chunky: a thick ring, a thick handle, one bold star. Always check the smallest size.

## Concept 2: Trademark-safe branding

The icon avoids Drexel's navy and gold and the dragon, and anything resembling RMP's logo. The name "DU ProfessorView" is yours. "Drexel" and "Rate My Professors" appear only *descriptively* ("ratings on Drexel's course pages"), plus an explicit "not affiliated" line. Descriptive use of a trademark is generally fine; implying endorsement is what gets extensions removed.

## Concept 3: Semantic versioning and the store

The store requires every upload to have a **higher** `version` than the last one, and WXT copies it from `package.json`. `1.0.0` signals "first public release". From here: bug fix → `1.0.1`, new feature → `1.1.0`, breaking change → `2.0.0`. In Task 16, the release workflow refuses to build if the git tag and this version disagree.
