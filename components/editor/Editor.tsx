"use client";

import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  EyeOff,
} from "lucide-react";
import { WikiLink } from "./wiki-link";
import { SecretBlock } from "./secret-block";
import { makeWikiSuggestion } from "./suggestion";
import { cn } from "@/lib/utils";
import type { TiptapDoc } from "@/lib/types";

interface Props {
  campaignId: string;
  initialContent: TiptapDoc | null;
  onChange: (json: TiptapDoc) => void;
}

function TBtn({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-surface-2",
        active ? "bg-primary/20 text-text" : "text-muted",
      )}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: TiptapEditor }) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1.5">
      <TBtn
        title="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={16} />
      </TBtn>
      <TBtn
        title="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={16} />
      </TBtn>
      <span className="mx-1 h-5 w-px bg-line" />
      <TBtn
        title="Heading"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 size={16} />
      </TBtn>
      <TBtn
        title="Subheading"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 size={16} />
      </TBtn>
      <TBtn
        title="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={16} />
      </TBtn>
      <TBtn
        title="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={16} />
      </TBtn>
      <TBtn
        title="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={16} />
      </TBtn>
      <span className="mx-1 h-5 w-px bg-line" />
      <TBtn
        title="DM-only secret block (hidden from players)"
        active={editor.isActive("secretBlock")}
        onClick={() => editor.chain().focus().toggleWrap("secretBlock").run()}
      >
        <EyeOff size={16} />
      </TBtn>
      <span className="ml-auto pr-1 text-xs text-muted">
        Type <kbd className="rounded bg-surface-2 px-1">[[</kbd> to link
      </span>
    </div>
  );
}

export function Editor({ campaignId, initialContent, onChange }: Props) {
  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit,
        SecretBlock,
        WikiLink.configure({ suggestion: makeWikiSuggestion(campaignId) }),
      ],
      content: initialContent ?? { type: "doc", content: [{ type: "paragraph" }] },
      editorProps: {
        attributes: { class: "tiptap min-h-[320px] focus:outline-none" },
      },
      onUpdate: ({ editor }) => onChange(editor.getJSON() as TiptapDoc),
    },
    [campaignId],
  );

  if (!editor) return <div className="min-h-[360px] rounded-lg border border-line bg-surface" />;

  return (
    <div className="rounded-lg border border-line bg-surface">
      <Toolbar editor={editor} />
      <div className="px-4 py-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
