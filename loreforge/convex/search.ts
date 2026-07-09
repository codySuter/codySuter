import { query } from "./_generated/server";
import { v } from "convex/values";

/** Full-text search over page and entry titles for the quick switcher and @mentions. */
export const all = query({
  args: { workspaceId: v.id("workspaces"), q: v.string() },
  handler: async (ctx, args) => {
    const term = args.q.trim();
    if (term.length === 0) return { pages: [], entries: [] };
    const needle = term.toLowerCase();
    const pages = await ctx.db
      .query("pages")
      .withSearchIndex("search_title", (q) =>
        q.search("searchTitle", needle).eq("workspaceId", args.workspaceId).eq("inTrash", false),
      )
      .take(12);
    const entries = await ctx.db
      .query("entries")
      .withSearchIndex("search_title", (q) =>
        q.search("searchTitle", needle).eq("workspaceId", args.workspaceId),
      )
      .take(12);
    const pageResults = pages.map((p) => ({
      _id: p._id,
      title: p.title || "Untitled",
      icon: p.icon ?? null,
      type: p.type,
    }));
    return {
      pages: pageResults,
      entries: entries.map((e) => ({
        _id: e._id,
        databaseId: e.databaseId,
        title: e.title || "Untitled",
        icon: e.icon ?? null,
      })),
    };
  },
});
