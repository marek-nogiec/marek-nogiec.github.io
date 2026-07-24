import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CONTENT_PATH = fileURLToPath(new URL("../src/content/en.json", import.meta.url));
const TEMPLATE_PATH = fileURLToPath(new URL("../src/index.html", import.meta.url));
const SCRIPT_PATH = fileURLToPath(new URL("../src/index.js", import.meta.url));

function stringLeaves(value, path = []) {
  if (typeof value === "string") return [{ path: path.join("."), value }];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`content value at ${path.join(".") || "<root>"} must be an object or string`);
  }
  return Object.entries(value).flatMap(([key, child]) => stringLeaves(child, [...path, key]));
}

test("the locale catalog is complete, referenced, and the sole copy source", () => {
  const content = JSON.parse(readFileSync(CONTENT_PATH, "utf8"));
  const template = readFileSync(TEMPLATE_PATH, "utf8");
  const script = readFileSync(SCRIPT_PATH, "utf8");
  const leaves = stringLeaves(content);

  assert.equal(content.locale, "en");
  assert.ok(leaves.length > 0);

  leaves.forEach(({ path, value }) => {
    assert.ok(value.length > 0, `content field ${path} is empty`);
    assert.ok(
      template.includes(`<%- copy.${path} %>`),
      `template does not safely reference copy.${path}`,
    );

    if (value.length >= 4) {
      assert.ok(!template.includes(value), `template duplicates catalog text: ${value}`);
      const quotedInScript = script.includes(JSON.stringify(value))
        || script.includes(`'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`);
      assert.ok(!quotedInScript, `runtime script duplicates catalog text: ${value}`);
    }
  });
});
