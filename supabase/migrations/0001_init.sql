-- ============================================================================
-- D&D Campaign Wiki — initial schema, RLS, triggers, helpers, seed data
-- ----------------------------------------------------------------------------
-- Permission model (multi-campaign):
--   * Each campaign has members with a role: dm | co_dm | player.
--   * dm/co_dm  = "editors": full read/write within their campaign.
--   * player    = read-only, and may ONLY read entries whose visibility is
--                 'players'. New entries default to 'dm_only' (hidden).
--   * Enforcement lives in Row Level Security here — the database, not the UI,
--     is the boundary. A player cannot fetch a hidden entry even via raw API.
-- ============================================================================

-- Extensions ----------------------------------------------------------------
create extension if not exists pgcrypto;

-- Enums ---------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('dm', 'co_dm', 'player');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.entry_visibility as enum ('dm_only', 'players');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- TABLES
-- ============================================================================

-- Profiles: 1:1 with auth.users, created by trigger on signup.
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- Campaigns / worlds. Creator becomes the dm (via trigger below).
create table if not exists public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_by  uuid not null default auth.uid() references auth.users (id),
  created_at  timestamptz not null default now()
);

-- Per-campaign membership + role. This is the heart of the permission model.
create table if not exists public.campaign_members (
  id          bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.app_role not null,
  created_at  timestamptz not null default now(),
  unique (campaign_id, user_id)
);
create index if not exists campaign_members_user_idx on public.campaign_members (user_id);
create index if not exists campaign_members_campaign_idx on public.campaign_members (campaign_id);

-- Invites: gate who may join a campaign and as what role.
create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  email       text not null,
  role        public.app_role not null,
  token       text not null unique,
  invited_by  uuid references auth.users (id),
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists invites_campaign_idx on public.invites (campaign_id);

-- Entry types: the registry that powers templates + extensibility.
-- campaign_id NULL  => built-in global type, available to every campaign.
-- campaign_id set   => a custom type owned by that campaign.
create table if not exists public.entry_types (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid references public.campaigns (id) on delete cascade,
  key           text not null,
  label         text not null,
  icon          text,
  field_schema  jsonb not null default '[]'::jsonb,
  body_template jsonb,
  sort_order    int not null default 0
);
-- Unique keys: globally for built-ins, and per-campaign for custom types.
create unique index if not exists entry_types_global_key_idx
  on public.entry_types (key) where campaign_id is null;
create unique index if not exists entry_types_campaign_key_idx
  on public.entry_types (campaign_id, key) where campaign_id is not null;

-- Entries: the single core content table for ALL content types.
create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  type        text not null,
  title       text not null,
  slug        text,
  visibility  public.entry_visibility not null default 'dm_only',
  fields      jsonb not null default '{}'::jsonb,
  body        jsonb,                       -- Tiptap document JSON
  body_text   text not null default '',    -- denormalised plaintext (editor search)
  ddb_url     text,                        -- D&D Beyond link (character type)
  created_by  uuid default auth.uid() references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists entries_campaign_idx on public.entries (campaign_id);
create index if not exists entries_campaign_type_idx on public.entries (campaign_id, type);
create index if not exists entries_visibility_idx on public.entries (visibility);
create index if not exists entries_updated_idx on public.entries (updated_at desc);
create index if not exists entries_fields_gin on public.entries using gin (fields);
create unique index if not exists entries_slug_idx
  on public.entries (campaign_id, type, slug) where slug is not null;

-- Resolved wiki-link edges (by ID, so they survive renames) -> backlinks.
create table if not exists public.entry_links (
  id               bigint generated always as identity primary key,
  source_entry_id  uuid not null references public.entries (id) on delete cascade,
  target_entry_id  uuid not null references public.entries (id) on delete cascade,
  created_at       timestamptz not null default now(),
  unique (source_entry_id, target_entry_id)
);
create index if not exists entry_links_source_idx on public.entry_links (source_entry_id);
create index if not exists entry_links_target_idx on public.entry_links (target_entry_id);

