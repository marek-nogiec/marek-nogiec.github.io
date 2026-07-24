import { createHash } from "node:crypto";
import {
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML_PATH = resolve(ROOT, "src/index.html");
const CSS_PATH = resolve(ROOT, "src/styles.css");
const SOURCE_PATH = resolve(ROOT, "fonts/SpaceGrotesk[wght].woff2");
const SUBSET_PATH = resolve(ROOT, "src/assets/space-grotesk-subset.woff2");
const MANIFEST_PATH = resolve(ROOT, "fonts/space-grotesk-subset.json");

// These classes switch their subtree to the system monospace stack. The
// measurement dials are included here, so their dynamic 0–9 glyphs never need
// to be carried by the custom Space Grotesk subset.
const UI_MONO_CLASSES = new Set([
  "b-label",
  "footer",
  "live-link",
  "mono",
  "page-count",
  "section-label",
  "tags",
  "theme-toggle",
]);
const INTENTIONAL_FALLBACKS = new Set([
  // Space Grotesk 2.0 has no U+2011 mapping; the existing Wi‑Fi hyphen
  // deliberately uses the sans-serif fallback without changing layout.
  "‑",
]);

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);
const IGNORED_ELEMENTS = new Set(["script", "style", "noscript", "template", "svg"]);

function parseAttributes(tag) {
  const attributes = new Map();
  const pattern = /\b([:\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;

  while ((match = pattern.exec(tag))) {
    attributes.set(match[1].toLowerCase(), match[3] ?? match[4] ?? match[5] ?? "");
  }

  return attributes;
}

function decodeEntities(text) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: "\u00A0",
    quot: '"',
  };

  return text.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, key) => {
    if (key[0] === "#") {
      const hexadecimal = key[1]?.toLowerCase() === "x";
      const value = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
    }
    return named[key.toLowerCase()] ?? entity;
  });
}

export function extractSpaceCharacters(html) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  if (body === undefined) throw new Error("src/index.html has no complete body element");

  const stack = [{ tag: "body", family: "space", ignored: false }];
  const chunks = [];
  const tokens = body.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>|[^<]+/gi) ?? [];

  for (const token of tokens) {
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;

    if (token.startsWith("</")) {
      const tag = token.match(/^<\/\s*([a-z][\w:-]*)/i)?.[1].toLowerCase();
      const index = stack.findLastIndex((entry) => entry.tag === tag);
      if (index > 0) stack.length = index;
      continue;
    }

    if (token.startsWith("<")) {
      const tag = token.match(/^<\s*([a-z][\w:-]*)/i)?.[1].toLowerCase();
      if (!tag) continue;

      const parent = stack.at(-1);
      const classes = new Set((parseAttributes(token).get("class") ?? "").split(/\s+/).filter(Boolean));
      const family = [...classes].some((name) => UI_MONO_CLASSES.has(name))
        ? "mono"
        : parent.family;
      const ignored = parent.ignored || IGNORED_ELEMENTS.has(tag);

      if (!VOID_ELEMENTS.has(tag) && !token.endsWith("/>")) {
        stack.push({ tag, family, ignored });
      }
      continue;
    }

    const current = stack.at(-1);
    if (current.family !== "space" || current.ignored || !token.trim()) continue;
    chunks.push(decodeEntities(token).normalize("NFC").replace(/\s+/g, " ").trim());
  }

  return [...new Set(chunks.join(" "))]
    .filter((character) => !INTENTIONAL_FALLBACKS.has(character))
    .sort((left, right) => (
      left.codePointAt(0) - right.codePointAt(0)
    )).join("");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function manifestFor(characters) {
  return {
    family: "Space Grotesk",
    source: {
      version: "2.0.0",
      url: "https://github.com/floriankarsten/space-grotesk/releases/tag/2.0.0",
      sha256: sha256(SOURCE_PATH),
    },
    subset: {
      weights: "400 700",
      format: "woff2",
      bytes: statSync(SUBSET_PATH).size,
      sha256: sha256(SUBSET_PATH),
    },
    fallbackCharacters: [...INTENTIONAL_FALLBACKS].join(""),
    characters,
    codepoints: [...characters].map((character) => (
      `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`
    )),
  };
}

function verifyMonoSelectors(css) {
  const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*font-family:\s*var\(--font-mono\)[^{}]*\}/g)]
    .map((match) => match[1].trim());
  const uncovered = selectors.filter((selector) => (
    ![...UI_MONO_CLASSES].some((className) => selector.includes(`.${className}`))
  ));
  const staleClasses = [...UI_MONO_CLASSES].filter((className) => (
    !selectors.some((selector) => selector.includes(`.${className}`))
  ));
  if (uncovered.length > 0) {
    throw new Error(`font extractor does not cover UI-mono selector(s): ${uncovered.join(", ")}`);
  }
  if (staleClasses.length > 0) {
    throw new Error(`font extractor has stale UI-mono class(es): ${staleClasses.join(", ")}`);
  }
}

function main() {
  const mode = process.argv[2] ?? "--check";
  const html = readFileSync(HTML_PATH, "utf8");
  const css = readFileSync(CSS_PATH, "utf8");
  verifyMonoSelectors(css);

  const characters = extractSpaceCharacters(html);
  if (mode === "--characters") {
    process.stdout.write(characters);
    return;
  }

  const actual = manifestFor(characters);
  if (mode === "--write") {
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    console.log(`wrote ${MANIFEST_PATH}`);
    return;
  }

  if (mode !== "--check") throw new Error(`unknown mode: ${mode}`);
  const expected = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      "Space Grotesk content or font artifact changed; run `npm run fonts:build` "
      + "after installing requirements-fonts.txt",
    );
  }

  console.log(
    `font subset verified (${[...characters].length} subset characters, `
    + `${actual.subset.bytes} bytes)`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
