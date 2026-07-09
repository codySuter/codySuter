/**
 * Terse builders for BlockNote document JSON, used by the seed worlds.
 * They produce the exact shapes the editor loads (full blocks with ids).
 */

export type Inline = Record<string, unknown>;
export type Block = Record<string, unknown>;

export const uid = () => crypto.randomUUID();

// ---------- inline content ----------

export const t = (text: string, styles: Record<string, unknown> = {}): Inline => ({
  type: "text",
  text,
  styles,
});
export const b = (text: string): Inline => t(text, { bold: true });
export const i = (text: string): Inline => t(text, { italic: true });
export const bi = (text: string): Inline => t(text, { bold: true, italic: true });
export const code = (text: string): Inline => t(text, { code: true });

export const link = (href: string, text: string): Inline => ({
  type: "link",
  href,
  content: [t(text)],
});

export const mention = (
  targetType: "page" | "entry",
  targetId: string,
  label: string,
  icon = "",
): Inline => ({
  type: "mention",
  props: { targetType, targetId, label, icon },
});

export const dice = (expr: string, label = ""): Inline => ({
  type: "dice",
  props: { expr, label },
});

const inline = (content: string | Inline | (string | Inline)[]): Inline[] => {
  const list = Array.isArray(content) ? content : [content];
  return list.map((item) => (typeof item === "string" ? t(item) : item));
};

// ---------- blocks ----------

export const blk = (
  type: string,
  props: Record<string, unknown> = {},
  content?: unknown,
  children: Block[] = [],
): Block => ({
  id: uid(),
  type,
  props,
  ...(content !== undefined ? { content } : {}),
  children,
});

export const p = (content: string | Inline | (string | Inline)[] = ""): Block =>
  blk("paragraph", {}, inline(content));

export const h = (level: 1 | 2 | 3, content: string | Inline | (string | Inline)[]): Block =>
  blk("heading", { level }, inline(content));

export const quote = (content: string | Inline | (string | Inline)[]): Block =>
  blk("quote", {}, inline(content));

export const bullet = (
  content: string | Inline | (string | Inline)[],
  children: Block[] = [],
): Block => blk("bulletListItem", {}, inline(content), children);

export const num = (content: string | Inline | (string | Inline)[]): Block =>
  blk("numberedListItem", {}, inline(content));

export const check = (content: string | Inline | (string | Inline)[], checked = false): Block =>
  blk("checkListItem", { checked }, inline(content));

export const toggle = (
  content: string | Inline | (string | Inline)[],
  children: Block[],
): Block => blk("toggleListItem", {}, inline(content), children);

export const divider = (): Block => blk("divider", {});

export const table = (header: string[], rows: (string | Inline | (string | Inline)[])[][]): Block =>
  blk("table", {}, {
    type: "tableContent",
    // null (not undefined): Convex documents can't contain undefined values.
    columnWidths: header.map(() => null),
    headerRows: 1,
    rows: [
      { cells: header.map((cell) => inline([b(cell)])) },
      ...rows.map((row) => ({ cells: row.map((cell) => inline(cell)) })),
    ],
  });

export type CalloutVariant =
  | "note"
  | "dm"
  | "quest"
  | "treasure"
  | "danger"
  | "lore"
  | "hope"
  | "fear";

export const callout = (
  variant: CalloutVariant,
  content: string | Inline | (string | Inline)[],
  children: Block[] = [],
): Block => blk("callout", { variant }, inline(content), children);

// ---------- TTRPG data blocks (props.data carries JSON) ----------

const dataBlock = (type: string, data: unknown, extraProps: Record<string, unknown> = {}): Block =>
  blk(type, { data: JSON.stringify(data), ...extraProps });

export interface StatblockData {
  name: string;
  meta: string;
  ac: string;
  hp: string;
  hpFormula?: string;
  speed: string;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  saves?: string;
  skills?: string;
  resistances?: string;
  immunities?: string;
  vulnerabilities?: string;
  senses?: string;
  languages?: string;
  cr: string;
  traits?: { name: string; text: string }[];
  actions?: { name: string; text: string }[];
  bonusActions?: { name: string; text: string }[];
  reactions?: { name: string; text: string }[];
  legendary?: { name: string; text: string }[];
}
export const statblock = (data: StatblockData) => dataBlock("statblock", data);

export interface AdversaryData {
  name: string;
  tier: number;
  role: string;
  description: string;
  motives?: string;
  difficulty: number;
  thresholds: string;
  hp: number;
  stress: number;
  atk?: string;
  weapon?: string;
  range?: string;
  damage?: string;
  experience?: string;
  features?: { name: string; type: string; text: string }[];
}
export const adversary = (data: AdversaryData) => dataBlock("adversary", data);

export interface RollTableData {
  title: string;
  die: string;
  rows: { min: number; max: number; text: string }[];
}
export const rollTable = (data: RollTableData) => dataBlock("rollTable", data);

export interface TrackerItem {
  id?: string;
  name: string;
  kind: "hp" | "stress" | "hope" | "fear" | "armor" | "custom";
  current: number;
  max: number;
}
export const tracker = (title: string, items: TrackerItem[]) =>
  dataBlock("tracker", { title, items: items.map((item) => ({ id: uid(), ...item })) });

export interface AbilityCardData {
  name: string;
  kind: string;
  subtitle?: string;
  stats?: { label: string; value: string }[];
  text: string;
  flavor?: string;
}
export const abilityCard = (data: AbilityCardData) => dataBlock("abilityCard", data);

export interface CombatantData {
  id?: string;
  name: string;
  init: number;
  hp: number;
  maxHp: number;
  ac?: string;
  isPC?: boolean;
  conditions?: string[];
  note?: string;
}
export const encounter = (
  title: string,
  combatants: CombatantData[],
  useInitiative = true,
) =>
  dataBlock("encounter", {
    title,
    round: 1,
    activeIndex: 0,
    useInitiative,
    combatants: combatants.map((c) => ({ id: uid(), conditions: [], ...c })),
  });

export interface TimelineEvent {
  id?: string;
  date: string;
  title: string;
  text?: string;
  targetType?: "page" | "entry";
  targetId?: string;
  targetLabel?: string;
}
export interface TimelineEra {
  id?: string;
  name: string;
  color?: string;
  events: TimelineEvent[];
}
export const timeline = (title: string, eras: TimelineEra[]) =>
  dataBlock("timeline", {
    title,
    eras: eras.map((era) => ({
      id: uid(),
      color: era.color ?? "gold",
      ...era,
      events: era.events.map((event) => ({ id: uid(), ...event })),
    })),
  });

export interface MapPin {
  id?: string;
  x: number;
  y: number;
  label: string;
  color?: string;
  targetType?: "page" | "entry";
  targetId?: string;
}
export const mapBlock = (title: string, pins: MapPin[], url = "") =>
  dataBlock("map", { title, pins: pins.map((pin) => ({ id: uid(), color: "gold", ...pin })) }, { url });
