import Mention from "@tiptap/extension-mention";
import { mergeAttributes } from "@tiptap/core";

/**
 * An in-world wiki link to another entry, triggered by typing `[[`.
 * The node stores the target entry's `id` (not its title) so links survive
 * renames; `label` is a cached display string and `entryType` aids icons.
 *
 * We deliberately render the *view* ourselves server-side (lib/entries/render.tsx)
 * rather than via Tiptap HTML, so this renderHTML only affects the editor.
 */
export const WikiLink = Mention.extend({
  name: "wikiLink",

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-id"),
        renderHTML: (attrs) => (attrs.id ? { "data-id": attrs.id } : {}),
      },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-label"),
        renderHTML: (attrs) => (attrs.label ? { "data-label": attrs.label } : {}),
      },
      entryType: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-type"),
        renderHTML: (attrs) => (attrs.entryType ? { "data-type": attrs.entryType } : {}),
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ class: "wiki-link" }, HTMLAttributes),
      `${node.attrs.label ?? "link"}`,
    ];
  },

  renderText({ node }) {
    return `${node.attrs.label ?? ""}`;
  },
});
