import type { Id } from "../../convex/_generated/dataModel";

export type Mode = "dnd5e" | "daggerheart";

export interface WorkspaceDoc {
  _id: Id<"workspaces">;
  name: string;
  mode: Mode;
  icon: string;
  tagline?: string;
  sortOrder: number;
}

export interface PageLite {
  _id: Id<"pages">;
  parentId: Id<"pages"> | null;
  type: "doc" | "db";
  title: string;
  icon: string | null;
  isFavorite: boolean;
  sortOrder: number;
  updatedAt: number;
}

export type PropType =
  | "text"
  | "number"
  | "select"
  | "multiSelect"
  | "checkbox"
  | "date"
  | "url"
  | "dice"
  | "relation";

export interface SelectOption {
  id: string;
  label: string;
  color: string;
}

export interface PropDef {
  id: string;
  name: string;
  type: PropType;
  options?: SelectOption[];
  width?: number;
}

export type ViewKind = "table" | "gallery" | "board";

export interface FilterDef {
  propId: string; // "title" allowed
  op: "contains" | "is" | "isNot" | "isEmpty" | "isNotEmpty";
  value?: string;
}

export interface ViewDef {
  id: string;
  name: string;
  kind: ViewKind;
  sortBy?: { key: string; dir: "asc" | "desc" } | null;
  filters?: FilterDef[];
  groupBy?: string;
  hidden?: string[];
}

export interface RelationValue {
  type: "page" | "entry";
  id: string;
  title: string;
  icon: string;
}

export type CellValue =
  | string
  | number
  | boolean
  | string[]
  | RelationValue[]
  | null
  | undefined;

export interface EntryDoc {
  _id: Id<"entries">;
  databaseId: Id<"pages">;
  workspaceId: Id<"workspaces">;
  title: string;
  icon?: string;
  cells: Record<string, CellValue>;
  content?: unknown;
  sortOrder: number;
  updatedAt: number;
}

export interface BacklinkItem {
  fromType: "page" | "entry";
  fromId: string;
  title: string;
  icon: string | null;
  databaseId?: string;
}

export const SELECT_COLORS = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;
