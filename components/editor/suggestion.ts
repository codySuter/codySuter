import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import tippy, { type GetReferenceClientRect, type Instance } from "tippy.js";
import { SuggestionList, type SuggestionListRef } from "./SuggestionList";
import { searchEntries } from "@/actions/entries";

/**
 * Builds the `[[` autocomplete behaviour for the WikiLink node. Queries entries
 * by title (RLS-scoped server action), renders a floating list, and on select
 * inserts a wikiLink node carrying the target entry's id.
 */
export function makeWikiSuggestion(
  campaignId: string,
): Omit<SuggestionOptions, "editor"> {
  return {
    char: "[[",
    allowSpaces: true,
    allowedPrefixes: null,

    items: async ({ query }) => await searchEntries(campaignId, query),

    command: ({ editor, range, props }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: "wikiLink", attrs: props },
          { type: "text", text: " " },
        ])
        .run();
    },

    render: () => {
      let component: ReactRenderer<SuggestionListRef> | null = null;
      let popup: Instance | null = null;

      return {
        onStart: (props) => {
          component = new ReactRenderer(SuggestionList, {
            props: { ...props, campaignId },
            editor: props.editor,
          });
          if (!props.clientRect) return;
          popup = tippy(document.body, {
            getReferenceClientRect:
              props.clientRect as GetReferenceClientRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
          });
        },
        onUpdate: (props) => {
          component?.updateProps({ ...props, campaignId });
          if (props.clientRect && popup) {
            popup.setProps({
              getReferenceClientRect:
                props.clientRect as GetReferenceClientRect,
            });
          }
        },
        onKeyDown: (props) => {
          if (props.event.key === "Escape") {
            popup?.hide();
            return true;
          }
          return component?.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          popup?.destroy();
          component?.destroy();
          popup = null;
          component = null;
        },
      };
    },
  };
}
