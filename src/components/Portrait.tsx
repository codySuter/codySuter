import { useState } from "react";
import { cn } from "../lib/cn";

interface PortraitProps {
  imageUrl?: string;
  emoji?: string;
  name: string;
  className?: string;
  /** emoji font size class */
  emojiClass?: string;
}

/** Character portrait: shows the image if present and loadable, else the emoji.
 *  Uses `var(--accent)` (set by the card's data-faction) for the ring. */
export function Portrait({ imageUrl, emoji, name, className, emojiClass }: PortraitProps) {
  const [failed, setFailed] = useState(false);
  const showImage = imageUrl && !failed;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-slate-950/60",
        className,
      )}
      style={{ borderColor: "var(--accent-border)" }}
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt={name}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={cn("select-none leading-none", emojiClass ?? "text-3xl")}>
          {emoji || "❔"}
        </span>
      )}
    </div>
  );
}
