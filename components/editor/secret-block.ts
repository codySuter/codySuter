import { Node, mergeAttributes } from "@tiptap/core";

/**
 * A DM-only secret block. In the editor it shows with a dashed "DM ONLY"
 * callout. On the player-facing view it is stripped entirely server-side
 * (see lib/entries/render.tsx). Toggle it from the toolbar with
 * `editor.chain().focus().toggleWrap("secretBlock").run()`.
 */
export const SecretBlock = Node.create({
  name: "secretBlock",
  group: "block",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-secret-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-secret-block": "true",
        class: "secret-block",
      }),
      0,
    ];
  },
});
