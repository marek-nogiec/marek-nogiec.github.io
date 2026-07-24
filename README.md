# marek-nogiec.github.io

Personal homepage built as an aggressively small, progressively enhanced static
page. There is no framework, hydration, application state, analytics, or remote
JavaScript.

## Production architecture

- All user-facing copy lives in `src/content/en.json`. Rsbuild resolves it into
  the escaped `src/index.html` template at build time; no content catalog or
  localization code ships to the browser.
- Layout, styles, and behavior stay readable in `src/index.html`,
  `src/styles.css`, and `src/index.js`.
- Rsbuild minifies and inlines local CSS and JS into `dist/index.html`.
- Space Grotesk is statically subset from the page's actual non-monospace text.
  Production emits one preloaded, content-hashed WOFF2 beside the HTML; there
  are no cross-origin runtime requests.
- Monospace UI uses the operating system's `ui-monospace` stack, avoiding a
  second font download.
- The desktop measurement overlay is idle-deferred, delegated, fine-pointer
  gated, compositor-friendly, reduced-motion aware, and hidden from assistive
  technology.

## Commands

```bash
npm run dev              # development server with hot reload
npm run build            # production build
npm run preview          # serve the production artifact
npm run fonts:verify      # ensure page text and committed subset still match
npm run fonts:build       # regenerate subset (requires requirements-fonts.txt)
npm run verify           # build, artifact contract, budgets, negative fixtures
npm run verify:browser   # responsive/a11y/network checks in installed Chrome
```

## Quality gates

The artifact verifier requires:

- exactly two output files: `dist/index.html` and one hashed WOFF2
- no local runtime asset except that font and no cross-origin requests
- inlined local CSS and JS
- required semantic and accessibility markers
- HTML ≤24 KiB raw, ≤8 KiB gzip, and ≤7 KiB Brotli
- font ≤6 KiB
- combined cold transfer ≤12 KiB with gzip or ≤11 KiB with Brotli

The font source is pinned at Space Grotesk 2.0.0 under the SIL OFL. To update
page copy, install the reproducible font tooling once and regenerate:

```bash
python3 -m pip install -r requirements-fonts.txt
npm run fonts:build
```

The subset generator reads six semantic Space Grotesk fields directly from the
content catalog, records their codepoints and source/subset hashes, trims the
variable weight axis to 400–700, retains font license metadata, and fails
verification if copy and the committed artifact diverge. Metadata and
system-monospace fields never enter the custom subset. Dynamic ruler digits use
system monospace, so all values from 0–9 remain available without browser-driven
glyph collection.

Browser verification covers 390, 959, 960, 1024, 1199, 1200, and 1440px widths, both themes,
contrast, target sizing, overflow, reduced motion, theme persistence, permitted
requests, accessibility-tree isolation, and measurement-grid correctness.

CI runs three additional mobile Lighthouse passes with these budgets:

- Performance ≥98
- Accessibility, Best Practices, and SEO = 100
- LCP <1.8s
- CLS <0.01
- TBT <50ms

## Deployment

The GitHub workflow verifies pull requests and pushes to `main`, but never
deploys automatically. Publishing requires a manual workflow dispatch with the
`deploy` input enabled.

The repository may remain private with GitHub Pages disabled. Enabling Pages is
a separate release decision; merging code alone cannot expose the site.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | Editable page sources |
| `src/content/en.json` | Build-time source of all user-facing copy |
| `design/` | Frozen historical reference; never edit |
| `fonts/` | Pinned Space Grotesk source, OFL, and subset manifest |
| `src/assets/` | Generated production font subset |
| `scripts/content.test.mjs` | Catalog completeness and no-duplicate-copy gate |
| `scripts/build-font-subset.py` | Catalog reader, drift gate, and deterministic subset generator |
| `scripts/verify-dist.mjs` | Two-file/resource/budget verifier |
| `scripts/verify-browser.mjs` | Dependency-free Chrome/CDP browser checks |
| `lighthouserc.json` | Repeat-run Lighthouse budgets |
