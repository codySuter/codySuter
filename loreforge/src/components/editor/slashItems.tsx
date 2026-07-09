import type { DefaultReactSuggestionItem } from "@blocknote/react";
import {
  Skull, Swords, Table2, Activity, Megaphone, Sparkles, ListOrdered, Hourglass, Map as MapIcon, Dices,
} from "lucide-react";
import type { LoreEditorType, LorePartialBlock } from "./schema";
import type { Mode } from "../../lib/types";

/** Insert a block, replacing the current one if it's an empty paragraph. */
function insertBlock(editor: LoreEditorType, block: LorePartialBlock) {
  const current = editor.getTextCursorPosition().block;
  const isEmptyParagraph =
    current.type === "paragraph" &&
    Array.isArray(current.content) &&
    current.content.length === 0 &&
    current.children.length === 0;
  if (isEmptyParagraph) {
    editor.updateBlock(current, block);
    const updated = editor.getTextCursorPosition().block;
    editor.setTextCursorPosition(updated, "end");
  } else {
    const inserted = editor.insertBlocks([block], current, "after");
    if (inserted[0]) editor.setTextCursorPosition(inserted[0], "end");
  }
}

/** Loreforge's custom slash-menu items — mode-aware ordering. */
export function ttrpgSlashItems(editor: LoreEditorType, mode: Mode): DefaultReactSuggestionItem[] {
  const group = "Game blocks";
  const iconStyle = { color: "var(--accent-text)" } as const;

  const statblock: DefaultReactSuggestionItem = {
    title: "Stat Block (5E)",
    subtext: "Monster or NPC stat block with rollable abilities",
    aliases: ["statblock", "monster", "npc", "creature"],
    group,
    icon: <Skull size={18} style={iconStyle} />,
    onItemClick: () => insertBlock(editor, { type: "statblock" }),
  };
  const adversary: DefaultReactSuggestionItem = {
    title: "Adversary (Daggerheart)",
    subtext: "Adversary or environment card with features",
    aliases: ["adversary", "enemy", "environment"],
    group,
    icon: <Swords size={18} style={iconStyle} />,
    onItemClick: () => insertBlock(editor, { type: "adversary" }),
  };
  const rollTable: DefaultReactSuggestionItem = {
    title: "Roll Table",
    subtext: "Random table you can roll on with one click",
    aliases: ["rolltable", "random", "table", "loot"],
    group,
    icon: <Table2 size={18} style={iconStyle} />,
    onItemClick: () => insertBlock(editor, { type: "rollTable" }),
  };
  const tracker: DefaultReactSuggestionItem = {
    title: "Tracker",
    subtext: "HP, Hope, Fear, Stress, or any counter",
    aliases: ["tracker", "hp", "hope", "fear", "stress", "counter"],
    group,
    icon: <Activity size={18} style={iconStyle} />,
    onItemClick: () => insertBlock(editor, { type: "tracker" }),
  };
  const encounter: DefaultReactSuggestionItem = {
    title: mode === "daggerheart" ? "Spotlight Tracker" : "Encounter Tracker",
    subtext: mode === "daggerheart" ? "Track the spotlight, HP, and conditions" : "Initiative order, HP, and conditions",
    aliases: ["encounter", "initiative", "combat", "spotlight"],
    group,
    icon: <ListOrdered size={18} style={iconStyle} />,
    onItemClick: () => insertBlock(editor, { type: "encounter" }),
  };
  const abilityCard: DefaultReactSuggestionItem = {
    title: mode === "daggerheart" ? "Domain / Ability Card" : "Spell / Item Card",
    subtext: "A pretty card for spells, items, and abilities",
    aliases: ["spell", "card", "ability", "domain", "item"],
    group,
    icon: <Sparkles size={18} style={iconStyle} />,
    onItemClick: () => insertBlock(editor, { type: "abilityCard" }),
  };
  const timeline: DefaultReactSuggestionItem = {
    title: "Timeline",
    subtext: "Eras and events for your world's history",
    aliases: ["timeline", "history", "era", "chronicle"],
    group,
    icon: <Hourglass size={18} style={iconStyle} />,
    onItemClick: () => insertBlock(editor, { type: "timeline" }),
  };
  const map: DefaultReactSuggestionItem = {
    title: "Map with Pins",
    subtext: "Interactive map — pins link to pages",
    aliases: ["map", "pins", "atlas"],
    group,
    icon: <MapIcon size={18} style={iconStyle} />,
    onItemClick: () => insertBlock(editor, { type: "map" }),
  };
  const callout: DefaultReactSuggestionItem = {
    title: "Callout",
    subtext: "Note, GM secret, quest, treasure, danger, lore…",
    aliases: ["callout", "note", "secret", "quest", "danger", "lore", "dm"],
    group,
    icon: <Megaphone size={18} style={iconStyle} />,
    onItemClick: () => insertBlock(editor, { type: "callout" }),
  };
  const dice: DefaultReactSuggestionItem = {
    title: "Inline Dice",
    subtext: "A clickable dice chip in your text (2d6+3)",
    aliases: ["dice", "roll", "d20"],
    group,
    icon: <Dices size={18} style={iconStyle} />,
    onItemClick: () => {
      editor.insertInlineContent([
        { type: "dice", props: { expr: mode === "daggerheart" ? "2d12" : "1d20", label: "" } },
        " ",
      ]);
    },
  };

  return mode === "daggerheart"
    ? [adversary, tracker, encounter, abilityCard, rollTable, callout, timeline, map, dice, statblock]
    : [statblock, encounter, rollTable, tracker, abilityCard, callout, timeline, map, dice, adversary];
}
