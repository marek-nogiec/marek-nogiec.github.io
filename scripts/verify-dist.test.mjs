import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyDist } from "./verify-dist.mjs";

const BUILT_DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const temporaryDirectories = [];

before(() => {
  assert.equal(
    verifyDist(BUILT_DIST).failures.length,
    0,
    "build must pass before negative verifier fixtures run",
  );
});

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { recursive: true, force: true });
  });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "homepage-dist-test-"));
  temporaryDirectories.push(directory);
  cpSync(BUILT_DIST, directory, { recursive: true });
  return directory;
}

function mutateHtml(directory, transform) {
  const htmlPath = join(directory, "index.html");
  const original = readFileSync(htmlPath, "utf8");
  writeFileSync(htmlPath, transform(original));
}

test("accepts the current production artifact", () => {
  assert.deepEqual(verifyDist(BUILT_DIST).failures, []);
});

test("rejects an extra output file", () => {
  const directory = fixture();
  writeFileSync(join(directory, "unexpected.js"), "console.log('unexpected')");
  assert.match(verifyDist(directory).failures.join("\n"), /exactly two dist files/);
});

test("rejects cross-origin preconnects, including familiar lookalike hosts", () => {
  const directory = fixture();
  mutateHtml(directory, (html) => html.replace(
    "</head>",
    '<link rel="preconnect" href="https://fonts.gstatic.com.evil.test/"></head>',
  ));
  assert.match(verifyDist(directory).failures.join("\n"), /disallowed external resource/);
});

test("rejects external scripts", () => {
  const directory = fixture();
  mutateHtml(directory, (html) => html.replace(
    "</body>",
    '<script src="https://example.com/tracker.js"></script></body>',
  ));
  assert.match(verifyDist(directory).failures.join("\n"), /disallowed external resource/);
});

test("rejects unapproved local runtime assets", () => {
  const directory = fixture();
  mutateHtml(directory, (html) => html.replace("</body>", '<img src="portrait.png"></body>'));
  assert.match(verifyDist(directory).failures.join("\n"), /unapproved local asset reference/);
});

test("requires a crossorigin font preload", () => {
  const directory = fixture();
  mutateHtml(directory, (html) => html.replace(' crossorigin=""', ""));
  assert.match(verifyDist(directory).failures.join("\n"), /valid crossorigin preload/);
});

test("enforces transfer budgets", () => {
  const directory = fixture();
  mutateHtml(directory, (html) => html.replace(
    "</body>",
    `<p>${Array.from({ length: 30_000 }, (_, index) => String.fromCharCode(33 + index % 90)).join("")}</p></body>`,
  ));
  assert.match(verifyDist(directory).failures.join("\n"), /budget exceeded/);
});
