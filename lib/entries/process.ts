import type { TiptapDoc, TiptapNode } from "@/lib/types";

/** The Tiptap node name used for an in-world wiki link to another entry. */
export const WIKI_LINK_NODE = "wikiLink";
/** The Tiptap node name for a DM-only secret block. */
export const SECRET_BLOCK_NODE = "secretBlock";

function walk(node: TiptapNode | null | undefined, visit: (n: TiptapNode) => void) {
  if (!node) return;
  visit(node);
  if (node.content) for (const child of node.content) walk(child, visit);
}

/** Collect the target entry IDs of every wiki link in a document. */
export function extractLinkIds(doc: TiptapDoc | null | undefined): string[] {
  const ids = new Set<string>();
  walk(doc, (n) => {
    if (n.type === WIKI_LINK_NODE) {
      const id = n.attrs?.id;
      if (typeof id === "string" && id.length > 0) ids.add(id);
    }
  });
  return [...ids];
}

/**
 * Flatten a document to plaintext (used for editor-only full-text search).
 * Includes secret-block text since search is an editor feature.
 */
export function extractPlainText(doc: TiptapDoc | null | undefined): string {
  const parts: string[] = [];
  const blockTypes = new Set([
    "paragraph",
    "heading",
    "listItem",
    "blockquote",
    "codeBlock",
  ]);
  walk(doc, (n) => {
    if (typeof n.text === "string") parts.push(n.text);
    if (n.type === WIKI_LINK_NODE && typeof n.attrs?.label === "string") {
      parts.push(n.attrs.label as string);
    }
  });
  // Lightweight separation; exact formatting doesn't matter for search.
  void blockTypes;
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
