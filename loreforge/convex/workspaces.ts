import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("workspaces").collect();
    return all.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    mode: v.union(v.literal("dnd5e"), v.literal("daggerheart")),
    icon: v.string(),
    tagline: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("workspaces").collect();
    const maxOrder = all.reduce((max, w) => Math.max(max, w.sortOrder), 0);
    return await ctx.db.insert("workspaces", { ...args, sortOrder: maxOrder + 1000 });
  },
});

export const update = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.optional(v.string()),
    icon: v.optional(v.string()),
    tagline: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, string> = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.icon !== undefined) patch.icon = args.icon;
    if (args.tagline !== undefined) patch.tagline = args.tagline;
    await ctx.db.patch(args.workspaceId, patch);
  },
});