-- Attachments: uploaded images, primarily maps. Files live in Storage; this
-- row is the access-controlled handle. Images are served via signed URLs that
-- the server mints only after this row passes RLS for the requesting user.
create table if not exists public.attachments (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.campaigns (id) on delete cascade,
  entry_id     uuid references public.entries (id) on delete cascade,
  storage_path text not null,
  kind         text not null default 'image',  -- 'map' | 'image'
  width        int,
  height       int,
  created_by   uuid default auth.uid() references auth.users (id),
  created_at   timestamptz not null default now()
);
create index if not exists attachments_campaign_idx on public.attachments (campaign_id);
create index if not exists attachments_entry_idx on public.attachments (entry_id);

-- Map pins (interactive maps): a point on a map image that links to an entry.
-- x/y are normalised 0..1 so they survive zoom/resize.
create table if not exists public.map_pins (
  id              uuid primary key default gen_random_uuid(),
  attachment_id   uuid not null references public.attachments (id) on delete cascade,
  target_entry_id uuid not null references public.entries (id) on delete cascade,
  x               numeric not null,
  y               numeric not null,
  label           text
);
create index if not exists map_pins_attachment_idx on public.map_pins (attachment_id);

-- ============================================================================
-- HELPER FUNCTIONS (SECURITY DEFINER so they bypass RLS on campaign_members,
-- which both answers "is this user a member/editor?" AND avoids RLS recursion)
-- ============================================================================

