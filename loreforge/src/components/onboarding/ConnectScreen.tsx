import { useState } from "react";
import { Dices, Database, Sparkles, ArrowRight } from "lucide-react";

export function ConnectScreen({
  onConnect,
  onDemo,
  error,
}: {
  onConnect: (url: string) => void;
  onDemo: () => void;
  error?: string;
}) {
  const [url, setUrl] = useState("");
  const valid = /^https?:\/\/.+/.test(url.trim());

  return (
    <div className="onboarding" data-tauri-drag-region>
      <div className="app-drag" style={{ position: "fixed", top: 0, left: 0, right: 0, height: 40 }} />
      <div className="onboarding-card">
        <div className="flex items-center gap-3">
          <Dices size={30} style={{ color: "var(--accent2)" }} />
          <span className="onboarding-brand">Loreforge</span>
        </div>
        <p style={{ color: "var(--text-2)", marginTop: 10, lineHeight: 1.55, fontSize: 14.5 }}>
          A worldbuilding workspace for <b>D&amp;D 5E (2024)</b> and <b>Daggerheart</b> — pages,
          databases, wiki links, stat blocks, and dice, all yours.
        </p>

        {error && (
          <div
            style={{
              marginTop: 16,
              padding: "9px 12px",
              borderRadius: 8,
              background: "rgba(229,72,77,.12)",
              border: "1px solid rgba(229,72,77,.4)",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ marginTop: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 14 }}>
            <Database size={15} style={{ color: "var(--accent-text)" }} />
            Connect your Convex deployment
          </div>
          <p style={{ color: "var(--text-3)", fontSize: 13, margin: "6px 0 10px", lineHeight: 1.5 }}>
            Run <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>npm run dev</code> in the
            project folder once — the Convex CLI prints your deployment URL and writes it to{" "}
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>.env.local</code>. Paste it
            here if the app doesn't pick it up automatically.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="lf-input"
              placeholder="https://your-deployment.convex.cloud  ·  http://127.0.0.1:3210"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid) onConnect(url.trim());
              }}
            />
            <button className="lf-btn primary" disabled={!valid} onClick={() => onConnect(url.trim())}>
              Connect <ArrowRight size={14} />
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            margin: "22px 0",
            color: "var(--text-3)",
            fontSize: 12,
          }}
        >
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          or
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        <button
          className="lf-btn outline"
          style={{ width: "100%", justifyContent: "center", padding: "10px" }}
          onClick={onDemo}
        >
          <Sparkles size={15} style={{ color: "var(--accent2)" }} />
          Explore in demo mode
          <span style={{ color: "var(--text-3)", fontWeight: 400 }}>— in-memory, resets on quit</span>
        </button>
      </div>
    </div>
  );
}
