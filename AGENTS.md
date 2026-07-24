# Agent notes

## What this is

Personal homepage intended for a GitHub Pages user site at the domain root. It
is one static landing page with no application framework.

## Ground rules

- **Edit `src/`, never `design/`.** `design/Marek Nogiec - Static.html` is the
  frozen historical reference the initial sources were split from. The current
  compact 21-row design intentionally supersedes parts of that file. Current
  layout behavior is codified by `src/` plus
  `scripts/verify-browser.spec.mjs`.
- **Production is exactly two files.** Rsbuild inlines local CSS and JS into
  `dist/index.html` and emits one content-hashed Space Grotesk WOFF2 beside it.
  Verification rejects every other output file, local asset, or cross-origin
  runtime request.
- **Edit user-facing text only in `src/content/en.json`.** `src/index.html` is
  a build-time Lodash template and must use escaped `<%- copy.* %>`
  interpolation. Rsbuild resolves the catalog completely during compilation;
  neither the catalog nor localization machinery ships to the browser.
- The DOM-dependent entry script must remain injected at the end of `<body>`
  (`html.inject: "body"` and `html.scriptLoading: "blocking"`).
- Desktop layout uses 21 rows of 32 design px, 672 design-px content height,
  40px margins, and six columns. One rem equals 10 design px through 1440px;
  above 1440px it scales proportionally with the viewport. The page itself is
  always `100vw`.
- At 959px and below, the page uses the separate single-column layout with a
  stable 10px root. The 959/960 transition intentionally preserves 60px
  headline and 14px body sizes across the layout switch.
- Measurement geometry is derived from rendered `[data-m]` elements and `g*`
  spacer rows during idle time, with first interaction as a synchronous
  fallback. Pointer behavior is delegated and gated to fine-hover pointers;
  keyboard-focus measurement remains available on desktop.
- The theme preference is persisted in local storage and applied by the small
  head bootstrap before paint. The DOM-dependent theme control logic remains in
  `src/index.js`.

## Verification

After any source or build change, run:

```bash
npm run verify:all
```

Commit messages and pull request titles must follow Conventional Commits.
Install the `commit-msg` hook with `npm run prepare`; it uses Commitlint to
reject invalid messages before Git creates a commit. CI checks every commit and
the title in owner pull requests, and the latest commit on pushes to `main`.

`npm run verify:all` first checks that static page content still matches the
committed font manifest, then builds the site once, asserts the exact two-file
artifact contract, checks HTML/font/combined transfer budgets, runs negative
verifier fixtures, and verifies the built artifact in Chromium headless shell.

`npm run verify:browser` remains the safe standalone browser command: it builds
before starting the production preview. CI and `verify:all` use the internal
`verify:browser:built` command after their existing build. Browser verification
uses Playwright Test with one Chromium headless-shell worker. Install the
pinned browser with `npm run browser:install`. It checks 390, 959, 960, 1024,
1199, 1200, and 1440px viewports; typography continuity; overflow; target sizes;
semantic landmarks; theme state/persistence; both-theme contrast; reduced
motion; permitted network hosts; accessibility-tree isolation; and
measurement-row adjacency.

CI additionally runs three mobile Lighthouse passes using `lighthouserc.json`.
`scripts/ci-report.mjs` generates the artifact/Lighthouse report that the
workflow publishes to the Actions job summary and to one bot comment that is
updated in place on pull requests.
Budgets require Performance ≥98, Accessibility/Best Practices/SEO = 100,
LCP <1.8s, CLS <0.01, and TBT <50ms.

## Deployment safety

- Pull requests and pushes to `main` verify but never deploy.
- Deployment is manual through `workflow_dispatch` with the boolean `deploy`
  input explicitly enabled.
- The repository can remain private and GitHub Pages disabled indefinitely.
  Enabling Pages is an external release action and must not be inferred from a
  successful build or merge.
- CI uses immutable action SHAs, job-scoped permissions, non-persisted checkout
  credentials, ignored npm install scripts, timeouts, and Dependabot updates.

## Deliberate non-goals

- No service worker, framework runtime, client router, code splitting,
  `content-visibility`, persistent `will-change`, or speculative prefetching.
- Do not inline font binaries into the HTML. The content-derived external WOFF2
  preserves independent caching without a third-party request or blocking font
  stylesheet.

## Font subset maintenance

- `fonts/SpaceGrotesk[wght].woff2` is the pinned official 2.0.0 build input;
  `fonts/OFL.txt` must remain with it.
- `src/assets/space-grotesk-subset.woff2` and
  `fonts/space-grotesk-subset.json` are generated together.
- After changing visible page copy, install `requirements-fonts.txt` and run
  `npm run fonts:build`; do not hand-edit the manifest.
- `scripts/build-font-subset.py` lists the semantic catalog fields rendered in
  Space Grotesk. Add a field there when new custom-font copy is introduced;
  metadata and UI-monospace fields remain excluded.
- Monospace UI and all dynamic measurement digits use the system
  `ui-monospace` stack and are intentionally excluded from the custom subset.
