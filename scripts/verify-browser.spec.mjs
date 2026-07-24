import { expect, test } from "@playwright/test";

const PAGE_PATH = "/";
const VIEWPORT_HEIGHT = 900;
const FORCE_FOCUS_MEASUREMENTS = process.env.FORCE_FOCUS_MEASUREMENTS === "1";
const browserErrors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  browserErrors.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    errors.push(`page: ${error.message}`);
  });
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), "browser console and page errors").toEqual([]);
});

function parseRgb(value) {
  const channels = value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  expect(channels, `could not parse color: ${value}`).toHaveLength(3);
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

async function loadPage(page, width = 1440) {
  await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
  const response = await page.goto(PAGE_PATH, { waitUntil: "load" });
  expect(response?.ok(), `${width}px document request must succeed`).toBe(true);
  await page.waitForFunction(() => document.fonts.status === "loaded");
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator(
    "[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay",
  )).toHaveCount(0);
}

async function loadViewport(page, width) {
  const requestUrls = [];
  const recordRequest = (request) => requestUrls.push(request.url());
  page.on("request", recordRequest);

  try {
    await loadPage(page, width);
  } finally {
    page.off("request", recordRequest);
  }

  await expect(page.locator("main h2")).toHaveCount(1);
  await expect(page.locator("main h3")).toHaveCount(1);
  await expect(page.locator("main footer")).toHaveCount(1);
  await expect(page.locator("#theme-toggle")).toHaveAttribute(
    "aria-label",
    /^(?:Light|Dark) theme; switch to (?:light|dark) theme$/,
  );

  const rulerCount = await page.locator(".ruler").count();
  expect(rulerCount).toBeGreaterThan(0);
  expect(
    await page.locator(".ruler").evaluateAll(
      (rulers) => rulers.every((ruler) => ruler.getAttribute("aria-hidden") === "true"),
    ),
  ).toBe(true);

  const metrics = await page.evaluate(() => {
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    return {
      width: innerWidth,
      rootFont: parseFloat(style("html").fontSize),
      bioFont: parseFloat(style(".bio").fontSize),
      headlineFont: parseFloat(style(".headline").fontSize),
      contentDisplay: style(".content").display,
      overflow: document.documentElement.scrollWidth
        - document.documentElement.clientWidth,
    };
  });

  const bioRect = await page.locator(".bio").boundingBox();
  expect(bioRect, `${width}px bio must have a rendered box`).not.toBeNull();

  const targets = {
    handle: page.locator(".handle").first(),
    theme: page.locator(".theme-toggle"),
    project: page.locator(".project-card").first(),
    live: page.locator(".live-link").first(),
  };
  for (const [name, locator] of Object.entries(targets)) {
    const box = await locator.boundingBox();
    expect(box, `${name} must have a rendered box at ${width}px`).not.toBeNull();
    expect(box.height, `${name} target is below 24px at ${width}px`).toBeGreaterThanOrEqual(24);
  }

  const externalRequests = requestUrls.filter((url) => {
    if (!url.startsWith("http")) return false;
    return new URL(url).origin !== new URL(page.url()).origin;
  });
  expect(externalRequests, `${width}px viewport made cross-origin requests`).toEqual([]);

  const fontRequests = requestUrls.filter((url) => url.endsWith(".woff2"));
  expect(fontRequests, `expected one local font request at ${width}px`).toHaveLength(1);
  expect(new URL(fontRequests[0]).origin).toBe(new URL(page.url()).origin);

  if (process.env.CAPTURE_SCREENSHOTS === "1" && [390, 960, 1440].includes(width)) {
    await page.screenshot({
      path: `/tmp/homepage-browser-${width}.png`,
      animations: "disabled",
    });
  }

  return { ...metrics, bioRect };
}

async function measureTarget(page, key, index = 0) {
  const target = page.locator(`[data-m="${key}"]`).nth(index);
  await expect(target, `missing measurement target: ${key}[${index}]`).toBeAttached();

  const finePointer = !FORCE_FOCUS_MEASUREMENTS
    && await page.evaluate(
      () => matchMedia("(hover: hover) and (pointer: fine)").matches,
    );

  if (finePointer) {
    await target.hover();
  } else {
    await target.evaluate((element) => {
      element.tabIndex = -1;
    });
    await target.focus();
  }
  await page.evaluate(() => new Promise(requestAnimationFrame));

  const active = await page.locator(".bracket.on").evaluateAll((brackets) => {
    const dialValue = (bracket) => [...bracket.querySelectorAll(".dial .strip")]
      .map((strip) => {
        const match = strip.style.transform.match(/translateY\((-?\d+(?:\.\d+)?)%\)/);
        return match ? Math.round(Math.abs(Number(match[1])) / 10) : "?";
      })
      .join("");

    return brackets.map((bracket) => {
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
        labelCenter: Math.round(
          labelRect.top + labelRect.height / 2 - rulerRect.top,
        ),
      };
    });
  });

  return { interaction: finePointer ? "pointer" : "focus", active };
}

