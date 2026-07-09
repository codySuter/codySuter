import { useState } from "react";
import { createReactInlineContentSpec } from "@blocknote/react";
import { Dices } from "lucide-react";
import { useEditorEnv } from "../EditorEnv";

/** Clickable dice chip: [⚄ 2d6+3 → 11] */
export const DiceInline = createReactInlineContentSpec(
  {
    type: "dice",
    propSchema: {
      expr: { default: "1d20" },
      label: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ inlineContent }) => <DiceChip expr={inlineContent.props.expr} label={inlineContent.props.label} />,
  },
);

export function DiceChip({ expr, label }: { expr: string; label: string }) {
  const env = useEditorEnv();
  const [result, setResult] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);
  return (
    <span
      className={`lf-dice-chip${rolling ? " rolling" : ""}`}
      title={label ? `${label}: click to roll ${expr}` : `Click to roll ${expr}`}
      contentEditable={false}
      onClick={(e) => {
        e.stopPropagation();
        const rolled = env.roller.rollExpr(expr, label || undefined);
        if (rolled) {
          setResult(rolled.total);
          setRolling(true);
          setTimeout(() => setRolling(false), 500);
        }
      }}
    >
      <Dices size={12} />
      {label ? `${label} ` : ""}
      {expr}
      {result !== null && <span className="dice-result">{result}</span>}
    </span>
  );
}

/** @mention chip linking to a page or database entry. */
export const MentionInline = createReactInlineContentSpec(
  {
    type: "mention",
    propSchema: {
      targetType: { default: "page" },
      targetId: { default: "" },
      label: { default: "" },
      icon: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ inlineContent }) => {
      const { targetType, targetId, label, icon } = inlineContent.props;
      return <MentionChip targetType={targetType as "page" | "entry"} targetId={targetId} label={label} icon={icon} />;
    },
  },
);

export function MentionChip({
  targetType,
  targetId,
  label,
  icon,
}: {
  targetType: "page" | "entry";
  targetId: string;
  label: string;
  icon: string;
}) {
  const env = useEditorEnv();
  return (
    <span
      className="lf-mention"
      contentEditable={false}
      title={targetType === "page" ? "Open page" : "Open entry"}
      onClick={(e) => {
        e.stopPropagation();
        if (!targetId) return;
        if (targetType === "page") env.navigate(targetId);
        else env.openEntry(targetId, "");
      }}
    >
      {icon && <span className="mention-icon">{icon}</span>}
      <span style={{ textDecoration: "underline", textDecorationColor: "color-mix(in srgb, var(--accent) 35%, transparent)", textUnderlineOffset: 2 }}>
        {label || "Untitled"}
      </span>
    </span>
  );
}
