import { useMemo } from "react";
import { Star, Clock, Plus, Dices } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { useQ, useM } from "../../lib/data";
import { useUI } from "../../lib/store";
import type { PageLite, WorkspaceDoc } from "../../lib/types";
import { timeAgo } from "../../lib/utils";
import { useRoller } from "../../lib/roller";

export function HomeView({ workspace }: { workspace: WorkspaceDoc }) {
  const ui = useUI();
  const pages = useQ(api.pages.tree, { workspaceId: workspace._id });
  const createPage = useM(api.pages.create);
  const roller = useRoller();

  const favorites = useMemo(
    () => ((pages ?? []) as PageLite[]).filter((p) => p.isFavorite).slice(0, 8),
    [pages],
  );
  const recent = useMemo(
    () => [...((pages ?? []) as PageLite[])].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 9),
    [pages],
  );

  const isDnd = workspace.mode === "dnd5e";

  return (
    <div className="page-scroller">
      <div className="page-body" style={{ paddingTop: 56 }}>
        <div style={{ fontSize: 52, lineHeight: 1 }}>{workspace.icon}</div>
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 40,
            fontWeight: 650,
            margin: "10px 0 2px",
          }}
        >
          {workspace.name}
        </h1>
        <div style={{ color: "var(--text-3)", fontFamily: "var(--font-display)", letterSpacing: "0.05em", fontSize: 13 }}>
          {workspace.tagline ?? (isDnd ? "D&D 5E (2024)" : "Daggerheart")}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 26, flexWrap: "wrap" }}>
          <button
            className="lf-btn primary"
            onClick={() =>
              void createPage({ workspaceId: workspace._id, type: "doc" }).then((id) =>
                ui.navigate(id as string),
              )
            }
          >
            <Plus size={14} /> New page
          </button>
          <button className="lf-btn outline" onClick={() => ui.setQuickSwitcher(true)}>
            Search everything
          </button>
          <button
            className="lf-btn outline"
            onClick={() =>
              isDnd ? roller.rollExpr("1d20", "d20") : roller.rollDualityDice(0, "normal", "Duality")
            }
          >
            <Dices size={14} style={{ color: "var(--accent2)" }} />
            {isDnd ? "Roll a d20" : "Duality roll"}
          </button>
        </div>

        {favorites.length > 0 && (
          <>
            <div className="backlinks-title" style={{ marginTop: 40 }}>
              <Star size={12} /> Favorites
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
              {favorites.map((page) => (
                <button
                  key={page._id}
                  className="db-card"
                  style={{ textAlign: "left" }}
                  onClick={() => ui.navigate(page._id)}
                >
                  <div className="card-body" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 20 }}>{page.icon ?? (page.type === "db" ? "🗃️" : "📄")}</span>
                    <span className="card-title">{page.title || "Untitled"}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="backlinks-title" style={{ marginTop: 34 }}>
          <Clock size={12} /> Recently edited
        </div>
        <div>
          {recent.map((page) => (
            <div
              key={page._id}
              className="lf-menu-item"
              style={{ padding: "7px 9px" }}
              onClick={() => ui.navigate(page._id)}
            >
              <span style={{ width: 22, textAlign: "center", fontSize: 15 }}>
                {page.icon ?? (page.type === "db" ? "🗃️" : "📄")}
              </span>
              <span style={{ flex: 1, fontWeight: 500 }}>{page.title || "Untitled"}</span>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{timeAgo(page.updatedAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
