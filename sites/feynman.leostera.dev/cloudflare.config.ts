import { defineConfig } from "cf/config";

// feynman.leostera.dev, the site's name before the rename to tsmodel: every request, explorer
// links (/s/...) included, moves for good to the same path and query on tsmodel.leostera.dev.
export default defineConfig({
  accountId: "0f436d2aabf1f872be90b8dd9d5715e6",
  worker: {
    name: "feynman-leostera-dev-redirect",
    compatibilityDate: "2026-10-23",
    entrypoint: "./worker/index.ts",
    domains: ["feynman.leostera.dev"],
    workersDev: false,
    previewUrls: false,
  },
});
