import { getCollection } from "astro:content";
import { byDateDesc } from "../lib/posts";

// Lightweight feed the portfolio (daniel.metzner.uk) fetches to show the latest
// entries. GitHub Pages serves with Access-Control-Allow-Origin: * so the
// cross-subdomain fetch works; we set it explicitly too for dev/preview.
export async function GET(context) {
  const posts = (await getCollection("posts", ({ data }) => !data.draft)).sort(byDateDesc);

  const items = posts.slice(0, 10).map((post) => ({
    title: post.data.title,
    description: post.data.description,
    pubDate: post.data.pubDate.toISOString(),
    tags: post.data.tags,
    url: new URL(`/posts/${post.id}/`, context.site).href,
  }));

  return new Response(JSON.stringify(items), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
