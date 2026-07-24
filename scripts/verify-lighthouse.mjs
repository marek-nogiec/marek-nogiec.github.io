import {
  accessSync,
  constants as fsConstants,
  existsSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

function packageBin(packageName, binName) {
  const packagePath = require.resolve(`${packageName}/package.json`);
  const manifest = require(packagePath);
  const relativePath = typeof manifest.bin === "string"
    ? manifest.bin
    : manifest.bin?.[binName];

  if (!relativePath) {
    throw new Error(`${packageName} does not expose the ${binName} executable`);
  }
  return resolve(dirname(packagePath), relativePath);
}

function playwrightShellDirectory() {
  const playwrightBin = packageBin("playwright", "playwright");
  const dryRun = spawnSync(process.execPath, [
    playwrightBin,
    "install",
    "--dry-run",
    "--only-shell",
    "chromium",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });

  if (dryRun.status !== 0) {
    throw new Error(
      `Playwright could not resolve Chromium headless shell:\n${dryRun.stderr || dryRun.stdout}`,
    );
  }

  const match = dryRun.stdout.match(
    /Chrome Headless Shell[\s\S]*?^\s*Install location:\s+(.+)$/m,
  );
  if (!match) {
    throw new Error("Playwright did not report a Chromium headless-shell install location");
  }
  return match[1].trim();
}

function findShell(directory) {
  const executableNames = new Set(
    process.platform === "win32"
      ? ["chrome-headless-shell.exe"]
      : ["chrome-headless-shell", "headless_shell"],
  );
  const matches = [];

  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (executableNames.has(entry.name)) matches.push(path);
    }
  }

  if (!existsSync(directory)) {
    throw new Error(
      "Playwright's Chromium headless shell is not installed; "
      + "run `npm run browser:install` first",
    );
  }
  visit(directory);

  if (matches.length !== 1) {
    throw new Error(
      `expected one Chromium headless-shell executable in ${directory}, `
      + `found ${matches.length}: ${JSON.stringify(matches)}`,
    );
  }

  accessSync(
    matches[0],
    process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
  );
  return matches[0];
}

const chromePath = findShell(playwrightShellDirectory());
const chromeVersion = spawnSync(chromePath, ["--version"], {
  encoding: "utf8",
});
if (chromeVersion.status !== 0) {
  throw new Error(
    `Chromium headless shell could not start:\n${chromeVersion.stderr || chromeVersion.stdout}`,
  );
}

console.log(`Lighthouse browser: ${chromeVersion.stdout.trim()} (${chromePath})`);

const lhciBin = packageBin("@lhci/cli", "lhci");
const lhciArgs = [
  lhciBin,
  "autorun",
  "--config=./lighthouserc.json",
];

if (process.platform === "linux" && process.env.GITHUB_ACTIONS === "true") {
  lhciArgs.push("--collect.settings.chromeFlags=--no-sandbox");
  console.log("Lighthouse browser sandbox: disabled for the GitHub Actions runner");
}

const lhci = spawn(process.execPath, lhciArgs, {
  cwd: ROOT,
  env: {
    ...process.env,
    CHROME_PATH: chromePath,
  },
  stdio: "inherit",
});

lhci.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
lhci.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