create or replace function public.is_campaign_member(cid uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.campaign_members m
    where m.campaign_id = cid and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_campaign_editor(cid uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.campaign_members m
    where m.campaign_id = cid
      and m.user_id = (select auth.uid())
      and m.role in ('dm', 'co_dm')
  );
$$;

create or replace function public.shares_campaign(other uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1
    from public.campaign_members a
    join public.campaign_members b on a.campaign_id = b.campaign_id
    where a.user_id = (select auth.uid()) and b.user_id = other
  );
$$;

grant execute on function public.is_campaign_member(uuid) to authenticated;
grant execute on function public.is_campaign_editor(uuid) to authenticated;
grant execute on function public.shares_campaign(uuid) to authenticated;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- When a campaign is created, make the creator its dm.
create or replace function public.handle_new_campaign()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.campaign_members (campaign_id, user_id, role)
  values (new.id, new.created_by, 'dm')
  on conflict (campaign_id, user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_campaign_created on public.campaigns;
create trigger on_campaign_created
  after insert on public.campaigns
  for each row execute function public.handle_new_campaign();

-- Keep entries.updated_at fresh.
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists entries_set_updated_at on public.entries;
create trigger entries_set_updated_at
  before update on public.entries
  for each row execute function public.set_updated_at();

-- Accept an invite: validates token + that the logged-in user's email matches
-- the invited email, then grants membership. SECURITY DEFINER so the invitee
-- (not yet a member) can perform the insert.
create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  inv    public.invites;
  uid    uuid;
  uemail text;
begin
  uid := (select auth.uid());
  if uid is null then
    raise exception 'You must be signed in to accept an invite';
  end if;

  uemail := lower((select auth.jwt() ->> 'email'));

  select * into inv from public.invites
  where token = p_token and accepted_at is null;

  if inv.id is null then
    raise exception 'This invite is invalid or has already been used';
  end if;

  if lower(inv.email) <> uemail then
    raise exception 'This invite was sent to a different email address';
  end if;

  insert into public.campaign_members (campaign_id, user_id, role)
  values (inv.campaign_id, uid, inv.role)
  on conflict (campaign_id, user_id) do update set role = excluded.role;

  update public.invites set accepted_at = now() where id = inv.id;
  return inv.campaign_id;
end; $$;

grant execute on function public.accept_invite(text) to authenticated;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles         enable row level security;
alter table public.campaigns        enable row level security;
alter table public.campaign_members enable row level security;
alter table public.invites          enable row level security;
alter table public.entry_types      enable row level security;
alter table public.entries          enable row level security;
alter table public.entry_links      enable row level security;
alter table public.attachments      enable row level security;
alter table public.map_pins         enable row level security;

-- ---- profiles --------------------------------------------------------------
create policy "read own or campaign-mate profiles" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_campaign(id));
create policy "insert own profile" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---- campaigns -------------------------------------------------------------
create policy "members read their campaigns" on public.campaigns
  for select to authenticated using (public.is_campaign_member(id));
create policy "any authed user creates a campaign" on public.campaigns
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy "editors update campaign" on public.campaigns
  for update to authenticated
  using (public.is_campaign_editor(id)) with check (public.is_campaign_editor(id));
create policy "creator deletes campaign" on public.campaigns
  for delete to authenticated using (created_by = (select auth.uid()));

-- ---- campaign_members ------------------------------------------------------
create policy "members read membership of their campaigns" on public.campaign_members
  for select to authenticated using (public.is_campaign_member(campaign_id));
create policy "editors add members" on public.campaign_members
  for insert to authenticated with check (public.is_campaign_editor(campaign_id));
create policy "editors update members" on public.campaign_members
  for update to authenticated
  using (public.is_campaign_editor(campaign_id)) with check (public.is_campaign_editor(campaign_id));
create policy "editors remove members" on public.campaign_members
  for delete to authenticated using (public.is_campaign_editor(campaign_id));

-- ---- invites ---------------------------------------------------------------
-- Only editors manage invites. (Accepting an invite happens via the
-- accept_invite() SECURITY DEFINER function, which doesn't need a SELECT here.)
create policy "editors read invites" on public.invites
  for select to authenticated using (public.is_campaign_editor(campaign_id));
create policy "editors create invites" on public.invites
  for insert to authenticated with check (public.is_campaign_editor(campaign_id));
create policy "editors delete invites" on public.invites
  for delete to authenticated using (public.is_campaign_editor(campaign_id));

-- ---- entry_types -----------------------------------------------------------
create policy "read global or own-campaign types" on public.entry_types
  for select to authenticated
  using (campaign_id is null or public.is_campaign_member(campaign_id));
create policy "editors create campaign types" on public.entry_types
  for insert to authenticated
  with check (campaign_id is not null and public.is_campaign_editor(campaign_id));
create policy "editors update campaign types" on public.entry_types
  for update to authenticated
  using (campaign_id is not null and public.is_campaign_editor(campaign_id))
  with check (campaign_id is not null and public.is_campaign_editor(campaign_id));
create policy "editors delete campaign types" on public.entry_types
  for delete to authenticated
  using (campaign_id is not null and public.is_campaign_editor(campaign_id));

-- ---- entries (the crux) ----------------------------------------------------
-- Editors see everything in their campaign...
create policy "editors read all entries" on public.entries
  for select to authenticated using (public.is_campaign_editor(campaign_id));
-- ...players (and editors) see ONLY player-visible entries. A player querying a
-- dm_only row gets zero rows back from the database, regardless of the UI.
create policy "members read revealed entries" on public.entries
  for select to authenticated
  using (public.is_campaign_member(campaign_id) and visibility = 'players');
-- Writes: editors only. Players have no write policy => all writes denied.
create policy "editors insert entries" on public.entries
  for insert to authenticated with check (public.is_campaign_editor(campaign_id));
create policy "editors update entries" on public.entries
  for update to authenticated
  using (public.is_campaign_editor(campaign_id)) with check (public.is_campaign_editor(campaign_id));
create policy "editors delete entries" on public.entries
  for delete to authenticated using (public.is_campaign_editor(campaign_id));

-- ---- entry_links -----------------------------------------------------------
-- You can read a link edge iff you can read its SOURCE entry (the inner select
-- is itself RLS-filtered). Target visibility is enforced separately when the
-- target row is fetched / when the body is rendered, so this never leaks a
-- hidden target.
create policy "read links whose source is visible" on public.entry_links
  for select to authenticated
  using (exists (select 1 from public.entries e where e.id = source_entry_id));
create policy "editors write links" on public.entry_links
  for insert to authenticated
  with check (exists (
    select 1 from public.entries e
    where e.id = source_entry_id and public.is_campaign_editor(e.campaign_id)
  ));
create policy "editors delete links" on public.entry_links
  for delete to authenticated
  using (exists (
    select 1 from public.entries e
    where e.id = source_entry_id and public.is_campaign_editor(e.campaign_id)
  ));

-- ---- attachments -----------------------------------------------------------
create policy "editors read attachments" on public.attachments
  for select to authenticated using (public.is_campaign_editor(campaign_id));
create policy "players read attachments of revealed entries" on public.attachments
  for select to authenticated
  using (
    public.is_campaign_member(campaign_id)
    and entry_id is not null
    and exists (select 1 from public.entries e where e.id = entry_id)
  );
create policy "editors write attachments" on public.attachments
  for insert to authenticated with check (public.is_campaign_editor(campaign_id));
create policy "editors update attachments" on public.attachments
  for update to authenticated
  using (public.is_campaign_editor(campaign_id)) with check (public.is_campaign_editor(campaign_id));
create policy "editors delete attachments" on public.attachments
  for delete to authenticated using (public.is_campaign_editor(campaign_id));

-- ---- map_pins --------------------------------------------------------------
-- A pin is visible iff you can see BOTH the map (attachment) AND its target
-- entry. Players therefore never see a pin pointing at a hidden location.
create policy "read pins for visible map+target" on public.map_pins
  for select to authenticated
  using (
    exists (select 1 from public.attachments a where a.id = attachment_id)
    and exists (select 1 from public.entries e where e.id = target_entry_id)
  );
create policy "editors write pins" on public.map_pins
  for insert to authenticated
  with check (exists (
    select 1 from public.attachments a
    where a.id = attachment_id and public.is_campaign_editor(a.campaign_id)
  ));
create policy "editors update pins" on public.map_pins
  for update to authenticated
  using (exists (
    select 1 from public.attachments a
    where a.id = attachment_id and public.is_campaign_editor(a.campaign_id)
  ));
create policy "editors delete pins" on public.map_pins
  for delete to authenticated
  using (exists (
    select 1 from public.attachments a
    where a.id = attachment_id and public.is_campaign_editor(a.campaign_id)
  ));

-- ============================================================================
-- STORAGE: private bucket for map / image uploads.
-- No authenticated SELECT policy is granted: files are reached only through
-- short-lived signed URLs minted server-side (service role) after the matching
-- attachments row passes RLS. This prevents URL-guessing of secret maps.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('maps', 'maps', false)
on conflict (id) do nothing;

-- ============================================================================
-- SEED: built-in global entry types (templates). campaign_id = NULL.
-- field_schema: ordered [{key,label,type,placeholder?,options?,required?}]
--   type ∈ text | textarea | number | select | url
-- body_template: starter Tiptap doc JSON (may include secretBlock nodes that
--   are stripped for players).
-- ============================================================================
insert into public.entry_types (campaign_id, key, label, icon, sort_order, field_schema, body_template) values
(null, 'npc', 'NPC', 'User', 10,
 '[{"key":"species","label":"Race / Species","type":"text","placeholder":"Human, Elf, Dragonborn…"},
   {"key":"occupation","label":"Role / Occupation","type":"text","placeholder":"Blacksmith, Guard Captain…"},
   {"key":"location","label":"Found at","type":"text","placeholder":"Where players meet them"},
   {"key":"disposition","label":"Disposition","type":"select","options":["Friendly","Neutral","Hostile","Unknown"]},
   {"key":"status","label":"Status","type":"select","options":["Alive","Dead","Unknown"]}]'::jsonb,
 '{"type":"doc","content":[
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Appearance"}]},
   {"type":"paragraph"},
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Personality"}]},
   {"type":"paragraph"},
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Voice & Mannerisms"}]},
   {"type":"paragraph"},
   {"type":"secretBlock","content":[
     {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Secrets & Plot Hooks"}]},
     {"type":"paragraph"}]}
 ]}'::jsonb),

(null, 'monster', 'Monster', 'Skull', 20,
 '[{"key":"cr","label":"Challenge Rating","type":"text","placeholder":"1/4, 5, 12…"},
   {"key":"creature_type","label":"Type","type":"text","placeholder":"Beast, Fiend, Undead…"},
   {"key":"ac","label":"Armor Class","type":"number"},
   {"key":"hp","label":"Hit Points","type":"number"},
   {"key":"speed","label":"Speed","type":"text","placeholder":"30 ft., fly 60 ft."}]'::jsonb,
 '{"type":"doc","content":[
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Description"}]},
   {"type":"paragraph"},
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Tactics"}]},
   {"type":"paragraph"},
   {"type":"secretBlock","content":[
     {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Loot & Lair Secrets"}]},
     {"type":"paragraph"}]}
 ]}'::jsonb),

