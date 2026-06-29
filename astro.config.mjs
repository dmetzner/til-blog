import { readdirSync, readFileSync } from "node:fs";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

// Draft posts are built (so they're reachable via ?preview) but must stay out of
// the sitemap — read their slugs from frontmatter at config time and filter them.
const POSTS_DIR = "src/content/posts";
const draftSlugs = readdirSync(POSTS_DIR)
  .filter((f) => f.endsWith(".md"))
  .filter((f) => /^draft:\s*true\s*$/m.test(readFileSync(`${POSTS_DIR}/${f}`, "utf8")))
  .map((f) => f.replace(/\.md$/, ""));

// Custom domain → base stays "/". The portfolio fetches /posts.json from here.
export default defineConfig({
  site: "https://til.metzner.uk",
  integrations: [
    sitemap({
      filter: (page) => !draftSlugs.some((slug) => page.includes(`/posts/${slug}/`)),
    }),
  ],
  // Prefetch links on hover → near-instant in-site navigation.
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
});
