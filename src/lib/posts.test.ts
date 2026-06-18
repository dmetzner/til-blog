import { describe, expect, it } from "vitest";
import {
  byDateDesc,
  fmtDate,
  type PostLike,
  postsForTagSlug,
  readingMinutes,
  tagCounts,
  tagSlug,
} from "./posts";

const post = (id: string, pubDate: string, tags: string[] = []): PostLike => ({
  id,
  data: { title: id, description: "", pubDate: new Date(pubDate), tags },
});

describe("byDateDesc", () => {
  it("sorts newest first", () => {
    const sorted = [post("a", "2024-01-01"), post("b", "2026-01-01")].sort(byDateDesc);
    expect(sorted.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("breaks date ties by id for deterministic builds", () => {
    const sorted = [post("z", "2026-01-01"), post("a", "2026-01-01")].sort(byDateDesc);
    expect(sorted.map((p) => p.id)).toEqual(["a", "z"]);
  });
});

describe("fmtDate", () => {
  it("formats as 'Mon D, YYYY'", () => {
    expect(fmtDate(new Date("2026-06-18T12:00:00Z"))).toBe("Jun 18, 2026");
  });
});

describe("tagSlug", () => {
  it("lowercases and dash-separates non-alphanumerics", () => {
    expect(tagSlug("Node.js")).toBe("node-js");
    expect(tagSlug("C#")).toBe("c");
    expect(tagSlug("  Hello World  ")).toBe("hello-world");
  });
});

describe("tagCounts", () => {
  it("counts distinct tags, sorted by count then name", () => {
    const posts = [post("a", "2026-01-01", ["php", "til"]), post("b", "2026-01-02", ["php"])];
    expect(tagCounts(posts)).toEqual([
      { tag: "php", count: 2 },
      { tag: "til", count: 1 },
    ]);
  });
});

describe("postsForTagSlug", () => {
  it("returns matching posts newest first, slug-aware", () => {
    const posts = [
      post("old", "2024-01-01", ["Node.js"]),
      post("new", "2026-01-01", ["node.js"]),
      post("other", "2025-01-01", ["php"]),
    ];
    expect(postsForTagSlug(posts, "node-js").map((p) => p.id)).toEqual(["new", "old"]);
  });
});

describe("readingMinutes", () => {
  it("rounds words/200 to whole minutes", () => {
    expect(readingMinutes(Array(400).fill("word").join(" "))).toBe(2);
  });

  it("never returns less than 1 minute", () => {
    expect(readingMinutes("just a few words")).toBe(1);
    expect(readingMinutes("")).toBe(1);
  });
});
