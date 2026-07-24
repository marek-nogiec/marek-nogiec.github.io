/* Production contract:
   - dist/ contains index.html and exactly one hashed WOFF2 subset
   - CSS and JS are inlined
   - no cross-origin runtime requests are allowed
   - HTML, font, and combined cold transfer stay inside explicit budgets */

import {
  brotliCompressSync,
  constants as zlibConstants,
  gzipSync,
} from "node:zlib";
import {
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const LOCAL_BASE = "https://local.invalid/";
const BUDGETS = {
  raw: 24 * 1024,
  gzip: 8 * 1024,
  brotli: 7 * 1024,
  font: 6 * 1024,
  totalGzip: 12 * 1024,
  totalBrotli: 11 * 1024,
};

function listFiles(directory, root = directory) {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory()
        ? listFiles(path, root)
        : [relative(root, path).replaceAll("\\", "/")];
    })
    .sort();
}

function parseAttributes(tag) {
  const attributes = new Map();
  const pattern = /\b([:\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;

  while ((match = pattern.exec(tag))) {
    attributes.set(match[1].toLowerCase(), match[3] ?? match[4] ?? match[5] ?? "");
  }

  return attributes;
}

function isAllowedResource(rawValue, context, allowedLocalAssets, failures) {
  const value = rawValue.trim();
  if (!value || value.startsWith("#") || value.startsWith("data:")) return;

  let url;
  try {
    url = new URL(value, LOCAL_BASE);
  } catch {
    failures.push(`invalid resource URL in ${context}: ${value}`);
    return;
  }

  if (url.origin === new URL(LOCAL_BASE).origin) {
    const path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (!allowedLocalAssets.has(path)) {
      failures.push(`unapproved local asset reference in ${context}: ${value}`);
    }
    return;
  }

  failures.push(`disallowed external resource in ${context}: ${value}`);
}

function checkResourceReferences(html, styles, scripts, allowedLocalAssets, failures) {
  for (const [tag] of html.matchAll(/<(?:script|link|img|source|video|audio|iframe|object|embed|input)\b[^>]*>/gi)) {
    const tagName = tag.match(/^<(\w+)/i)?.[1].toLowerCase() ?? "element";
    const attributes = parseAttributes(tag);
    const rel = new Set((attributes.get("rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean));

    const resourceAttributes = [];
    if (tagName === "script" || ["img", "source", "video", "audio", "iframe", "embed", "input"].includes(tagName)) {
      resourceAttributes.push("src");
    }
    if (tagName === "video") resourceAttributes.push("poster");
    if (tagName === "object") resourceAttributes.push("data");
    if (tagName === "source" || tagName === "img") resourceAttributes.push("srcset");
    if (
      tagName === "link"
      && [...rel].some((value) => [
        "stylesheet",
        "preload",
        "modulepreload",
        "icon",
        "manifest",
        "apple-touch-icon",
        "mask-icon",
        "preconnect",
        "dns-prefetch",
      ].includes(value))
    ) {
      resourceAttributes.push("href");
    }

    resourceAttributes.forEach((name) => {
      const rawValue = attributes.get(name);
      if (rawValue === undefined) return;

      if (name === "srcset") {
        rawValue.split(",").forEach((candidate) => {
          isAllowedResource(
            candidate.trim().split(/\s+/)[0] ?? "",
            `${tagName}[${name}]`,
            allowedLocalAssets,
            failures,
          );
        });
      } else {
        isAllowedResource(rawValue, `${tagName}[${name}]`, allowedLocalAssets, failures);
      }
    });
  }

  for (const match of styles.matchAll(/\burl\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    isAllowedResource(match[2], "CSS url()", allowedLocalAssets, failures);
  }

  const dynamicRequestPatterns = [
    /\bfetch\s*\(/,
    /\bnew\s+(?:Worker|SharedWorker|WebSocket|EventSource)\s*\(/,
    /\bXMLHttpRequest\b/,
    /\.sendBeacon\s*\(/,
  ];
  dynamicRequestPatterns.forEach((pattern) => {
    if (pattern.test(scripts)) failures.push(`runtime request API found: ${pattern}`);
  });
}

export function verifyDist(distDirectory = DEFAULT_DIST) {
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };

  let files = [];
  let html = "";

  try {
    files = listFiles(distDirectory);
    html = readFileSync(join(distDirectory, "index.html"), "utf8");
  } catch {
    return {
      failures: ["dist/index.html does not exist — run the build first"],
      metrics: null,
    };
  }

  const fontFiles = files.filter((file) => file.endsWith(".woff2"));
  check(files.includes("index.html"), "dist/index.html is missing");
  check(files.length === 2, `expected exactly two dist files, found: ${JSON.stringify(files)}`);
  check(
    fontFiles.length === 1 && /^space-grotesk\.[a-f0-9]{8}\.woff2$/.test(fontFiles[0]),
    `expected one hashed Space Grotesk WOFF2, found: ${JSON.stringify(fontFiles)}`,
  );
  const allowedLocalAssets = new Set(fontFiles);

  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join("\n");
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .join("\n");

  check(styles.includes("--gl-strong"), "CSS is not inlined with the expected design tokens");
  check(scripts.includes("requestIdleCallback"), "JS is not inlined with deferred measurement setup");

  checkResourceReferences(html, styles, scripts, allowedLocalAssets, failures);
  if (fontFiles.length === 1) {
    const escapedFontName = fontFiles[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const fontReferences = html.match(new RegExp(
      escapedFontName,
      "g",
    )) ?? [];
    check(fontReferences.length === 2, "font must be referenced once by preload and once by @font-face");
    const hasValidPreload = [...html.matchAll(/<link\b[^>]*>/gi)].some(([tag]) => {
      const attributes = parseAttributes(tag);
      const rel = new Set(
        (attributes.get("rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean),
      );
      return rel.has("preload")
        && attributes.get("href")?.endsWith(fontFiles[0])
        && attributes.get("as") === "font"
        && attributes.get("type") === "font/woff2"
        && attributes.has("crossorigin");
    });
    check(hasValidPreload, "font asset is missing a valid crossorigin preload");
  }

  [
    "Marek Nogiec",
    "Dropcast",
    'meta name="description"',
    'aria-label="Light theme; switch to dark theme"',
    'aria-hidden="true"',
    "<h2",
    "<footer",
  ].forEach((marker) => {
    check(html.includes(marker), `expected production marker missing: ${marker}`);
  });

  const raw = Buffer.byteLength(html);
  const gzip = gzipSync(html, { level: 9 }).byteLength;
  const brotli = brotliCompressSync(html, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    },
  }).byteLength;
  let font = 0;
  if (fontFiles.length === 1) {
    const fontBuffer = readFileSync(join(distDirectory, fontFiles[0]));
    font = fontBuffer.byteLength;
    check(fontBuffer.subarray(0, 4).toString("ascii") === "wOF2", "font asset is not WOFF2");
  }
  const totalGzip = gzip + font;
  const totalBrotli = brotli + font;

  check(raw <= BUDGETS.raw, `raw HTML budget exceeded: ${raw} > ${BUDGETS.raw} bytes`);
  check(gzip <= BUDGETS.gzip, `gzip budget exceeded: ${gzip} > ${BUDGETS.gzip} bytes`);
  check(brotli <= BUDGETS.brotli, `Brotli budget exceeded: ${brotli} > ${BUDGETS.brotli} bytes`);
  check(font <= BUDGETS.font, `font budget exceeded: ${font} > ${BUDGETS.font} bytes`);
  check(
    totalGzip <= BUDGETS.totalGzip,
    `total gzip + font budget exceeded: ${totalGzip} > ${BUDGETS.totalGzip} bytes`,
  );
  check(
    totalBrotli <= BUDGETS.totalBrotli,
    `total Brotli + font budget exceeded: ${totalBrotli} > ${BUDGETS.totalBrotli} bytes`,
  );

  return {
    failures,
    metrics: {
      raw,
      gzip,
      brotli,
      font,
      totalGzip,
      totalBrotli,
      files,
    },
  };
}

function main() {
  const result = verifyDist();

  if (result.failures.length > 0) {
    console.error("dist verification FAILED:");
    result.failures.forEach((failure) => console.error(`  ✗ ${failure}`));
    process.exit(1);
  }

  const {
    raw,
    gzip,
    brotli,
    font,
    totalGzip,
    totalBrotli,
  } = result.metrics;
  console.log(
    `dist verification passed (raw ${(raw / 1024).toFixed(1)} KiB, `
    + `font ${(font / 1024).toFixed(1)} KiB, `
    + `gzip + font ${(totalGzip / 1024).toFixed(1)} KiB, `
    + `Brotli + font ${(totalBrotli / 1024).toFixed(1)} KiB; `
    + `HTML only: gzip ${(gzip / 1024).toFixed(1)} KiB, `
    + `Brotli ${(brotli / 1024).toFixed(1)} KiB)`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
