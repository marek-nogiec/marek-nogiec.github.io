# Agent notes

## What this is

Personal homepage intended for a GitHub Pages user site at the domain root. It
is one static landing page with no application framework.

## Ground rules

- **Edit `src/`, never `design/`.** `design/Marek Nogiec - Static.html` is the
  frozen historical reference the initial sources were split from. The current
  compact 21-row design intentionally supersedes parts of that file. Current
  layout behavior is codified by `src/` plus `scripts/verify-browser.mjs`.
- **Production remains one self-contained HTML file.** Rsbuild inlines local CSS
  and JS into `dist/index.html`. The only runtime asset requests allowed are the
  two pinned WOFF2 files on `fonts.gstatic.com`; verification rejects any other
  output file, local asset, or external host.
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
npm run verify
npm run verify:browser
```

`npm run verify` builds the site, asserts the exact one-file artifact contract,
checks raw/gzip/Brotli budgets, and runs negative verifier fixtures.

`npm run verify:browser` starts the production preview and uses installed Chrome
through the DevTools protocol. It checks 390, 959, 960, 1024, 1199, 1200, and 1440px
viewports; typography continuity; overflow; target sizes; semantic landmarks;
theme state/persistence; both-theme contrast; reduced motion; permitted network
hosts; accessibility-tree isolation; and measurement-row adjacency.

CI additionally runs three mobile Lighthouse passes using `lighthouserc.json`.
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
- Do not inline full font binaries into the HTML. The pinned external WOFF2
  files preserve independent long-lived caching without restoring the blocking
  Google Fonts stylesheet.
