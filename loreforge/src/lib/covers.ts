export interface CoverPreset {
  id: string;
  name: string;
  css: string;
}

/** Layered CSS gradients that evoke painted book covers — no image assets needed. */
export const COVER_PRESETS: CoverPreset[] = [
  {
    id: "dragonfire",
    name: "Dragonfire",
    css: "radial-gradient(120% 90% at 15% 100%, rgba(255,171,64,.55) 0%, transparent 55%), radial-gradient(140% 100% at 85% 110%, rgba(224,57,46,.6) 0%, transparent 60%), linear-gradient(160deg, #2b0a0e 0%, #571b1b 45%, #93321f 80%, #d96b2f 100%)",
  },
  {
    id: "parchment",
    name: "Parchment",
    css: "radial-gradient(90% 70% at 20% 20%, rgba(255,255,255,.35) 0%, transparent 60%), radial-gradient(120% 90% at 80% 90%, rgba(140,102,58,.35) 0%, transparent 55%), linear-gradient(140deg, #e8d9b8 0%, #d9c49a 50%, #c2a878 100%)",
  },
  {
    id: "arcane",
    name: "Arcane",
    css: "radial-gradient(110% 80% at 80% 10%, rgba(167,139,250,.5) 0%, transparent 55%), radial-gradient(120% 100% at 15% 95%, rgba(56,189,248,.35) 0%, transparent 55%), linear-gradient(150deg, #140f2b 0%, #2b1c54 55%, #4c2d8f 100%)",
  },
  {
    id: "forest",
    name: "Deep Forest",
    css: "radial-gradient(120% 80% at 20% 0%, rgba(190,242,100,.28) 0%, transparent 55%), radial-gradient(120% 100% at 90% 100%, rgba(6,78,59,.8) 0%, transparent 60%), linear-gradient(150deg, #0c1f17 0%, #14532d 60%, #3f6212 100%)",
  },
  {
    id: "dungeon",
    name: "Dungeon Depths",
    css: "radial-gradient(100% 80% at 80% 15%, rgba(148,163,184,.25) 0%, transparent 50%), radial-gradient(140% 110% at 10% 100%, rgba(15,23,42,.9) 0%, transparent 65%), linear-gradient(160deg, #1e293b 0%, #0f172a 60%, #312e81 130%)",
  },
  {
    id: "night",
    name: "Starfall Night",
    css: "radial-gradient(2px 2px at 20% 30%, rgba(255,255,255,.9) 50%, transparent 51%), radial-gradient(2px 2px at 60% 15%, rgba(255,255,255,.8) 50%, transparent 51%), radial-gradient(1.5px 1.5px at 80% 45%, rgba(255,255,255,.7) 50%, transparent 51%), radial-gradient(1.5px 1.5px at 35% 60%, rgba(255,255,255,.6) 50%, transparent 51%), radial-gradient(2px 2px at 92% 70%, rgba(255,255,255,.65) 50%, transparent 51%), radial-gradient(120% 100% at 50% 120%, rgba(30,58,138,.8) 0%, transparent 60%), linear-gradient(180deg, #060819 0%, #101736 70%, #1e2a5e 100%)",
  },
  {
    id: "sea",
    name: "Sunken Sea",
    css: "radial-gradient(120% 90% at 70% 0%, rgba(103,232,249,.35) 0%, transparent 55%), radial-gradient(120% 100% at 20% 110%, rgba(8,51,68,.9) 0%, transparent 60%), linear-gradient(165deg, #082f49 0%, #0e7490 70%, #155e75 100%)",
  },
  {
    id: "veil",
    name: "The Gray Veil",
    css: "radial-gradient(110% 80% at 25% 10%, rgba(226,232,240,.25) 0%, transparent 55%), radial-gradient(130% 100% at 85% 100%, rgba(71,85,105,.6) 0%, transparent 60%), linear-gradient(150deg, #1f2430 0%, #3f4557 55%, #64708a 100%)",
  },
  {
    id: "ember",
    name: "Banked Embers",
    css: "radial-gradient(3px 3px at 25% 70%, rgba(251,146,60,.9) 50%, transparent 51%), radial-gradient(2px 2px at 65% 55%, rgba(251,191,36,.85) 50%, transparent 51%), radial-gradient(2.5px 2.5px at 85% 75%, rgba(248,113,113,.8) 50%, transparent 51%), radial-gradient(120% 100% at 50% 130%, rgba(154,52,18,.85) 0%, transparent 65%), linear-gradient(180deg, #17090b 0%, #340f10 60%, #6c1d16 100%)",
  },
  {
    id: "gold",
    name: "Gilded Hall",
    css: "radial-gradient(110% 80% at 75% 15%, rgba(253,224,71,.4) 0%, transparent 50%), radial-gradient(130% 100% at 15% 100%, rgba(120,53,15,.8) 0%, transparent 60%), linear-gradient(150deg, #2a1a05 0%, #7c5312 60%, #b98a2e 100%)",
  },
];

export function coverCss(coverKey: string | null | undefined): string | null {
  if (!coverKey) return null;
  if (coverKey.startsWith("url:")) {
    return `center / cover no-repeat url("${coverKey.slice(4)}")`;
  }
  const key = coverKey.startsWith("grad:") ? coverKey.slice(5) : coverKey;
  const preset = COVER_PRESETS.find((c) => c.id === key);
  return preset ? preset.css : null;
}
