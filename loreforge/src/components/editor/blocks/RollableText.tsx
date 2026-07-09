import { Fragment } from "react";
import { useEditorEnv } from "../EditorEnv";

const DICE_RE = /(\b\d*d\d+(?:\s*[+−-]\s*\d+)?\b|(?:Attack Roll:|to hit[,:]?)\s*[+−-]\d+|\bDC\s+\d+\b)/gi;

/**
 * Renders prose with dice expressions and attack bonuses turned into
 * click-to-roll spans — the D&D Beyond trick, applied everywhere.
 */
export function RollableText({ text, label }: { text: string; label?: string }) {
  const env = useEditorEnv();
  const parts = text.split(DICE_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        const dcMatch = /^DC\s+(\d+)$/i.exec(part.trim());
        if (dcMatch) {
          return (
            <b key={i} style={{ color: "var(--accent-text)" }}>
              {part}
            </b>
          );
        }
        const attack = /(?:Attack Roll:|to hit[,:]?)\s*([+−-]\d+)/i.exec(part);
        const expr = attack
          ? `1d20${attack[1].replace("−", "-")}`
          : part.replace(/\s+/g, "").replace("−", "-");
        return (
          <span
            key={i}
            className="lf-dice-chip"
            style={{ fontSize: "0.82em" }}
            onClick={(e) => {
              e.stopPropagation();
              env.roller.rollExpr(expr, label);
            }}
            title={`Roll ${expr}`}
          >
            {part.trim()}
          </span>
        );
      })}
    </>
  );
}
