/**
 * Walk BlockNote document JSON and collect every reference to another
 * page/entry: @mentions, map pins, and timeline event links. Used to keep
 * the `links` table (backlinks) in sync whenever content is saved.
 */

export interface LinkRef {
  toType: "page" | "entry";
  toId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pushRef(refs: LinkRef[], targetType: unknown, targetId: unknown) {
  if ((targetType === "page" || targetType === "entry") && typeof targetId === "string" && targetId) {
    refs.push({ toType: targetType, toId: targetId });
  }
}

function walkInline(content: unknown, refs: LinkRef[]) {
  if (!Array.isArray(content)) return;
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (item.type === "mention" && isRecord(item.props)) {
      pushRef(refs, item.props.targetType, item.props.targetId);
    }
    if (Array.isArray(item.content)) walkInline(item.content, refs);
  }
}

function walkDataProp(block: Record<string, unknown>, refs: LinkRef[]) {
  const props = block.props;
  if (!isRecord(props) || typeof props.data !== "string" || props.data === "") return;
  try {
    const data = JSON.parse(props.data);
    if (isRecord(data) && Array.isArray(data.pins)) {
      for (const pin of data.pins) {
        if (isRecord(pin)) pushRef(refs, pin.targetType, pin.targetId);
      }
    }
    if (isRecord(data) && Array.isArray(data.eras)) {
      for (const era of data.eras) {
        if (isRecord(era) && Array.isArray(era.events)) {
          for (const event of era.events) {
            if (isRecord(event)) pushRef(refs, event.targetType, event.targetId);
          }
        }
      }
    }
  } catch {
    // Malformed block data — nothing to extract.
  }
}

export function extractLinks(blocks: unknown): LinkRef[] {
  const refs: LinkRef[] = [];
  const visit = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const block of list) {
      if (!isRecord(block)) continue;
      const content = block.content;
      if (Array.isArray(content)) {
        walkInline(content, refs);
      } else if (isRecord(content) && Array.isArray(content.rows)) {
        // Table content: rows -> cells -> inline arrays.
        for (const row of content.rows) {
          if (!isRecord(row) || !Array.isArray(row.cells)) continue;
          for (const cell of row.cells) {
            if (Array.isArray(cell)) walkInline(cell, refs);
            else if (isRecord(cell)) walkInline(cell.content, refs);
          }
        }
      }
      walkDataProp(block, refs);
      if (Array.isArray(block.children)) visit(block.children);
    }
  };
  visit(blocks);
  return refs;
}

/** Extract page/entry references from database relation cells. */
export function extractCellLinks(
  cells: unknown,
  relationPropIds: string[],
): LinkRef[] {
  const refs: LinkRef[] = [];
  if (!isRecord(cells)) return refs;
  for (const propId of relationPropIds) {
    const value = cells[propId];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (isRecord(item)) pushRef(refs, item.type, item.id);
    }
  }
  return refs;
}
