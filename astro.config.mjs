import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

// Custom domain → base stays "/". The portfolio fetches /posts.json from here.
export default defineConfig({
  site: "https://til.metzner.uk",
  integrations: [sitemap()],
  // Prefetch links on hover → near-instant in-site navigation.
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
});