(null, 'location', 'Location', 'MapPin', 30,
 '[{"key":"region","label":"Region","type":"text","placeholder":"Which part of the world"},
   {"key":"loc_type","label":"Type","type":"select","options":["City","Town","Village","Dungeon","Wilderness","Landmark","Plane","Other"]},
   {"key":"leader","label":"Ruler / Leader","type":"text"}]'::jsonb,
 '{"type":"doc","content":[
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Overview"}]},
   {"type":"paragraph"},
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Notable Features"}]},
   {"type":"paragraph"},
   {"type":"secretBlock","content":[
     {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"DM Notes"}]},
     {"type":"paragraph"}]}
 ]}'::jsonb),

(null, 'shop', 'Shop', 'Store', 40,
 '[{"key":"proprietor","label":"Proprietor","type":"text","placeholder":"Who runs it"},
   {"key":"shop_type","label":"Shop Type","type":"select","options":["General Goods","Blacksmith","Magic Shop","Alchemist","Tavern / Inn","Other"]},
   {"key":"location","label":"Location","type":"text"},
   {"key":"price_level","label":"Prices","type":"select","options":["Cheap","Average","Expensive"]}]'::jsonb,
 '{"type":"doc","content":[
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Description"}]},
   {"type":"paragraph"},
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Inventory"}]},
   {"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph"}]}]},
   {"type":"secretBlock","content":[
     {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"DM Notes (hidden stock, real prices)"}]},
     {"type":"paragraph"}]}
 ]}'::jsonb),

