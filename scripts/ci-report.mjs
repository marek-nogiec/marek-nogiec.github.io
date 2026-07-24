import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIST_BUDGETS, verifyDist } from "./verify-dist.mjs";

const DEFAULT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPORT_MARKER = "<!-- homepage-ci-report -->";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const pass = (condition) => condition ? "✅" : "❌";

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function formatMetric(value, unit) {
  if (value === null) return "—";
  if (unit === "score") return `${Math.round(value * 100)}`;
  if (unit === "ms") return `${Math.round(value)} ms`;
  if (unit === "cls") return value.toFixed(3);
  if (unit === "bytes") return formatBytes(value);
  return String(value);
}

function formatMedianRange(values, unit) {
  const center = median(values);
  if (center === null) return "—";
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const formattedCenter = formatMetric(center, unit);
  if (minimum === maximum) return formattedCenter;
  return `${formattedCenter} (${formatMetric(minimum, unit)}–${formatMetric(maximum, unit)})`;
}

function assertionFor(config, id) {
  const assertion = config?.ci?.assert?.assertions?.[id];
  if (!Array.isArray(assertion)) return {};
  return assertion.find((entry) => typeof entry === "object") ?? {};
}

function loadLighthouse(root) {
  const directory = resolve(root, ".lighthouseci");
  const manifestPath = resolve(directory, "manifest.json");
  if (!existsSync(manifestPath)) return [];

  return readJson(manifestPath).flatMap((entry) => {
    const directPath = entry.jsonPath;
    const reportPath = directPath && existsSync(directPath)
      ? directPath
      : resolve(directory, basename(directPath ?? ""));
    return existsSync(reportPath) ? [readJson(reportPath)] : [];
  });
}

function workflowContext(env) {
  const repository = env.GITHUB_REPOSITORY;
  const server = env.GITHUB_SERVER_URL ?? "https://github.com";
  const sha = env.REPORT_SHA ?? env.GITHUB_SHA;
  const pieces = [];

  if (repository && env.GITHUB_RUN_ID) {
    pieces.push(`[Workflow run](${server}/${repository}/actions/runs/${env.GITHUB_RUN_ID})`);
  }
  if (repository && sha) {
    pieces.push(`commit [\`${sha.slice(0, 7)}\`](${server}/${repository}/commit/${sha})`);
  }
  return pieces.join(" · ");
}

function stepOutcome(label, value) {
  const normalized = value || "not reported";
  const icon = normalized === "success"
    ? "✅"
    : normalized === "skipped" || normalized === "not reported"
      ? "➖"
      : "❌";
  return `| ${label} | ${icon} ${normalized} |`;
}

