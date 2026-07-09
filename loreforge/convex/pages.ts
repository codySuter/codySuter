import { query, mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { extractLinks } from "./lib/links";

/** Replace all outgoing links recorded for a page/entry with a fresh set. */
export async function replaceLinks(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  fromType: "page" | "entry",
  fromId: string,
  links: { toType: "page" | "entry"; toId: string }[],
) {
  const existing = await ctx.db
    .query("links")
    .withIndex("by_from", (q) => q.eq("fromType", fromType).eq("fromId", fromId))
    .collect();
  for (const link of existing) await ctx.db.delete(link._id);
  const seen = new Set<string>();
  for (const link of links) {
    const key = `${link.toType}:${link.toId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await ctx.db.insert("links", {
      workspaceId,
      fromType,
      fromId,
      toType: link.toType,
      toId: link.toId,
    });
  }
}

async function deleteLinksFor(ctx: MutationCtx, fromType: "page" | "entry", fromId: string) {
  const existing = await ctx.db
    .query("links")
    .withIndex("by_from", (q) => q.eq("fromType", fromType).eq("fromId", fromId))
    .collect();
  for (const link of existing) await ctx.db.delete(link._id);
  const incoming = await ctx.db
    .query("links")
    .withIndex("by_to", (q) => q.eq("toType", fromType).eq("toId", fromId))
    .collect();
  for (const link of incoming) await ctx.db.delete(link._id);
}

async function childrenOf(ctx: MutationCtx, workspaceId: Id<"workspaces">, parentId: Id<"pages">) {
  return await ctx.db
    .query("pages")
    .withIndex("by_parent", (q) => q.eq("workspaceId", workspaceId).eq("parentId", parentId))
    .collect();
}

/** Collect a page and all of its descendants (any trash state). */
async function collectSubtree(ctx: MutationCtx, root: Doc<"pages">): Promise<Doc<"pages">[]> {
  const result: Doc<"pages">[] = [root];
  const queue: Doc<"pages">[] = [root];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const kids = await childrenOf(ctx, current.workspaceId, current._id);
    for (const kid of kids) {
      result.push(kid);
      queue.push(kid);
    }
  }
  return result;
}

async function deleteEntriesOf(ctx: MutationCtx, databaseId: Id<"pages">) {
  const rows = await ctx.db
    .query("entries")
    .withIndex("by_database", (q) => q.eq("databaseId", databaseId))
    .collect();
  for (const row of rows) {
    await deleteLinksFor(ctx, "entry", row._id);
    if (row.coverStorageId) await ctx.storage.delete(row.coverStorageId).catch(() => {});
    await ctx.db.delete(row._id);
  }
}

/** Sidebar tree: every live page in the workspace, without heavy content. */
export const tree = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const pages = await ctx.db
      .query("pages")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    return pages
      .filter((p) => !p.inTrash)
      .map((p) => ({
        _id: p._id,
        parentId: p.parentId ?? null,
        type: p.type,
        title: p.title,
        icon: p.icon ?? null,
        isFavorite: p.isFavorite ?? false,
        sortOrder: p.sortOrder,
        updatedAt: p.updatedAt,
      }));
  },
});

export const get = query({
  args: { pageId: v.id("pages") },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page) return null;
    const coverUploadUrl = page.coverStorageId
      ? await ctx.storage.getUrl(page.coverStorageId)
      : null;
    return { ...page, coverUploadUrl };
  },
});

/** Breadcrumb chain from root to the page. */
export const breadcrumbs = query({
  args: { pageId: v.id("pages") },
  handler: async (ctx, args) => {
    const chain: { _id: Id<"pages">; title: string; icon: string | null }[] = [];
    let current = await ctx.db.get(args.pageId);
    let guard = 0;
    while (current && guard < 32) {
      chain.unshift({ _id: current._id, title: current.title, icon: current.icon ?? null });
      current = current.parentId ? await ctx.db.get(current.parentId) : null;
      guard++;
    }
    return chain;
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    parentId: v.optional(v.id("pages")),
    type: v.union(v.literal("doc"), v.literal("db")),
    title: v.optional(v.string()),
    icon: v.optional(v.string()),
    coverKey: v.optional(v.string()),
    content: v.optional(v.any()),
    props: v.optional(v.any()),
    views: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const siblings = args.parentId
      ? await ctx.db
          .query("pages")
          .withIndex("by_parent", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("parentId", args.parentId),
          )
          .collect()
      : await ctx.db
          .query("pages")
          .withIndex("by_parent", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("parentId", undefined),
          )
          .collect();
    const maxOrder = siblings.reduce((max, p) => Math.max(max, p.sortOrder), 0);
    const title = args.title ?? "";
    return await ctx.db.insert("pages", {
      workspaceId: args.workspaceId,
      parentId: args.parentId,
      type: args.type,
      title,
      searchTitle: title.toLowerCase(),
      icon: args.icon,
      coverKey: args.coverKey,
      content: args.content,
      props: args.props,
      views: args.views,
      inTrash: false,
      sortOrder: maxOrder + 1000,
      updatedAt: Date.now(),
    });
  },
});

export const rename = mutation({
  args: { pageId: v.id("pages"), title: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.pageId, {
      title: args.title,
      searchTitle: args.title.toLowerCase(),
      updatedAt: Date.now(),
    });
  },
});

export const setIcon = mutation({
  args: { pageId: v.id("pages"), icon: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.pageId, { icon: args.icon, updatedAt: Date.now() });
  },
});

export const setCover = mutation({
  args: {
    pageId: v.id("pages"),
    coverKey: v.optional(v.string()),
    coverStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page) return;
    if (page.coverStorageId && page.coverStorageId !== args.coverStorageId) {
      await ctx.storage.delete(page.coverStorageId).catch(() => {});
    }
    await ctx.db.patch(args.pageId, {
      coverKey: args.coverKey,
      coverStorageId: args.coverStorageId,
      updatedAt: Date.now(),
    });
  },
});

export const updateContent = mutation({
  args: {
    pageId: v.id("pages"),
    content: v.any(),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page) return;
    await ctx.db.patch(args.pageId, { content: args.content, updatedAt: Date.now() });
    await replaceLinks(ctx, page.workspaceId, "page", args.pageId, extractLinks(args.content));
  },
});

export const updateDbSchema = mutation({
  args: {
    pageId: v.id("pages"),
    props: v.optional(v.any()),
    views: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.props !== undefined) patch.props = args.props;
    if (args.views !== undefined) patch.views = args.views;
    await ctx.db.patch(args.pageId, patch);
  },
});

export const toggleFavorite = mutation({
  args: { pageId: v.id("pages") },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page) return;
    await ctx.db.patch(args.pageId, { isFavorite: !page.isFavorite });
  },
});

/** Move a page to a new parent and/or position. Guards against cycles. */
export const move = mutation({
  args: {
    pageId: v.id("pages"),
    parentId: v.optional(v.id("pages")),
    sortOrder: v.number(),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page) return;
    if (args.parentId) {
      if (args.parentId === args.pageId) return;
      // Walk up from the target parent; if we hit the page, it's a cycle.
      let cursor = await ctx.db.get(args.parentId);
      let guard = 0;
      while (cursor && guard < 64) {
        if (cursor._id === args.pageId) return;
        cursor = cursor.parentId ? await ctx.db.get(cursor.parentId) : null;
        guard++;
      }
    }
    await ctx.db.patch(args.pageId, {
      parentId: args.parentId,
      sortOrder: args.sortOrder,
    });
  },
});

export const moveToTrash = mutation({
  args: { pageId: v.id("pages") },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page) return;
    const subtree = await collectSubtree(ctx, page);
    for (const node of subtree) {
      await ctx.db.patch(node._id, {
        inTrash: true,
        trashedRoot: node._id === page._id,
        isFavorite: false,
      });
    }
  },
});

export const restore = mutation({
  args: { pageId: v.id("pages") },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page) return;
    const subtree = await collectSubtree(ctx, page);
    for (const node of subtree) {
      await ctx.db.patch(node._id, { inTrash: false, trashedRoot: undefined });
    }
    // If the restored page's parent is still in the trash, promote to root.
    if (page.parentId) {
      const parent = await ctx.db.get(page.parentId);
      if (!parent || parent.inTrash) {
        await ctx.db.patch(args.pageId, { parentId: undefined });
      }
    }
  },
});

export const deleteForever = mutation({
  args: { pageId: v.id("pages") },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page) return;
    const subtree = await collectSubtree(ctx, page);
    for (const node of subtree) {
      if (node.type === "db") await deleteEntriesOf(ctx, node._id);
      await deleteLinksFor(ctx, "page", node._id);
      if (node.coverStorageId) await ctx.storage.delete(node.coverStorageId).catch(() => {});
      await ctx.db.delete(node._id);
    }
  },
});

export const trashList = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const pages = await ctx.db
      .query("pages")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    return pages
      .filter((p) => p.inTrash && p.trashedRoot)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((p) => ({ _id: p._id, title: p.title, icon: p.icon ?? null, type: p.type }));
  },
});

export const duplicate = mutation({
  args: { pageId: v.id("pages") },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page) return null;
    const copyTitle = `${page.title || "Untitled"} (copy)`;
    const newId = await ctx.db.insert("pages", {
      workspaceId: page.workspaceId,
      parentId: page.parentId,
      type: page.type,
      title: copyTitle,
      searchTitle: copyTitle.toLowerCase(),
      inTrash: false,
      icon: page.icon,
      coverKey: page.coverKey,
      content: page.content,
      props: page.props,
      views: page.views,
      sortOrder: page.sortOrder + 1,
      updatedAt: Date.now(),
    });
    if (page.type === "db") {
      const rows = await ctx.db
        .query("entries")
        .withIndex("by_database", (q) => q.eq("databaseId", page._id))
        .collect();
      for (const row of rows) {
        await ctx.db.insert("entries", {
          databaseId: newId,
          workspaceId: row.workspaceId,
          title: row.title,
          searchTitle: row.title.toLowerCase(),
          icon: row.icon,
          cells: row.cells,
          content: row.content,
          sortOrder: row.sortOrder,
          updatedAt: Date.now(),
        });
      }
    }
    return newId;
  },
});

/** Recently edited pages for the quick switcher's empty state. */
export const recent = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const pages = await ctx.db
      .query("pages")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    return pages
      .filter((p) => !p.inTrash)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 12)
      .map((p) => ({ _id: p._id, title: p.title, icon: p.icon ?? null, type: p.type }));
  },
});

/** Backlinks: everything that mentions this page/entry. */
export const backlinks = query({
  args: {
    targetType: v.union(v.literal("page"), v.literal("entry")),
    targetId: v.string(),
  },
  handler: async (ctx, args) => {
    const incoming = await ctx.db
      .query("links")
      .withIndex("by_to", (q) => q.eq("toType", args.targetType).eq("toId", args.targetId))
      .collect();
    const results: {
      fromType: "page" | "entry";
      fromId: string;
      title: string;
      icon: string | null;
      databaseId?: string;
    }[] = [];
    for (const link of incoming) {
      if (link.fromType === "page") {
        const page = await ctx.db.get(link.fromId as Id<"pages">);
        if (page && !page.inTrash) {
          results.push({
            fromType: "page",
            fromId: link.fromId,
            title: page.title || "Untitled",
            icon: page.icon ?? null,
          });
        }
      } else {
        const entry = await ctx.db.get(link.fromId as Id<"entries">);
        if (entry) {
          results.push({
            fromType: "entry",
            fromId: link.fromId,
            title: entry.title || "Untitled",
            icon: entry.icon ?? null,
            databaseId: entry.databaseId,
          });
        }
      }
    }
    return results;
  },
});
