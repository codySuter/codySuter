import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import type { TiptapDoc, TiptapNode } from "@/lib/types";
import { SECRET_BLOCK_NODE, WIKI_LINK_NODE } from "@/lib/entries/process";

interface RenderOptions {
  campaignId: string;
  /**
   * Map of entry id -> current title for every entry the *viewer* is allowed
   * to see. A wiki link whose target id is NOT in this map is rendered as inert
   * plain text — its href and id never reach the viewer.
   */
  visibleTitles: Map<string, string>;
  /** Editors see DM-only secret blocks; players never do. */
  showSecrets: boolean;
}

function renderMarks(text: string, marks: TiptapNode["marks"]): ReactNode {
  let node: ReactNode = text;
  if (!marks) return node;
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        node = <strong>{node}</strong>;
        break;
      case "italic":
        node = <em>{node}</em>;
        break;
      case "strike":
        node = <s>{node}</s>;
        break;
      case "code":
        node = <code>{node}</code>;
        break;
      case "link": {
        const href = (mark.attrs?.href as string) ?? "#";
        node = (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {node}
          </a>
        );
        break;
      }
      default:
        break;
    }
  }
  return node;
}

function renderChildren(nodes: TiptapNode[] | undefined, opts: RenderOptions): ReactNode {
  if (!nodes) return null;
  return nodes.map((child, i) => (
    <Fragment key={i}>{renderNode(child, opts)}</Fragment>
  ));
}

function renderNode(node: TiptapNode, opts: RenderOptions): ReactNode {
  switch (node.type) {
    case "text":
      return renderMarks(node.text ?? "", node.marks);

    case "paragraph":
      return <p>{renderChildren(node.content, opts)}</p>;

    case "heading": {
      const level = Number(node.attrs?.level ?? 2);
      const Tag = (`h${Math.min(Math.max(level, 1), 4)}` as "h1" | "h2" | "h3" | "h4");
      return <Tag>{renderChildren(node.content, opts)}</Tag>;
    }

    case "bulletList":
      return <ul>{renderChildren(node.content, opts)}</ul>;
    case "orderedList":
      return <ol>{renderChildren(node.content, opts)}</ol>;
    case "listItem":
      return <li>{renderChildren(node.content, opts)}</li>;

    case "blockquote":
      return <blockquote>{renderChildren(node.content, opts)}</blockquote>;

    case "codeBlock":
      return (
        <pre>
          <code>{renderChildren(node.content, opts)}</code>
        </pre>
      );

    case "hardBreak":
      return <br />;
    case "horizontalRule":
      return <hr />;

    case SECRET_BLOCK_NODE:
      // The crux of field-level secrecy: drop the whole block for players.
      if (!opts.showSecrets) return null;
      return <div className="secret-block">{renderChildren(node.content, opts)}</div>;

    case WIKI_LINK_NODE: {
      const id = node.attrs?.id as string | undefined;
      const cachedLabel = (node.attrs?.label as string) ?? "link";
      if (id && opts.visibleTitles.has(id)) {
        // Resolve to the *current* title so renames are reflected everywhere.
        const title = opts.visibleTitles.get(id)!;
        return (
          <Link href={`/c/${opts.campaignId}/e/${id}`} className="wiki-link">
            {title}
          </Link>
        );
      }
      // Target is hidden from this viewer (or unresolved): inert plain text.
      // No id / href is emitted.
      return <span className="wiki-link-hidden">{cachedLabel}</span>;
    }

    default:
      // doc and any unknown container: just render its children.
      return renderChildren(node.content, opts);
  }
}

/** Server component: render a Tiptap document to player-safe React. */
export function RenderBody({
  doc,
  ...opts
}: { doc: TiptapDoc | null } & RenderOptions) {
  if (!doc) return null;
  return <div className="prose-content">{renderNode(doc, opts)}</div>;
}
