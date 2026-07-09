import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { extractLinks, extractCellLinks } from "../lib/links";
import { replaceLinks } from "../pages";
import type { Block } from "./builders";

export interface SeedPageArgs {
  parentId?: Id<"pages">;
  type?: "doc" | "db";
  title: string;
  icon?: string;
  coverKey?: string;
  props?: unknown;
  views?: unknown;
  isFavorite?: boolean;
  sortOrder: number;
}

export async function addPage(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  args: SeedPageArgs,
): Promise<Id<"pages">> {
  return await ctx.db.insert("pages", {
    workspaceId,
    parentId: args.parentId,
    type: args.type ?? "doc",
    title: args.title,
    searchTitle: args.title.toLowerCase(),
    inTrash: false,
    icon: args.icon,
    coverKey: args.coverKey,
    props: args.props,
    views: args.views,
    isFavorite: args.isFavorite,
    sortOrder: args.sortOrder,
    updatedAt: Date.now(),
  });
}

export async function setContent(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  pageId: Id<"pages">,
  blocks: Block[],
) {
  await ctx.db.patch(pageId, { content: blocks, updatedAt: Date.now() });
  await replaceLinks(ctx, workspaceId, "page", pageId, extractLinks(blocks));
}

export interface SeedEntryArgs {
  title: string;
  icon?: string;
  cells?: Record<string, unknown>;
  content?: Block[];
  sortOrder: number;
}

export async function addEntry(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  databaseId: Id<"pages">,
  relationPropIds: string[],
  args: SeedEntryArgs,
): Promise<Id<"entries">> {
  const id = await ctx.db.insert("entries", {
    databaseId,
    workspaceId,
    title: args.title,
    searchTitle: args.title.toLowerCase(),
    icon: args.icon,
    cells: args.cells ?? {},
    content: args.content,
    sortOrder: args.sortOrder,
    updatedAt: Date.now(),
  });
  const refs = [
    ...extractLinks(args.content),
    ...extractCellLinks(args.cells ?? {}, relationPropIds),
  ];
  await replaceLinks(ctx, workspaceId, "entry", id, refs);
  return id;
}

/** Relation cell snapshot value. */
export const rel = (
  type: "page" | "entry",
  id: string,
  title: string,
  icon = "",
) => [{ type, id, title, icon }];

export const rels = (...items: { type: "page" | "entry"; id: string; title: string; icon?: string }[]) =>
  items.map((item) => ({ icon: "", ...item }));
