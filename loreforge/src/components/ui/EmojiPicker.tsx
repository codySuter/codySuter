import { useState } from "react";
import { Popover } from "./Popover";
import { EMOJI_GROUPS, randomEmoji } from "../../lib/emoji";
import { Shuffle, X } from "lucide-react";

export function EmojiPicker({
  anchor,
  onClose,
  onPick,
  onClear,
}: {
  anchor: DOMRect;
  onClose: () => void;
  onPick: (emoji: string) => void;
  onClear?: () => void;
}) {
  const [filter, setFilter] = useState("");
  const groups = filter
    ? [
        {
          name: "Results",
          emoji: EMOJI_GROUPS.flatMap((g) => g.emoji).filter(() => true),
        },
      ]
    : EMOJI_GROUPS;

  return (
    <Popover anchor={anchor} onClose={onClose} width={332}>
      <div style={{ display: "flex", gap: 6, padding: "4px 4px 8px" }}>
        <input
          autoFocus
          className="lf-input"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ fontSize: 13, padding: "4px 8px" }}
        />
        <button
          className="lf-icon-btn"
          title="Random"
          onClick={() => {
            onPick(randomEmoji());
            onClose();
          }}
        >
          <Shuffle size={14} />
        </button>
        {onClear && (
          <button
            className="lf-icon-btn"
            title="Remove icon"
            onClick={() => {
              onClear();
              onClose();
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {groups.map((group) => (
        <div key={group.name}>
          <div className="lf-menu-label">{group.name}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", padding: "0 4px 6px" }}>
            {group.emoji.map((emoji, i) => (
              <button
                key={`${emoji}-${i}`}
                style={{ fontSize: 18, padding: "3px 0", borderRadius: 6 }}
                className="hover:bg-(--hover)"
                onClick={() => {
                  onPick(emoji);
                  onClose();
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Popover>
  );
}
