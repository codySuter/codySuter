import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Loreforge data model.
 *
 * - `workspaces` are top-level worlds, each locked to a game system ("mode").
 * - `pages` form the wiki tree. A page is either a document (`doc`) with
 *   BlockNote JSON content, or a database (`db`) with a property schema and
 *   views whose rows live in `entries`.
 * - `entries` are database rows. Every row is also a page of its own
 *   (Notion-style): it carries `cells` for its properties plus optional
 *   BlockNote `content`.
 * - `links` is the mention graph used for backlinks ("Mentioned in").
 * - `rolls` is the shared dice log.
 */
export default defineSchema({
  meta: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),

  workspaces: defineTable({
    name: v.string(),
    mode: v.union(v.literal("dnd5e"), v.literal("daggerheart")),
    icon: v.string(),
    tagline: v.optional(v.string()),
    sortOrder: v.number(),
  }),

  pages: defineTable({
    workspaceId: v.id("workspaces"),
    parentId: v.optional(v.id("pages")),
    type: v.union(v.literal("doc"), v.literal("db")),
    title: v.string(),
    searchTitle: v.optional(v.string()),
    icon: v.optional(v.string()),
    coverKey: v.optional(v.string()),
    coverStorageId: v.optional(v.id("_storage")),
    content: v.optional(v.any()),
    props: v.optional(v.any()),
    views: v.optional(v.any()),
    isFavorite: v.optional(v.boolean()),
    inTrash: v.optional(v.boolean()),
    trashedRoot: v.optional(v.boolean()),
    sortOrder: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_parent", ["workspaceId", "parentId"])
    .searchIndex("search_title", {
      searchField: "searchTitle",
      filterFields: ["workspaceId", "inTrash"],
    }),

  entries: defineTable({
    databaseId: v.id("pages"),
    workspaceId: v.id("workspaces"),
    title: v.string(),
    searchTitle: v.optional(v.string()),
    icon: v.optional(v.string()),
    coverStorageId: v.optional(v.id("_storage")),
    cells: v.any(),
    content: v.optional(v.any()),
    sortOrder: v.number(),
    updatedAt: v.number(),
  })
    .index("by_database", ["databaseId"])
    .index("by_workspace", ["workspaceId"])
    .searchIndex("search_title", {
      searchField: "searchTitle",
      filterFields: ["workspaceId"],
    }),

  links: defineTable({
    workspaceId: v.id("workspaces"),
    fromType: v.union(v.literal("page"), v.literal("entry")),
    fromId: v.string(),
    toType: v.union(v.literal("page"), v.literal("entry")),
    toId: v.string(),
  })
    .index("by_from", ["fromType", "fromId"])
    .index("by_to", ["toType", "toId"]),

  rolls: defineTable({
    workspaceId: v.id("workspaces"),
    label: v.optional(v.string()),
    expression: v.string(),
    kind: v.string(),
    total: v.number(),
    detail: v.any(),
    outcome: v.optional(v.string()),
  }).index("by_workspace", ["workspaceId"]),
});
