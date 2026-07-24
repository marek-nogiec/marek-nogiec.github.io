# Agent notes

## What this is

Personal homepage for GitHub Pages (user site, served at the domain root). One static landing page, no framework.

## Ground rules

- **Edit `src/`, never `design/`.** `design/Marek Nogiec - Static.html` is the frozen reference design the sources were split from. Rendered at a 1440-wide viewport, the page must stay visually identical to it unless the change is explicitly about the design. (Other widths are proportional rescales of that reference — see the grid bullet below.)
- **The production output must remain a single self-contained HTML file.** `rsbuild.config.mjs` inlines all CSS and JS into `dist/index.html`; the only allowed external requests are Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`). Don't add config or dependencies that break this without being asked.
- The page script queries the DOM at load, so the script must stay injected at the end of `<body>` (`html.inject: "body"` in the Rsbuild config).
- Layout is a strict 8-pt grid in **design px**: 32 rows, 800 content height, 40 margins, 6 columns, 1440 page width filling a 1440 reference viewport. Sizes are written in rem (1rem = 10 design px) and the root font-size scales as `100vw / 144`, so every viewport width renders the same proportions as the 1440 reference (the page always fills the viewport edge-to-edge); only hairlines stay a physical `1px`. The measurement overlay derives its design-px data from the rendered grid at load (`src/index.js` reads the positions of the `[data-m]` elements and `g*` spacer divs and normalizes by the root font-size), so moving elements only means updating the `grid-row` values in `src/styles.css` and the spacer divs in `src/index.html` consistently — there is no pixel table to sync.
- Below 840px the page is a separate single-column layout rebased to a 390 reference (`@media (max-width: 840px)` in `src/styles.css`): spacer divs, rulers and grid overlay are hidden, rhythm comes from margins, and the measurement JS is gated off via the same media query.

## Verification

After any change, run:

```bash
npm run verify
```

This builds and sanity-checks `dist/index.html` (single page, CSS/JS inlined, no local asset references, content markers present). There is no test suite yet — visual checks happen in the browser via `npm run dev` (hot reload) or `npm run preview` (production build).

## Deployment

Push to `main` deploys via `.github/workflows/deploy.yml` (Actions-based Pages flow). CI runs `npm run verify` before deploying, so a failing verify blocks the deploy.

## Planned (not yet done)

- Defer below-the-fold JS (grid overlay / measurements) behind idle loading
- Self-host fonts instead of Google Fonts links
