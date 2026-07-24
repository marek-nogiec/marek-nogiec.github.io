# marek-nogiec.github.io

Personal homepage built as an aggressively small, progressively enhanced static
page. There is no framework, hydration, application state, analytics, or remote
JavaScript.

## Production architecture

- Sources stay readable in `src/index.html`, `src/styles.css`, and
  `src/index.js`.
- Rsbuild minifies and inlines local CSS and JS into one `dist/index.html`.
- The only runtime asset requests are two pinned, independently cacheable WOFF2
  files from `fonts.gstatic.com`.
- The Google Fonts stylesheet is not used, avoiding its render-blocking
  HTML → CSS → font dependency chain.
- The desktop measurement overlay is idle-deferred, delegated, fine-pointer
  gated, compositor-friendly, reduced-motion aware, and hidden from assistive
  technology.

## Commands

```bash
npm run dev              # development server with hot reload
npm run build            # production build
npm run preview          # serve the production artifact
npm run verify           # build, artifact contract, budgets, negative fixtures
npm run verify:browser   # responsive/a11y/network checks in installed Chrome
```

## Quality gates

The artifact verifier requires:

- exactly one output file: `dist/index.html`
- no local runtime assets
- no external host except the approved font host
- inlined local CSS and JS
- required semantic and accessibility markers
- ≤24 KiB raw, ≤8 KiB gzip, and ≤7 KiB Brotli

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
| `design/` | Frozen historical reference; never edit |
| `scripts/verify-dist.mjs` | One-file/resource/budget verifier |
| `scripts/verify-browser.mjs` | Dependency-free Chrome/CDP browser checks |
| `lighthouserc.json` | Repeat-run Lighthouse budgets |
