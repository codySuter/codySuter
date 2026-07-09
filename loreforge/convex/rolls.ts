import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const KEEP = 250;

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const rolls = await ctx.db
      .query("rolls")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(100);
    return rolls;
  },
});

export const log = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    label: v.optional(v.string()),
    expression: v.string(),
    kind: v.string(),
    total: v.number(),
    detail: v.any(),
    outcome: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("rolls", args);
    // Prune history beyond the retention window.
    const all = await ctx.db
      .query("rolls")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .collect();
    for (const roll of all.slice(KEEP)) {
      await ctx.db.delete(roll._id);
    }
    return id;
  },
});

export const clear = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("rolls")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const roll of all) await ctx.db.delete(roll._id);
  },
});
