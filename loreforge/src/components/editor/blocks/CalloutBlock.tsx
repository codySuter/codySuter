import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { Popover } from "../../ui/Popover";

export const CALLOUT_VARIANTS: { id: string; label: string; icon: string }[] = [
  { id: "note", label: "Note", icon: "💡" },
  { id: "dm", label: "GM Secret", icon: "🎭" },
  { id: "quest", label: "Quest", icon: "📜" },
  { id: "treasure", label: "Treasure", icon: "💰" },
  { id: "danger", label: "Danger", icon: "⚠️" },
  { id: "lore", label: "Lore", icon: "🏛️" },
  { id: "hope", label: "Hope", icon: "🕯️" },
  { id: "fear", label: "Fear", icon: "🌑" },
];

export const CalloutBlock = createReactBlockSpec(
  {
    type: "callout" as const,
    propSchema: {
      variant: {
        default: "note",
        values: CALLOUT_VARIANTS.map((v) => v.id),
      },
    },
    content: "inline" as const,
  },
  {
    render: ({ block, editor, contentRef }) => {
      const [menu, setMenu] = useState<DOMRect | null>(null);
      const variant = CALLOUT_VARIANTS.find((v) => v.id === block.props.variant) ?? CALLOUT_VARIANTS[0];
      return (
        <div className="lf-callout" data-variant={block.props.variant}>
          <span
            className="callout-icon"
            contentEditable={false}
            title="Change callout type"
            onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
          >
            {variant.icon}
          </span>
          <div className="callout-content">
            <div className="callout-tag" contentEditable={false}>
              {variant.label}
            </div>
            <div ref={contentRef} />
          </div>
          {menu && (
            <Popover anchor={menu} onClose={() => setMenu(null)} width={190}>
              {CALLOUT_VARIANTS.map((v) => (
                <button
                  key={v.id}
                  className="lf-menu-item"
                  data-active={v.id === block.props.variant}
                  onClick={() => {
                    editor.updateBlock(block, { props: { variant: v.id } });
                    setMenu(null);
                  }}
                >
                  <span>{v.icon}</span> {v.label}
                </button>
              ))}
            </Popover>
          )}
        </div>
      );
    },
  },
);
