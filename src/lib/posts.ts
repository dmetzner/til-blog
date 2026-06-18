// Pure helpers shared by the pages and the JSON/RSS feeds. Kept free of
// `astro:content` imports so they're unit-testable in plain Vitest.

/** The slice of a content-collection entry these helpers actually read. */
export interface PostLike {
  id: string;
  body?: string;
  data: {
    title: string;
    description: string;
    pubDate: Date;
    tags: string[];
    draft?: boolean;
  };
}

/** Newest first. Stable for equal dates (id as tiebreaker → deterministic builds). */
export function byDateDesc(a: PostLike, b: PostLike): number {
  const diff = b.data.pubDate.getTime() - a.data.pubDate.getTime();
  return diff !== 0 ? diff : a.id.localeCompare(b.id);
}

/** "Jun 18, 2026" — the one date format used across the site. */
export function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** A URL/anchor-safe slug for a tag (so "C#" or "node.js" route cleanly). */
export function tagSlug(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Distinct tags with their post counts, sorted by count desc then name. */
export function tagCounts(posts: PostLike[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.data.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Posts carrying a tag whose slug matches `slug`, newest first. */
export function postsForTagSlug(posts: PostLike[], slug: string): PostLike[] {
  return posts.filter((p) => p.data.tags.some((t) => tagSlug(t) === slug)).sort(byDateDesc);
}

/** Estimated read time in whole minutes (min 1) at ~200 words/minute. */
export function readingMinutes(markdown: string): number {
  const words = markdown.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
