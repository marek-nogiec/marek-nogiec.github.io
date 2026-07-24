# marek-nogiec.github.io

Personal homepage — a single static landing page, deployed to GitHub Pages.

## Stack

- [Rsbuild](https://rsbuild.rs) (Rspack-based) for dev server + production build
- Sources are split into `src/index.html`, `src/styles.css`, `src/index.js`; the production build minifies and inlines CSS + JS back into a **single self-contained `dist/index.html`** (only Google Fonts stay external)
- Deployed via GitHub Actions using the modern Pages workflow (`actions/deploy-pages`), not the branch-based method

## Commands

```bash
npm run dev      # dev server with hot reload at http://localhost:3000
npm run build    # production build into dist/
npm run preview  # serve the production build locally
npm run verify   # build + sanity-check dist (single page, CSS/JS inlined, no local asset refs)
```

## Deployment

Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml): install → `npm run verify` (build + dist checks) → upload `dist/` → deploy to Pages. It can also be triggered manually from the Actions tab.

**One-time setup** (already done if the site is live): repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Repo layout

| Path | Purpose |
| --- | --- |
| `src/` | The actual sources — edit these |
| `design/` | Frozen reference: the original self-contained static design |
| `scripts/verify-dist.mjs` | Post-build sanity checks (run by `npm run verify` and CI) |

## Planned

- Defer below-the-fold work (grid overlay / measurement JS) behind idle loading
- Self-host fonts
