import { readFileSync } from "node:fs";

import { defineConfig } from "@rsbuild/core";

const copy = JSON.parse(
  readFileSync(new URL("./src/content/en.json", import.meta.url), "utf8"),
);

const preloadSubsetFont = {
  name: "preload-subset-font",
  setup(api) {
    api.modifyHTMLTags(({ headTags, bodyTags }, { assetPrefix, compilation }) => {
      const fontAssets = compilation
        .getAssets()
        .map(({ name }) => name)
        .filter((name) => name.endsWith(".woff2"));

      if (fontAssets.length !== 1) {
        throw new Error(`expected one emitted WOFF2 asset, found ${fontAssets.length}`);
      }

      headTags.unshift({
        tag: "link",
        attrs: {
          rel: "preload",
          href: `${assetPrefix}${fontAssets[0]}`,
          as: "font",
          type: "font/woff2",
          crossorigin: "",
        },
      });

      return { headTags, bodyTags };
    });
  },
};

export default defineConfig({
  plugins: [preloadSubsetFont],
  dev: {
    // The catalog is read by the config rather than imported into the browser
    // graph, so editing copy needs a config/server reload during development.
    watchFiles: {
      paths: "./src/content/*.json",
      type: "reload-server",
    },
  },
  server: {
    // honor the harness-assigned port in sandboxed dev sessions
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
  },
  html: {
    template: "./src/index.html",
    // All user-facing copy is resolved into the static HTML at build time.
    templateParameters: { copy },
    // the page script queries the DOM directly, so it must run after the markup
    inject: "body",
    scriptLoading: "blocking",
  },
  output: {
    // CSS and JS stay inline; the tiny font stays external for independent
    // caching. Keep it external even if a future subset falls below 4 KiB.
    cleanDistPath: true,
    assetPrefix: "./",
    dataUriLimit: 0,
    inlineScripts: true,
    inlineStyles: true,
    distPath: {
      font: "./",
    },
    filename: {
      font: "space-grotesk.[contenthash:8][ext]",
    },
  },
});
