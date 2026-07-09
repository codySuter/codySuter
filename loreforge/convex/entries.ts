import { query, mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { replaceLinks } from "./pages";
import { extractLinks, extractCellLinks, type LinkRef } from "./lib/links";

/** Recompute every outgoing link for an entry (content mentions + relation cells). */
async function syncEntryLinks(ctx: MutationCtx, entry: Doc<"entries">) {
  const db = await ctx.db.get(entry.databaseId);
  const props: { id: string; type: string }[] = Array.isArray(db?.props) ? db!.props : [];
  const relationIds = props.filter((p) => p.type === "relation").map((p) => p.id);
  const refs: LinkRef[] = [
    ...extractLinks(entry.content),
    ...extractCellLinks(entry.cells, relationIds),
  ];
  await replaceLinks(ctx, entry.workspaceId, "entry", entry._id, refs);
}

export const listByDatabase = query({
  args: { databaseId: v.id("pages") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("entries")
      .withIndex("by_database", (q) => q.eq("databaseId", args.databaseId))
      .collect();
    return rows.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

export const get = query({
  args: { entryId: v.id("entries") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.entryId);
  },
});

export const create = mutation({
  args: {
    databaseId: v.id("pages"),
    workspaceId: v.id("workspaces"),
    title: v.optional(v.string()),
    icon: v.optional(v.string()),
    cells: v.optional(v.any()),
    content: v.optional(v.any()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let order = args.sortOrder;
    if (order === undefined) {
      const rows = await ctx.db
        .query("entries")
        .withIndex("by_database", (q) => q.eq("databaseId", args.databaseId))
        .collect();
      order = rows.reduce((max, r) => Math.max(max, r.sortOrder), 0) + 1000;
    }
    const title = args.title ?? "";
    const id = await ctx.db.insert("entries", {
      databaseId: args.databaseId,
      workspaceId: args.workspaceId,
      title,
      searchTitle: title.toLowerCase(),
      icon: args.icon,
      cells: args.cells ?? {},
      content: args.content,
      sortOrder: order,
      updatedAt: Date.now(),
    });
    const entry = await ctx.db.get(id);
    if (entry) await syncEntryLinks(ctx, entry);
    return id;
  },
});

export const update = mutation({
  args: {
    entryId: v.id("entries"),
    title: v.optional(v.string()),
    icon: v.optional(v.string()),
    cells: v.optional(v.any()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) {
      patch.title = args.title;
      patch.searchTitle = args.title.toLowerCase();
    }
    if (args.icon !== undefined) patch.icon = args.icon;
    if (args.cells !== undefined) patch.cells = args.cells;
    if (args.sortOrder !== undefined) patch.sortOrder = args.sortOrder;
    await ctx.db.patch(args.entryId, patch);
    if (args.cells !== undefined) {
      const entry = await ctx.db.get(args.entryId);
      if (entry) await syncEntryLinks(ctx, entry);
    }
  },
});

/** Patch a single cell, preserving the rest (avoids clobbering concurrent edits). */
export const setCell = mutation({
  args: {
    entryId: v.id("entries"),
    propId: v.string(),
    value: v.any(),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry) return;
    const cells = { ...(entry.cells ?? {}) };
    if (args.value === null || args.value === undefined) {
      delete cells[args.propId];
    } else {
      cells[args.propId] = args.value;
    }
    await ctx.db.patch(args.entryId, { cells, updatedAt: Date.now() });
    const updated = await ctx.db.get(args.entryId);
    if (updated) await syncEntryLinks(ctx, updated);
  },
});

export const updateContent = mutation({
  args: {
    entryId: v.id("entries"),
    content: v.any(),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry) return;
    await ctx.db.patch(args.entryId, { content: args.content, updatedAt: Date.now() });
    const updated = await ctx.db.get(args.entryId);
    if (updated) await syncEntryLinks(ctx, updated);
  },
});

export const remove = mutation({
  args: { entryId: v.id("entries") },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry) return;
    const outgoing = await ctx.db
      .query("links")
      .withIndex("by_from", (q) => q.eq("fromType", "entry").eq("fromId", args.entryId))
      .collect();
    for (const link of outgoing) await ctx.db.delete(link._id);
    const incoming = await ctx.db
      .query("links")
      .withIndex("by_to", (q) => q.eq("toType", "entry").eq("toId", args.entryId))
      .collect();
    for (const link of incoming) await ctx.db.delete(link._id);
    if (entry.coverStorageId) await ctx.storage.delete(entry.coverStorageId).catch(() => {});
    await ctx.db.delete(args.entryId);
  },
});
