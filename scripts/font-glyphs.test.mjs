import assert from "node:assert/strict";
import { test } from "node:test";

import { extractSpaceCharacters } from "./font-glyphs.mjs";

test("extracts visible Space Grotesk text but excludes UI-mono subtrees", () => {
  const html = `
    <body>
      <h1>Grotesk &amp; Wi‑Fi →</h1>
      <p class="mono">Mono 0123456789</p>
      <button class="theme-toggle"><span>Light</span></button>
      <script>not visible</script>
      <svg><text>not a font glyph</text></svg>
    </body>
  `;

  const characters = extractSpaceCharacters(html);
  assert.ok(characters.includes("&"));
  assert.ok(characters.includes("→"));
  assert.ok(!characters.includes("0"));
  assert.ok(!characters.includes("L"));
  assert.ok(!characters.includes("‑"));
  assert.ok(!characters.includes("v"));
});
