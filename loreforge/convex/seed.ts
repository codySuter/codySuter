import { query, mutation } from "./_generated/server";
import { seedDnd } from "./seedData/dnd";
import { seedDaggerheart } from "./seedData/daggerheart";

/** Whether the starter worlds have been created (or intentionally skipped). */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const flag = await ctx.db
      .query("meta")
      .withIndex("by_key", (q) => q.eq("key", "seeded"))
      .unique();
    const workspaces = await ctx.db.query("workspaces").collect();
    return { seeded: flag !== null, workspaceCount: workspaces.length };
  },
});

/**
 * Create the two starter worlds (Emberfall for D&D 5E, The Withered Vale for
 * Daggerheart). Runs once — a meta flag prevents reseeding even if the user
 * later deletes the workspaces' contents.
 */
export const init = mutation({
  args: {},
  handler: async (ctx) => {
    const flag = await ctx.db
      .query("meta")
      .withIndex("by_key", (q) => q.eq("key", "seeded"))
      .unique();
    if (flag) return { seeded: false };
    await ctx.db.insert("meta", { key: "seeded", value: Date.now() });
    await seedDnd(ctx);
    await seedDaggerheart(ctx);
    return { seeded: true };
  },
});