export function buildCiReport({
  root = DEFAULT_ROOT,
  env = process.env,
} = {}) {
  const dist = verifyDist(resolve(root, "dist"));
  const lighthouse = loadLighthouse(root);
  const config = readJson(resolve(root, "lighthouserc.json"));
  const outcomes = [
    env.INSTALL_OUTCOME,
    env.VERIFY_OUTCOME,
    env.BROWSER_OUTCOME,
    env.LIGHTHOUSE_OUTCOME,
  ];
  const checksPassed = outcomes.every((outcome) => outcome === "success")
    && dist.failures.length === 0
    && lighthouse.length > 0;

  const lines = [
    REPORT_MARKER,
    "## Homepage CI report",
    "",
    checksPassed
      ? "✅ **All build, browser, Lighthouse, and budget checks passed.**"
      : "❌ **One or more CI checks failed or did not produce results.**",
  ];

  const context = workflowContext(env);
  if (context) lines.push("", context);

  lines.push(
    "",
    "### Checks",
    "",
    "| Check | Result |",
    "| --- | --- |",
    stepOutcome("Install locked dependencies", env.INSTALL_OUTCOME),
    stepOutcome("Build, static checks, size budgets, and unit tests", env.VERIFY_OUTCOME),
    stepOutcome("Cross-viewport browser verification", env.BROWSER_OUTCOME),
    stepOutcome("Lighthouse (3 runs)", env.LIGHTHOUSE_OUTCOME),
  );

  lines.push("", "### Production artifact budgets", "");
  if (dist.metrics) {
    const budgetRows = [
      ["HTML, raw", "raw"],
      ["HTML, gzip", "gzip"],
      ["HTML, Brotli", "brotli"],
      ["Space Grotesk subset", "font"],
      ["Cold transfer, gzip + font", "totalGzip"],
      ["Cold transfer, Brotli + font", "totalBrotli"],
    ];
    lines.push("| Metric | Actual | Budget | Result |", "| --- | ---: | ---: | :---: |");
    for (const [label, key] of budgetRows) {
      const actual = dist.metrics[key];
      const budget = DIST_BUDGETS[key];
      lines.push(`| ${label} | ${formatBytes(actual)} | ≤ ${formatBytes(budget)} | ${pass(actual <= budget)} |`);
    }
    lines.push(
      "",
      `Files: ${dist.metrics.files.map((file) => `\`${file}\``).join(", ")}`,
    );
  } else {
    lines.push("Production artifact metrics were unavailable.");
  }

  if (dist.failures.length > 0) {
    lines.push(
      "",
      "<details><summary>Artifact verification failures</summary>",
      "",
      ...dist.failures.map((failure) => `- ${failure}`),
      "",
      "</details>",
    );
  }

  lines.push("", `### Lighthouse — median of ${lighthouse.length} run${lighthouse.length === 1 ? "" : "s"}`, "");
  if (lighthouse.length > 0) {
    const categoryRows = [
      ["Performance", "performance"],
      ["Accessibility", "accessibility"],
      ["Best practices", "best-practices"],
      ["SEO", "seo"],
    ];
    lines.push("| Category | Median (range) | Budget | Result |", "| --- | ---: | ---: | :---: |");
    for (const [label, id] of categoryRows) {
      const values = lighthouse.map((report) => report.categories[id].score);
      const minimum = assertionFor(config, `categories:${id}`).minScore;
      const actual = median(values);
      lines.push(
        `| ${label} | ${formatMedianRange(values, "score")} | ≥ ${Math.round(minimum * 100)} | ${pass(actual >= minimum)} |`,
      );
    }

    const metricRows = [
      ["First Contentful Paint", "first-contentful-paint", "ms"],
      ["Largest Contentful Paint", "largest-contentful-paint", "ms"],
      ["Cumulative Layout Shift", "cumulative-layout-shift", "cls"],
      ["Total Blocking Time", "total-blocking-time", "ms"],
      ["Speed Index", "speed-index", "ms"],
      ["Time to Interactive", "interactive", "ms"],
      ["Lighthouse transfer size", "total-byte-weight", "bytes"],
    ];
    lines.push(
      "",
      "| Lab metric | Median (range) | Budget | Result |",
      "| --- | ---: | ---: | :---: |",
    );
    for (const [label, id, unit] of metricRows) {
      const values = lighthouse
        .map((report) => report.audits[id]?.numericValue)
        .filter(Number.isFinite);
      const actual = median(values);
      const maximum = assertionFor(config, id).maxNumericValue;
      const hasBudget = Number.isFinite(maximum);
      lines.push(
        `| ${label} | ${formatMedianRange(values, unit)} | ${hasBudget ? `≤ ${formatMetric(maximum, unit)}` : "—"} | ${hasBudget ? pass(actual <= maximum) : "ℹ️"} |`,
      );
    }

    const requiredAudits = [
      ["Button names", "button-name"],
      ["Color contrast", "color-contrast"],
      ["Meta description", "meta-description"],
    ];
    const auditResults = requiredAudits.map(([label, id]) => {
      const scores = lighthouse
        .map((report) => report.audits[id]?.score)
        .filter(Number.isFinite);
      return `${pass(scores.length > 0 && scores.every((score) => score === 1))} ${label}`;
    });
    lines.push(
      "",
      `Required audits: ${auditResults.join(" · ")}`,
      "",
      "_These are controlled Lighthouse lab measurements. INP is a field metric and is not available for a static navigation audit; TBT is shown as its lab responsiveness proxy._",
    );
  } else {
    lines.push("Lighthouse reports were unavailable.");
  }

  lines.push(
    "",
    "<sub>Generated from the checked-in budgets, build output, and in-run Lighthouse reports. This comment is updated in place.</sub>",
    "",
  );
  return lines.join("\n");
}

function main() {
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0
    ? resolve(process.argv[outputIndex + 1])
    : resolve(DEFAULT_ROOT, "ci-report.md");
  const report = buildCiReport();
  writeFileSync(outputPath, report);

  console.log(`CI report written to ${outputPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
