/* Sanity checks on the production bundle: dist/index.html must be a single
   self-contained page — CSS and JS inlined, no local asset references. */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const ALLOWED_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

const failures = [];

function check(ok, message) {
  if (!ok) failures.push(message);
}

let html = "";
try {
  html = readFileSync(join(DIST, "index.html"), "utf8");
} catch {
  console.error("FAIL: dist/index.html does not exist — run the build first");
  process.exit(1);
}

const pages = readdirSync(DIST).filter((f) => f.endsWith(".html"));
check(pages.length === 1, `expected a single HTML page in dist/, found: ${pages.join(", ")}`);

/* Attribute matching must survive minification: tolerate any attribute
   order, and unquoted or single-quoted values. */
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`))?.[1].replace(/^["']|["']$/g, "");

// CSS and JS must be inlined — assert markers that only exist inside the
// assets themselves (not in the template markup) and survive minification
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
check(styles.includes("--gl-strong"), "CSS is not inlined (no <style> block with expected content)");
check(scripts.includes("pointerenter"), "JS is not inlined (no inline <script> with expected content)");

// no local asset references
for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) {
  const src = attr(tag, "src");
  check(src === undefined, `external script reference found: ${src}`);
}
for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
  if (!/\brel\s*=\s*["']?stylesheet/.test(tag)) continue;
  const href = attr(tag, "href") ?? "";
  const allowed = ALLOWED_HOSTS.some((h) => href.startsWith(`https://${h}`));
  check(allowed, `stylesheet reference to disallowed source: ${href || tag}`);
}

// content markers
for (const marker of ["Marek Nogiec", "Dropcast"]) {
  check(html.includes(marker), `expected content missing: "${marker}"`);
}

if (failures.length > 0) {
  console.error("dist verification FAILED:");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log(`dist verification passed (index.html: ${(html.length / 1024).toFixed(1)} KiB, single inlined page)`);
