"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { setVisibility } from "@/actions/entries";
import { cn } from "@/lib/utils";
import type { Visibility } from "@/lib/types";

export function RevealToggle({
  entryId,
  campaignId,
  visibility,
}: {
  entryId: string;
  campaignId: string;
  visibility: Visibility;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const toggle = () => {
    const next: Visibility = visibility === "players" ? "dm_only" : "players";
    start(async () => {
      await setVisibility(entryId, campaignId, next);
      router.refresh();
    });
  };

  const revealed = visibility === "players";
  return (
    <button
      onClick={toggle}
      disabled={pending}
      title={revealed ? "Players can see this — click to hide" : "Hidden from players — click to reveal"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm",
        revealed
          ? "border-accent/40 bg-accent/15 text-text"
          : "border-line bg-surface text-muted hover:text-text",
      )}
    >
      {revealed ? <Eye size={14} /> : <EyeOff size={14} />}
      {revealed ? "Revealed" : "Hidden"}
    </button>
  );
}
