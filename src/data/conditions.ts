import {
  Ban,
  BatteryLow,
  Brain,
  EarOff,
  EyeOff,
  FlaskConical,
  Ghost,
  Grab,
  Heart,
  Link,
  Moon,
  Mountain,
  MoveDown,
  Sparkles,
  VenetianMask,
  Zap,
  type LucideIcon,
} from "lucide-react";
import rawConditions from "./srd-conditions.json";

export interface ConditionMeta {
  name: string;
  icon: LucideIcon;
  /** two-letter fallback used when an icon can't be shown */
  abbr: string;
  desc: string;
}

const DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  (rawConditions as Array<{ name: string; desc: string }>).map((c) => [c.name, c.desc]),
);

interface Spec {
  name: string;
  icon: LucideIcon;
  abbr: string;
}

const SPECS: Spec[] = [
  { name: "Blinded", icon: EyeOff, abbr: "Bl" },
  { name: "Charmed", icon: Heart, abbr: "Ch" },
  { name: "Deafened", icon: EarOff, abbr: "De" },
  { name: "Exhaustion", icon: BatteryLow, abbr: "Ex" },
  { name: "Frightened", icon: Ghost, abbr: "Fr" },
  { name: "Grappled", icon: Grab, abbr: "Gr" },
  { name: "Incapacitated", icon: Ban, abbr: "In" },
  { name: "Invisible", icon: VenetianMask, abbr: "Iv" },
  { name: "Paralyzed", icon: Zap, abbr: "Pa" },
  { name: "Petrified", icon: Mountain, abbr: "Pt" },
  { name: "Poisoned", icon: FlaskConical, abbr: "Po" },
  { name: "Prone", icon: MoveDown, abbr: "Pr" },
  { name: "Restrained", icon: Link, abbr: "Re" },
  { name: "Stunned", icon: Sparkles, abbr: "St" },
  { name: "Unconscious", icon: Moon, abbr: "Un" },
  { name: "Concentrating", icon: Brain, abbr: "Co" },
];

export const CONDITIONS: ConditionMeta[] = SPECS.map((s) => ({
  name: s.name,
  icon: s.icon,
  abbr: s.abbr,
  desc:
    DESCRIPTIONS[s.name] ??
    (s.name === "Concentrating"
      ? "Maintaining concentration on a spell. Taking damage forces a Constitution save (DC 10 or half the damage, whichever is higher)."
      : ""),
}));

export const CONDITION_BY_NAME: Record<string, ConditionMeta> = Object.fromEntries(
  CONDITIONS.map((c) => [c.name, c]),
);
