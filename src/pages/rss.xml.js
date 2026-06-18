import { getCollection } from "astro:content";
import rss from "@astrojs/rss";
import { config } from "../config";
import { byDateDesc } from "../lib/posts";

export async function GET(context) {
  const posts = (await getCollection("posts", ({ data }) => !data.draft)).sort(byDateDesc);

  return rss({
    title: "TIL — Daniel Metzner",
    description: config.tagline.en,
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/posts/${post.id}/`,
      categories: post.data.tags,
    })),
  });
}
