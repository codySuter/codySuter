import { Link2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { useQ } from "../../lib/data";
import { useUI } from "../../lib/store";
import type { BacklinkItem } from "../../lib/types";

/** "Mentioned in" — World Anvil-style backlinks for a page or entry. */
export function BacklinksPanel({
  targetType,
  targetId,
}: {
  targetType: "page" | "entry";
  targetId: string;
}) {
  const ui = useUI();
  const backlinks = useQ(api.pages.backlinks, { targetType, targetId }) as BacklinkItem[] | undefined;

  if (!backlinks || backlinks.length === 0) return null;

  return (
    <div className="backlinks-panel">
      <div className="backlinks-title">
        <Link2 size={12} />
        Mentioned in {backlinks.length} place{backlinks.length === 1 ? "" : "s"}
      </div>
      <div>
        {backlinks.map((link) => (
          <button
            key={`${link.fromType}-${link.fromId}`}
            className="backlink-item"
            onClick={() => {
              if (link.fromType === "page") ui.navigate(link.fromId);
              else ui.openPeek({ entryId: link.fromId, databaseId: link.databaseId ?? "" });
            }}
          >
            <span>{link.icon ?? (link.fromType === "entry" ? "•" : "📄")}</span>
            {link.title}
          </button>
        ))}
      </div>
    </div>
  );
}