test("responsive layout, semantics, targets, and requests", async ({ page }) => {
  const widths = [390, 959, 960, 1024, 1199, 1200, 1440];
  const results = [];

  for (const width of widths) {
    const result = await test.step(`${width}px viewport`, () => loadViewport(page, width));
    expect(result.overflow, `${width}px viewport has horizontal overflow`).toBeLessThanOrEqual(0);
    expect(result.bioFont, `${width}px bio text is below 14px`).toBeGreaterThanOrEqual(14);
    if (width >= 960) {
      expect(
        result.bioRect.height,
        `${width}px bio exceeds its three-row grid area`,
      ).toBeLessThanOrEqual(96);
    }
    results.push(result);
  }

  const compactEdge = results.find((result) => result.width === 959);
  const desktopEdge = results.find((result) => result.width === 960);
  expect(compactEdge.contentDisplay).toBe("block");
  expect(desktopEdge.contentDisplay).toBe("grid");
  expect(
    Math.abs(compactEdge.bioFont - desktopEdge.bioFont),
    "body type jumps at 959/960px",
  ).toBeLessThanOrEqual(0.5);
  expect(
    Math.abs(compactEdge.headlineFont - desktopEdge.headlineFont),
    "headline jumps at 959/960px",
  ).toBeLessThanOrEqual(0.5);

  console.table(results.map((result) => ({
    viewport: result.width,
    layout: result.contentDisplay,
    root: result.rootFont,
    headline: result.headlineFont,
    body: result.bioFont,
    overflow: result.overflow,
  })));
});

test("theme control, persistence, and contrast", async ({ page }) => {
  await loadPage(page);

  for (const theme of ["light", "dark"]) {
    const colors = await test.step(`${theme} theme contrast`, () => page.evaluate(
      (selectedTheme) => {
        document.documentElement.dataset.theme = selectedTheme;
        const body = getComputedStyle(document.body);
        return {
          background: body.backgroundColor,
          colors: [".section-label", ".tags", ".footer"].map(
            (selector) => getComputedStyle(document.querySelector(selector)).color,
          ),
        };
      },
      theme,
    ));
    for (const color of colors.colors) {
      expect(
        contrast(color, colors.background),
        `${theme} contrast failed: ${color}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }

  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
    localStorage.removeItem("theme");
  });

  const themeButton = page.locator("#theme-toggle");
  await themeButton.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(themeButton).toHaveAttribute("aria-pressed", "true");
  await expect(themeButton).toHaveAttribute(
    "aria-label",
    "Dark theme; switch to light theme",
  );
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");

  await page.reload({ waitUntil: "load" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(themeButton).toHaveAttribute("aria-pressed", "true");
});

test("reduced motion disables decorative transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loadPage(page);

  const durations = await page.locator([
    ".grid-overlay",
    ".bracket",
    ".bracket .b-line",
    ".dial .strip",
  ].join(",")).evaluateAll(
    (elements) => elements.map((element) => getComputedStyle(element).transitionDuration),
  );
  expect(durations.length).toBeGreaterThan(0);
  for (const duration of durations) {
    expect(duration).toBe("0s");
  }
});

test("measurement rulers follow rendered row adjacency", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loadPage(page);

  const scenarios = [
    ["headline", "l", [[32, 32], [128, 192]]],
    ["gHeadProj", "l", [[128, 192]]],
    ["projects", "l", [[128, 192], [352, 32]]],
    ["gNavSub", "r", [[32, 64]]],
    ["sub", "r", [[32, 64], [128, 64]]],
    ["gSubBio", "r", [[128, 64]]],
    ["bio", "r", [[128, 64], [288, 320]]],
    ["gBioPage", "r", [[288, 320]]],
    ["pageinfo", "r", [[288, 320], [640, 32]]],
  ];

  for (const [key, side, gaps] of scenarios) {
    const observed = await test.step(`${key} ruler`, () => measureTarget(page, key));
    expect(
      observed.active,
      `${key} must render the correct ${side === "r" ? "right" : "left"}-side rulers`,
    ).toEqual(gaps.map(([top, height]) => ({
      side,
      top,
      height,
      label: String(height),
      lineTop: top,
      lineHeight: height,
      labelCenter: top + height / 2,
    })));

    if (process.env.CAPTURE_MEASUREMENTS === "1") {
      await page.screenshot({
        path: `/tmp/homepage-measurement-${key}.png`,
        animations: "disabled",
      });
    }
  }

  const tags = page.locator(".tags");
  await tags.evaluate((element) => {
    element.tabIndex = -1;
  });
  await tags.focus();
  await page.evaluate(() => new Promise(requestAnimationFrame));

  const measurementState = await page.evaluate(() => ({
    active: document.activeElement.className,
    compact: matchMedia("(max-width: 959px)").matches,
    pageClass: document.querySelector("#page").className,
    brackets: [...document.querySelectorAll(".bracket")].map((element) => ({
      id: element.id,
      on: element.classList.contains("on"),
      top: element.style.getPropertyValue("--gap-top"),
      height: element.style.getPropertyValue("--gap-h"),
    })),
  }));
  const activeLeft = measurementState.brackets.filter(
    (item) => item.on && item.id.startsWith("bracket-l"),
  );
  expect(
    activeLeft.map(({ top, height }) => ({ top, height })),
    `tag rulers must use adjacent rows; observed ${JSON.stringify(measurementState)}`,
  ).toEqual([
    { top: "512", height: "32" },
    { top: "576", height: "32" },
  ]);
});

test("measurement digits stay out of the accessibility tree", async ({ page }) => {
  await loadPage(page);

  const beforeMeasurement = await page.ariaSnapshot();
  await measureTarget(page, "headline");
  const afterMeasurement = await page.ariaSnapshot();

  expect(afterMeasurement).toBe(beforeMeasurement);
});
