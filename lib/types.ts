// Shared domain types. These mirror the Postgres schema in
// supabase/migrations/0001_init.sql.

export type AppRole = "dm" | "co_dm" | "player";
export type Visibility = "dm_only" | "players";

export type FieldType = "text" | "textarea" | "number" | "select" | "url";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: string[];
  required?: boolean;
}

/** A minimal Tiptap/ProseMirror JSON node. */
export interface TiptapNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}
export type TiptapDoc = TiptapNode;

export interface EntryType {
  id: string;
  campaign_id: string | null;
  key: string;
  label: string;
  icon: string | null;
  field_schema: FieldDef[];
  body_template: TiptapDoc | null;
  sort_order: number;
}

export interface Entry {
  id: string;
  campaign_id: string;
  type: string;
  title: string;
  slug: string | null;
  visibility: Visibility;
  fields: Record<string, unknown>;
  body: TiptapDoc | null;
  body_text: string;
  ddb_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
}

export interface CampaignMember {
  id: number;
  campaign_id: string;
  user_id: string;
  role: AppRole;
  created_at: string;
}

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface Attachment {
  id: string;
  campaign_id: string;
  entry_id: string | null;
  storage_path: string;
  kind: string;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface Invite {
  id: string;
  campaign_id: string;
  email: string;
  role: AppRole;
  token: string;
  accepted_at: string | null;
  created_at: string;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  dm: "Dungeon Master",
  co_dm: "Co-DM",
  player: "Player",
};

/** Editors (full read/write) vs players (read-only, revealed-only). */
export function isEditorRole(role: AppRole | null | undefined): boolean {
  return role === "dm" || role === "co_dm";
}