(null, 'magic_item', 'Magic Item', 'Sparkles', 50,
 '[{"key":"rarity","label":"Rarity","type":"select","options":["Common","Uncommon","Rare","Very Rare","Legendary","Artifact"]},
   {"key":"item_type","label":"Type","type":"text","placeholder":"Wondrous item, Weapon (longsword)…"},
   {"key":"attunement","label":"Attunement","type":"select","options":["No","Yes"]},
   {"key":"value","label":"Value","type":"text","placeholder":"e.g. 500 gp"}]'::jsonb,
 '{"type":"doc","content":[
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Description"}]},
   {"type":"paragraph"},
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Properties"}]},
   {"type":"paragraph"},
   {"type":"secretBlock","content":[
     {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Curses & Secrets"}]},
     {"type":"paragraph"}]}
 ]}'::jsonb),

(null, 'object', 'Object', 'Package', 60,
 '[{"key":"obj_type","label":"Type","type":"text","placeholder":"Document, Artifact, Trap…"},
   {"key":"location","label":"Location","type":"text"}]'::jsonb,
 '{"type":"doc","content":[
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Description"}]},
   {"type":"paragraph"},
   {"type":"secretBlock","content":[
     {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"DM Notes"}]},
     {"type":"paragraph"}]}
 ]}'::jsonb),

(null, 'session_note', 'Session Note', 'NotebookPen', 70,
 '[{"key":"session_number","label":"Session #","type":"number"},
   {"key":"date","label":"Date Played","type":"text","placeholder":"2026-06-13"},
   {"key":"players_present","label":"Players Present","type":"text"}]'::jsonb,
 '{"type":"doc","content":[
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Recap"}]},
   {"type":"paragraph"},
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"What Happened"}]},
   {"type":"paragraph"},
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Loose Threads"}]},
   {"type":"paragraph"},
   {"type":"secretBlock","content":[
     {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"DM Prep for Next Session"}]},
     {"type":"paragraph"}]}
 ]}'::jsonb),

(null, 'character', 'Player Character', 'Shield', 80,
 '[{"key":"player_name","label":"Player","type":"text","placeholder":"Real name of the player"},
   {"key":"class_level","label":"Class & Level","type":"text","placeholder":"Wizard 5"},
   {"key":"race","label":"Race","type":"text"},
   {"key":"ddb_url","label":"D&D Beyond Sheet URL","type":"url","placeholder":"https://www.dndbeyond.com/characters/…"}]'::jsonb,
 '{"type":"doc","content":[
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Backstory"}]},
   {"type":"paragraph"},
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Notes"}]},
   {"type":"paragraph"},
   {"type":"secretBlock","content":[
     {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"DM Notes"}]},
     {"type":"paragraph"}]}
 ]}'::jsonb),

(null, 'map', 'Map', 'Map', 90,
 '[{"key":"region","label":"Region","type":"text"}]'::jsonb,
 '{"type":"doc","content":[
   {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Description"}]},
   {"type":"paragraph"}
 ]}'::jsonb)
on conflict do nothing;
