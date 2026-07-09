import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { CalloutBlock } from "./blocks/CalloutBlock";
import { StatblockBlock } from "./blocks/StatblockBlock";
import { AdversaryBlock } from "./blocks/AdversaryBlock";
import { RollTableBlock } from "./blocks/RollTableBlock";
import { TrackerBlock } from "./blocks/TrackerBlock";
import { AbilityCardBlock } from "./blocks/AbilityCardBlock";
import { EncounterBlock } from "./blocks/EncounterBlock";
import { TimelineBlock } from "./blocks/TimelineBlock";
import { MapBlock } from "./blocks/MapBlock";
import { DiceInline, MentionInline } from "./blocks/inline";

/** The full Loreforge editor schema: BlockNote defaults + TTRPG blocks. */
export const loreSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    callout: CalloutBlock(),
    statblock: StatblockBlock(),
    adversary: AdversaryBlock(),
    rollTable: RollTableBlock(),
    tracker: TrackerBlock(),
    abilityCard: AbilityCardBlock(),
    encounter: EncounterBlock(),
    timeline: TimelineBlock(),
    map: MapBlock(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: MentionInline,
    dice: DiceInline,
  },
});

export type LoreEditorType = typeof loreSchema.BlockNoteEditor;
export type LoreBlock = typeof loreSchema.Block;
export type LorePartialBlock = typeof loreSchema.PartialBlock;
