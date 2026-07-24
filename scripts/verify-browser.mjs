/* Browser-level invariants without a browser automation dependency.
   Uses the Chrome DevTools Protocol exposed by a locally installed Chrome. */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = 4173;
const PAGE_URL = `http://${HOST}:${PORT}/`;
const PROFILE = mkdtempSync(join(tmpdir(), "homepage-chrome-"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RSBUILD_BIN = fileURLToPath(
  new URL("../node_modules/@rsbuild/core/bin/rsbuild.js", import.meta.url),
);

const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const chromePath = chromeCandidates.find(existsSync);
assert.ok(chromePath, "Chrome was not found; set CHROME_PATH to run browser verification");

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    wait(3_000),
  ]);
}

async function waitFor(predicate, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(50);
  }
  throw new Error(`timed out waiting for ${description}`);
}

function startPreview() {
  return spawn(process.execPath, [
    RSBUILD_BIN,
    "preview",
    "--host",
    HOST,
    "--port",
    String(PORT),
  ], {
    cwd: ROOT,
    stdio: "ignore",
  });
}

function startChrome() {
  return spawn(chromePath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-component-update",
    "--no-first-run",
    "--remote-debugging-port=0",
    `--user-data-dir=${PROFILE}`,
    "about:blank",
  ], {
    stdio: "ignore",
  });
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? "browser evaluation failed");
    }
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

function parseRgb(value) {
  const channels = value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  assert.equal(channels?.length, 3, `could not parse color: ${value}`);
  return channels;
}

function luminance(rgb) {
  const [red, green, blue] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background) {
  const fg = luminance(parseRgb(foreground));
  const bg = luminance(parseRgb(background));
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
}

async function navigate(client, width, height = 900) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await client.send("Page.navigate", { url: PAGE_URL });
  await waitFor(
    async () => client.evaluate(
      "document.readyState === 'complete' && document.fonts.status === 'loaded'",
    ),
    `page load at ${width}px`,
  );

  return client.evaluate(`(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector).getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    return {
      width: innerWidth,
      rootFont: parseFloat(style("html").fontSize),
      bioFont: parseFloat(style(".bio").fontSize),
      headlineFont: parseFloat(style(".headline").fontSize),
      contentDisplay: style(".content").display,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bioRect: rect(".bio"),
      targets: {
        handle: rect(".handle"),
        theme: rect(".theme-toggle"),
        project: rect(".project-card"),
        live: rect(".live-link")
      },
      semantics: {
        h2: document.querySelectorAll("main h2").length,
        h3: document.querySelectorAll("main h3").length,
        footer: document.querySelectorAll("main footer").length,
        rulerHidden: [...document.querySelectorAll(".ruler")].every((el) => el.getAttribute("aria-hidden") === "true"),
        themeName: document.querySelector("#theme-toggle").getAttribute("aria-label")
      },
      resources: performance.getEntriesByType("resource").map((entry) => entry.name)
    };
  })()`);
}

async function measureTarget(client, key, index = 0) {
  return client.evaluate(`(async () => {
    const target = [...document.querySelectorAll('[data-m="${key}"]')][${index}];
    if (!target) throw new Error("missing measurement target: ${key}[${index}]");

    target.dispatchEvent(new PointerEvent("pointerover", {
      bubbles: true,
      pointerType: "mouse",
      relatedTarget: null
    }));
    document.querySelector("#page").dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      pointerType: "mouse"
    }));
    await new Promise(requestAnimationFrame);

    const dialValue = (bracket) => [...bracket.querySelectorAll(".dial .strip")]
      .map((strip) => {
        const match = strip.style.transform.match(/translateY\\((-?\\d+(?:\\.\\d+)?)%\\)/);
        return match ? Math.round(Math.abs(Number(match[1])) / 10) : "?";
      })
      .join("");

    return {
      finePointer: matchMedia("(hover: hover) and (pointer: fine)").matches,
      active: [...document.querySelectorAll(".bracket.on")].map((bracket) => {
        const rulerRect = bracket.parentElement.getBoundingClientRect();
        const lineRect = bracket.querySelector(".b-line").getBoundingClientRect();
        const labelRect = bracket.querySelector(".b-label").getBoundingClientRect();
        return {
          side: bracket.id.includes("-r") ? "r" : "l",
          top: Number(bracket.style.getPropertyValue("--gap-top")),
          height: Number(bracket.style.getPropertyValue("--gap-h")),
          label: dialValue(bracket),
          lineTop: Math.round(lineRect.top - rulerRect.top),
          lineHeight: Math.round(lineRect.height),
          labelCenter: Math.round(labelRect.top + labelRect.height / 2 - rulerRect.top)
        };
      })
    };
  })()`);
}

