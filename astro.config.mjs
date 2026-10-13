import { readdirSync, readFileSync } from "node:fs";
import { satteri } from "@astrojs/markdown-satteri";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

// Draft posts are built (so they're reachable via ?preview) but must stay out of
// the sitemap — read their slugs from frontmatter at config time and filter them.
const POSTS_DIR = "src/content/posts";
const draftSlugs = readdirSync(POSTS_DIR)
  .filter((f) => f.endsWith(".md"))
  .filter((f) => /^draft:\s*true\s*$/m.test(readFileSync(`${POSTS_DIR}/${f}`, "utf8")))
  .map((f) => f.replace(/\.md$/, ""));

// github-dark's comment grey (#6A737D) is 3.0:1 on its #24292E background; swap it
// for #8B949E (4.8:1) so commented code clears WCAG AA.
const readableComments = {
  span(node) {
    const style = node.properties.style;
    if (typeof style === "string") node.properties.style = style.replace(/#6A737D/gi, "#8B949E");
  },
};

// Wide tables scroll sideways inside .table-scroll; keyboard users need it focusable
// (tabindex) and screen readers need it named (role + label) to reach the overflow.
const scrollableTables = {
  name: "scrollable-tables",
  element: {
    filter: ["table"],
    visit(node, ctx) {
      ctx.wrapNode(node, {
        type: "element",
        tagName: "div",
        properties: {
          className: ["table-scroll"],
          tabIndex: 0,
          role: "region",
          ariaLabel: "Table (scrolls sideways)",
        },
        children: [],
      });
    },
  },
};

// Custom domain → base stays "/". The portfolio fetches /posts.json from here.
export default defineConfig({
  site: "https://til.metzner.uk",
  // GitHub Pages 301s /2 → /2/; emit the slashed form everywhere (pagination, canonical).
  trailingSlash: "always",
  markdown: {
    shikiConfig: { transformers: [readableComments] },
    processor: satteri({ hastPlugins: [scrollableTables] }),
  },
  integrations: [
    sitemap({
      filter: (page) => !draftSlugs.some((slug) => page.includes(`/posts/${slug}/`)),
    }),
  ],
  // Prefetch links on hover → near-instant in-site navigation.
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
});
