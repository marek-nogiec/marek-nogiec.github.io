import { defineConfig } from "@rsbuild/core";

export default defineConfig({
  server: {
    // honor the harness-assigned port in sandboxed dev sessions
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
  },
  html: {
    template: "./src/index.html",
    // the page script queries the DOM directly, so it must run after the markup
    inject: "body",
  },
  output: {
    // production ships as a single self-contained HTML file
    inlineScripts: true,
    inlineStyles: true,
  },
});