const preview = startPreview();
let chrome;
let client;

try {
  await waitFor(async () => {
    try {
      return (await fetch(PAGE_URL)).ok;
    } catch {
      return false;
    }
  }, "production preview");

  chrome = startChrome();
  const activePortPath = join(PROFILE, "DevToolsActivePort");
  await waitFor(() => existsSync(activePortPath), "Chrome DevTools port");
  const port = readFileSync(activePortPath, "utf8").split(/\r?\n/)[0];

  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const pageTarget = targets.find((target) => target.type === "page");
  assert.ok(pageTarget?.webSocketDebuggerUrl, "Chrome page target was not available");

  client = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Page.enable");
  await client.send("Runtime.enable");

  const widths = [390, 959, 960, 1024, 1199, 1200, 1440];
  const results = [];
  for (const width of widths) {
    results.push(await navigate(client, width));
    if (process.env.CAPTURE_SCREENSHOTS === "1" && [390, 960, 1440].includes(width)) {
      const screenshot = await client.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      writeFileSync(`/tmp/homepage-browser-${width}.png`, screenshot.data, "base64");
    }
  }

  results.forEach((result) => {
    assert.ok(result.overflow <= 0, `${result.width}px viewport has horizontal overflow`);
    assert.ok(result.bioFont >= 14, `${result.width}px bio text is below 14px`);
    if (result.width >= 960) {
      assert.ok(result.bioRect.height <= 96, `${result.width}px bio exceeds its three-row grid area`);
    }
    Object.entries(result.targets).forEach(([name, rect]) => {
      assert.ok(rect.height >= 24, `${name} target is below 24px at ${result.width}px`);
    });
    assert.deepEqual(result.semantics.h2, 1);
    assert.deepEqual(result.semantics.h3, 1);
    assert.deepEqual(result.semantics.footer, 1);
    assert.equal(result.semantics.rulerHidden, true);
    assert.match(
      result.semantics.themeName,
      /^(?:Light|Dark) theme; switch to (?:light|dark) theme$/,
    );
    result.resources
      .filter((resource) => resource.startsWith("http") && !resource.startsWith(PAGE_URL))
      .forEach((resource) => {
        assert.equal(new URL(resource).hostname, "fonts.gstatic.com");
      });
  });

  const compactEdge = results.find((result) => result.width === 959);
  const desktopEdge = results.find((result) => result.width === 960);
  assert.equal(compactEdge.contentDisplay, "block");
  assert.equal(desktopEdge.contentDisplay, "grid");
  assert.ok(Math.abs(compactEdge.bioFont - desktopEdge.bioFont) <= 0.5, "body type jumps at 959/960px");
  assert.ok(Math.abs(compactEdge.headlineFont - desktopEdge.headlineFont) <= 0.5, "headline jumps at 959/960px");

  const lightColors = await client.evaluate(`(() => {
    document.documentElement.dataset.theme = "light";
    const body = getComputedStyle(document.body);
    return {
      background: body.backgroundColor,
      colors: [".section-label", ".tags", ".footer"].map((selector) => getComputedStyle(document.querySelector(selector)).color)
    };
  })()`);
  lightColors.colors.forEach((color) => {
    assert.ok(contrast(color, lightColors.background) >= 4.5, `light contrast failed: ${color}`);
  });

  const darkColors = await client.evaluate(`(() => {
    document.documentElement.dataset.theme = "dark";
    const body = getComputedStyle(document.body);
    return {
      background: body.backgroundColor,
      colors: [".section-label", ".tags", ".footer"].map((selector) => getComputedStyle(document.querySelector(selector)).color)
    };
  })()`);
  darkColors.colors.forEach((color) => {
    assert.ok(contrast(color, darkColors.background) >= 4.5, `dark contrast failed: ${color}`);
  });

  const themeState = await client.evaluate(`(() => {
    document.documentElement.dataset.theme = "light";
    localStorage.removeItem("theme");
    const button = document.querySelector("#theme-toggle");
    button.click();
    return {
      theme: document.documentElement.dataset.theme,
      stored: localStorage.getItem("theme"),
      pressed: button.getAttribute("aria-pressed"),
      label: button.getAttribute("aria-label")
    };
  })()`);
  assert.deepEqual(themeState, {
    theme: "dark",
    stored: "dark",
    pressed: "true",
    label: "Dark theme; switch to light theme",
  });

  await client.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  const motion = await client.evaluate(`[
    ".grid-overlay",
    ".bracket",
    ".bracket .b-line",
    ".dial .strip"
  ].map((selector) => {
    const el = document.querySelector(selector);
    return el ? getComputedStyle(el).transitionDuration : "0s";
  })`);
  motion.forEach((duration) => assert.equal(duration, "0s"));

  const measurementScenarios = [
    ["headline", "l", [[32, 32], [192, 128]]],
    ["gHeadProj", "l", [[192, 128]]],
    ["projects", "l", [[192, 128], [352, 32]]],
    ["gNavSub", "r", [[32, 64]]],
    ["sub", "r", [[32, 64], [128, 64]]],
    ["gSubBio", "r", [[128, 64]]],
    ["bio", "r", [[128, 64], [288, 320]]],
    ["gBioPage", "r", [[288, 320]]],
    ["pageinfo", "r", [[288, 320], [640, 32]]],
  ];

  for (const [key, side, gaps] of measurementScenarios) {
    const observed = await measureTarget(client, key);
    assert.equal(observed.finePointer, true, "desktop browser must expose a fine hover pointer");
    assert.deepEqual(
      observed.active,
      gaps.map(([top, height]) => ({
        side,
        top,
        height,
        label: String(height),
        lineTop: top,
        lineHeight: height,
        labelCenter: top + height / 2,
      })),
      `${key} must render the correct ${side === "r" ? "right" : "left"}-side rulers`,
    );
    if (process.env.CAPTURE_MEASUREMENTS === "1") {
      const screenshot = await client.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      writeFileSync(`/tmp/homepage-measurement-${key}.png`, screenshot.data, "base64");
    }
  }

  const measurementState = await client.evaluate(`(async () => {
    const tags = document.querySelector(".tags");
    tags.tabIndex = -1;
    tags.focus();
    tags.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await new Promise(requestAnimationFrame);
    return {
      active: document.activeElement.className,
      compact: matchMedia("(max-width: 959px)").matches,
      pageClass: document.querySelector("#page").className,
      brackets: [...document.querySelectorAll(".bracket")].map((el) => ({
        id: el.id,
        on: el.classList.contains("on"),
        top: el.style.getPropertyValue("--gap-top"),
        height: el.style.getPropertyValue("--gap-h")
      }))
    };
  })()`);
  const measurement = measurementState.brackets;
  const activeLeft = measurement.filter((item) => item.on && item.id.startsWith("bracket-l"));
  assert.deepEqual(
    activeLeft.map(({ top, height }) => ({ top, height })),
    [{ top: "512", height: "32" }, { top: "576", height: "32" }],
    `tag rulers must use adjacent rows; observed ${JSON.stringify(measurementState)}`,
  );

  await client.send("Emulation.setEmulatedMedia", { features: [] });
  const accessibilityTree = await client.send("Accessibility.getFullAXTree");
  const accessibleText = accessibilityTree.nodes
    .map((node) => node.name?.value ?? "")
    .join(" ");
  assert.doesNotMatch(accessibleText, /0123456789/);

  console.log("browser verification passed");
  console.table(results.map((result) => ({
    viewport: result.width,
    layout: result.contentDisplay,
    root: result.rootFont,
    headline: result.headlineFont,
    body: result.bioFont,
    overflow: result.overflow,
  })));
} finally {
  client?.close();
  await Promise.all([stopChild(chrome), stopChild(preview)]);
  rmSync(PROFILE, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
