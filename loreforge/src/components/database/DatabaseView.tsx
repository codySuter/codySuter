import { useMemo, useState } from "react";
import {
  ArrowUpDown, Filter, LayoutGrid, Columns3, Table2, Plus, X, Check, Search,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useQ, useM } from "../../lib/data";
import { useUI } from "../../lib/store";
import type {
  CellValue, EntryDoc, FilterDef, PropDef, PropType, SelectOption, ViewDef, ViewKind, WorkspaceDoc, RelationValue,
} from "../../lib/types";
import { Popover } from "../ui/Popover";
import { localId } from "../../lib/utils";
import { TableView } from "./TableView";
import { GalleryView } from "./GalleryView";
import { BoardView } from "./BoardView";

export interface DbApi {
  props: PropDef[];
  view: ViewDef;
  rows: EntryDoc[];
  openEntry: (entryId: string) => void;
  createEntry: (extraCells?: Record<string, CellValue>) => void;
  setCell: (entryId: string, propId: string, value: CellValue) => void;
  setTitle: (entryId: string, title: string) => void;
  removeEntry: (entryId: string) => void;
  addOption: (propId: string, option: SelectOption) => void;
  addProp: (name: string, type: PropType) => void;
  updateProp: (propId: string, partial: Partial<PropDef>) => void;
  deleteProp: (propId: string) => void;
}

const PROP_TYPES: { id: PropType; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "number", label: "Number" },
  { id: "select", label: "Select" },
  { id: "multiSelect", label: "Multi-select" },
  { id: "checkbox", label: "Checkbox" },
  { id: "date", label: "Date" },
  { id: "url", label: "URL" },
  { id: "dice", label: "Dice formula" },
  { id: "relation", label: "Link to page/entry" },
];

function cellToString(prop: PropDef, value: CellValue): string {
  if (value === undefined || value === null) return "";
  switch (prop.type) {
    case "select":
      return prop.options?.find((o) => o.id === value)?.label ?? "";
    case "multiSelect":
      return (value as string[])
        .map((id) => prop.options?.find((o) => o.id === id)?.label ?? "")
        .join(", ");
    case "relation":
      return (value as RelationValue[]).map((r) => r.title).join(", ");
    case "checkbox":
      return value ? "true" : "false";
    default:
      return String(value);
  }
}

export function DatabaseView({
  page,
  workspace,
}: {
  page: { _id: Id<"pages">; props?: unknown; views?: unknown };
  workspace: WorkspaceDoc;
}) {
  const ui = useUI();
  const entries = useQ(api.entries.listByDatabase, { databaseId: page._id });
  const updateDbSchema = useM(api.pages.updateDbSchema);
  const createEntryM = useM(api.entries.create);
  const setCellM = useM(api.entries.setCell);
  const updateEntryM = useM(api.entries.update);
  const removeEntryM = useM(api.entries.remove);

  const props = useMemo(() => (Array.isArray(page.props) ? (page.props as PropDef[]) : []), [page.props]);
  const views = useMemo<ViewDef[]>(
    () =>
      Array.isArray(page.views) && (page.views as ViewDef[]).length > 0
        ? (page.views as ViewDef[])
        : [{ id: "default", name: "Table", kind: "table" as ViewKind }],
    [page.views],
  );

  const [activeViewId, setActiveViewId] = useState(views[0].id);
  const view = views.find((v) => v.id === activeViewId) ?? views[0];
  const [search, setSearch] = useState("");
  const [sortMenu, setSortMenu] = useState<DOMRect | null>(null);
  const [filterMenu, setFilterMenu] = useState<DOMRect | null>(null);
  const [addViewMenu, setAddViewMenu] = useState<DOMRect | null>(null);
  const [viewMenu, setViewMenu] = useState<{ id: string; anchor: DOMRect } | null>(null);

  const saveViews = (next: ViewDef[]) => void updateDbSchema({ pageId: page._id, views: next });
  const saveProps = (next: PropDef[]) => void updateDbSchema({ pageId: page._id, props: next });
  const patchView = (partial: Partial<ViewDef>) =>
    saveViews(views.map((v) => (v.id === view.id ? { ...v, ...partial } : v)));

  const rows = useMemo(() => {
    let list = [...((entries ?? []) as EntryDoc[])];
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      list = list.filter(
        (row) =>
          row.title.toLowerCase().includes(needle) ||
          props.some((prop) => cellToString(prop, row.cells?.[prop.id]).toLowerCase().includes(needle)),
      );
    }
    for (const filter of view.filters ?? []) {
      list = list.filter((row) => {
        const str =
          filter.propId === "title"
            ? row.title
            : cellToString(props.find((p) => p.id === filter.propId) ?? { id: "", name: "", type: "text" }, row.cells?.[filter.propId]);
        const needle = (filter.value ?? "").toLowerCase();
        const hay = str.toLowerCase();
        switch (filter.op) {
          case "isEmpty": return hay === "";
          case "isNotEmpty": return hay !== "";
          case "contains": return hay.includes(needle);
          case "is": return hay === needle;
          case "isNot": return hay !== needle;
          default: return true;
        }
      });
    }
    const sortBy = view.sortBy;
    if (sortBy) {
      const dir = sortBy.dir === "desc" ? -1 : 1;
      const prop = props.find((p) => p.id === sortBy.key);
      list.sort((a, b) => {
        if (sortBy.key === "title") return a.title.localeCompare(b.title) * dir;
        const va = a.cells?.[sortBy.key];
        const vb = b.cells?.[sortBy.key];
        if (typeof va === "number" || typeof vb === "number") {
          return ((Number(va ?? Number.NEGATIVE_INFINITY)) - Number(vb ?? Number.NEGATIVE_INFINITY)) * dir;
        }
        return cellToString(prop ?? { id: "", name: "", type: "text" }, va)
          .localeCompare(cellToString(prop ?? { id: "", name: "", type: "text" }, vb)) * dir;
      });
    } else {
      list.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return list;
  }, [entries, search, view, props]);

  const dbApi: DbApi = {
    props,
    view,
    rows,
    openEntry: (entryId) => ui.openPeek({ entryId, databaseId: page._id }),
    createEntry: (extraCells) =>
      void createEntryM({
        databaseId: page._id,
        workspaceId: workspace._id,
        cells: extraCells ?? {},
      }).then((id) => ui.openPeek({ entryId: id as string, databaseId: page._id })),
    setCell: (entryId, propId, value) =>
      void setCellM({ entryId: entryId as Id<"entries">, propId, value }),
    setTitle: (entryId, title) => void updateEntryM({ entryId: entryId as Id<"entries">, title }),
    removeEntry: (entryId) => void removeEntryM({ entryId: entryId as Id<"entries"> }),
    addOption: (propId, option) =>
      saveProps(props.map((p) => (p.id === propId ? { ...p, options: [...(p.options ?? []), option] } : p))),
    addProp: (name, type) =>
      saveProps([...props, { id: localId(), name, type, ...(type === "select" || type === "multiSelect" ? { options: [] } : {}) }]),
    updateProp: (propId, partial) =>
      saveProps(props.map((p) => (p.id === propId ? { ...p, ...partial } : p))),
    deleteProp: (propId) => saveProps(props.filter((p) => p.id !== propId)),
  };

  const viewIcon = (kind: ViewKind) =>
    kind === "table" ? <Table2 size={13} /> : kind === "gallery" ? <LayoutGrid size={13} /> : <Columns3 size={13} />;

  const filterCount = view.filters?.length ?? 0;

  return (
    <div style={{ marginTop: 8 }}>
      <div className="db-toolbar">
        {views.map((v) => (
          <span
            key={v.id}
            className="db-tab"
            data-active={v.id === view.id}
            onClick={() => setActiveViewId(v.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setViewMenu({ id: v.id, anchor: e.currentTarget.getBoundingClientRect() });
            }}
            onDoubleClick={(e) => setViewMenu({ id: v.id, anchor: e.currentTarget.getBoundingClientRect() })}
          >
            {viewIcon(v.kind)}
            {v.name}
          </span>
        ))}
        <button className="lf-icon-btn" title="Add view" onClick={(e) => setAddViewMenu(e.currentTarget.getBoundingClientRect())}>
          <Plus size={14} />
        </button>

        <span style={{ flex: 1 }} />

        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-3)" }}>
          <Search size={13} />
          <input
            className="db-cell-input"
            style={{ width: 130, fontSize: 13 }}
            placeholder="Search rows…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </span>
        <button
          className="lf-btn"
          style={{ fontSize: 12.5, color: filterCount ? "var(--accent-text)" : undefined }}
          onClick={(e) => setFilterMenu(e.currentTarget.getBoundingClientRect())}
        >
          <Filter size={13} /> {filterCount ? `${filterCount} filter${filterCount > 1 ? "s" : ""}` : "Filter"}
        </button>
        <button
          className="lf-btn"
          style={{ fontSize: 12.5, color: view.sortBy ? "var(--accent-text)" : undefined }}
          onClick={(e) => setSortMenu(e.currentTarget.getBoundingClientRect())}
        >
          <ArrowUpDown size={13} /> Sort
        </button>
        <button className="lf-btn primary" style={{ fontSize: 12.5 }} onClick={() => dbApi.createEntry()}>
          <Plus size={13} /> New
        </button>
      </div>

      {entries === undefined ? (
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="lf-skeleton" style={{ height: 28 }} />
          ))}
        </div>
      ) : view.kind === "table" ? (
        <TableView db={dbApi} />
      ) : view.kind === "gallery" ? (
        <GalleryView db={dbApi} />
      ) : (
        <BoardView db={dbApi} />
      )}

      {addViewMenu && (
        <Popover anchor={addViewMenu} onClose={() => setAddViewMenu(null)} width={190}>
          {(["table", "gallery", "board"] as ViewKind[]).map((kind) => (
            <button
              key={kind}
              className="lf-menu-item"
              onClick={() => {
                const id = localId();
                const groupProp = props.find((p) => p.type === "select");
                saveViews([
                  ...views,
                  {
                    id,
                    name: kind === "table" ? "Table" : kind === "gallery" ? "Gallery" : "Board",
                    kind,
                    ...(kind === "board" && groupProp ? { groupBy: groupProp.id } : {}),
                  },
                ]);
                setActiveViewId(id);
                setAddViewMenu(null);
              }}
            >
              {viewIcon(kind)} {kind === "table" ? "Table" : kind === "gallery" ? "Gallery" : "Board"}
            </button>
          ))}
        </Popover>
      )}

      {viewMenu && (
        <ViewMenu
          view={views.find((v) => v.id === viewMenu.id)!}
          anchor={viewMenu.anchor}
          props={props}
          canDelete={views.length > 1}
          onClose={() => setViewMenu(null)}
          onPatch={(partial) => saveViews(views.map((v) => (v.id === viewMenu.id ? { ...v, ...partial } : v)))}
          onDelete={() => {
            const remaining = views.filter((v) => v.id !== viewMenu.id);
            saveViews(remaining);
            if (activeViewId === viewMenu.id) setActiveViewId(remaining[0].id);
            setViewMenu(null);
          }}
        />
      )}

      {sortMenu && (
        <Popover anchor={sortMenu} onClose={() => setSortMenu(null)} width={220} align="right">
          <div className="lf-menu-label">Sort by</div>
          {[{ id: "manual", name: "Manual order" }, { id: "title", name: "Title" }, ...props].map((option) => {
            const isActive = option.id === "manual" ? !view.sortBy : view.sortBy?.key === option.id;
            const dir = view.sortBy?.key === option.id ? view.sortBy.dir : undefined;
            return (
              <button
                key={option.id}
                className="lf-menu-item"
                data-active={isActive}
                onClick={() => {
                  if (option.id === "manual") patchView({ sortBy: null });
                  else if (dir === "asc") patchView({ sortBy: { key: option.id, dir: "desc" } });
                  else patchView({ sortBy: { key: option.id, dir: "asc" } });
                }}
              >
                {"name" in option ? option.name : ""}
                {dir && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--accent-text)" }}>{dir === "asc" ? "A→Z" : "Z→A"}</span>}
                {isActive && option.id === "manual" && <Check size={13} style={{ marginLeft: "auto" }} />}
              </button>
            );
          })}
        </Popover>
      )}

      {filterMenu && (
        <FilterMenu
          anchor={filterMenu}
          props={props}
          filters={view.filters ?? []}
          onClose={() => setFilterMenu(null)}
          onChange={(filters) => patchView({ filters })}
        />
      )}
    </div>
  );
}

function ViewMenu({
  view,
  anchor,
  onClose,
  onPatch,
  onDelete,
  canDelete,
  props,
}: {
  view: ViewDef;
  anchor: DOMRect;
  onClose: () => void;
  onPatch: (partial: Partial<ViewDef>) => void;
  onDelete: () => void;
  canDelete: boolean;
  props: PropDef[];
}) {
  const selectProps = props.filter((p) => p.type === "select");
  return (
    <Popover anchor={anchor} onClose={onClose} width={230}>
      <div style={{ padding: "4px 4px 8px" }}>
        <input
          className="lf-input"
          defaultValue={view.name}
          onBlur={(e) => e.target.value !== view.name && onPatch({ name: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </div>
      {view.kind === "board" && selectProps.length > 0 && (
        <>
          <div className="lf-menu-label">Group by</div>
          {selectProps.map((prop) => (
            <button
              key={prop.id}
              className="lf-menu-item"
              data-active={view.groupBy === prop.id}
              onClick={() => onPatch({ groupBy: prop.id })}
            >
              {prop.name}
              {view.groupBy === prop.id && <Check size={13} style={{ marginLeft: "auto" }} />}
            </button>
          ))}
        </>
      )}
      {canDelete && (
        <>
          <div className="lf-menu-sep" />
          <button className="lf-menu-item danger" onClick={onDelete}>
            <X size={13} /> Delete view
          </button>
        </>
      )}
    </Popover>
  );
}

function FilterMenu({
  anchor,
  props,
  filters,
  onChange,
  onClose,
}: {
  anchor: DOMRect;
  props: PropDef[];
  filters: FilterDef[];
  onChange: (filters: FilterDef[]) => void;
  onClose: () => void;
}) {
  const fields = [{ id: "title", name: "Title", type: "text" as PropType }, ...props];
  const needsValue = (op: FilterDef["op"]) => op !== "isEmpty" && op !== "isNotEmpty";
  return (
    <Popover anchor={anchor} onClose={onClose} width={360} align="right">
      <div className="lf-menu-label">Filters (all must match)</div>
      {filters.map((filter, index) => (
        <div key={index} style={{ display: "flex", gap: 5, padding: "3px 4px", alignItems: "center" }}>
          <select
            className="lf-input"
            style={{ flex: 1, fontSize: 12.5, padding: "4px 6px" }}
            value={filter.propId}
            onChange={(e) => onChange(filters.map((f, i) => (i === index ? { ...f, propId: e.target.value } : f)))}
          >
            {fields.map((field) => (
              <option key={field.id} value={field.id}>{field.name}</option>
            ))}
          </select>
          <select
            className="lf-input"
            style={{ width: 105, fontSize: 12.5, padding: "4px 6px" }}
            value={filter.op}
            onChange={(e) => onChange(filters.map((f, i) => (i === index ? { ...f, op: e.target.value as FilterDef["op"] } : f)))}
          >
            <option value="contains">contains</option>
            <option value="is">is</option>
            <option value="isNot">is not</option>
            <option value="isEmpty">is empty</option>
            <option value="isNotEmpty">is not empty</option>
          </select>
          {needsValue(filter.op) && (
            <input
              className="lf-input"
              style={{ width: 90, fontSize: 12.5, padding: "4px 6px" }}
              value={filter.value ?? ""}
              placeholder="value"
              onChange={(e) => onChange(filters.map((f, i) => (i === index ? { ...f, value: e.target.value } : f)))}
            />
          )}
          <button className="lf-icon-btn" onClick={() => onChange(filters.filter((_, i) => i !== index))}>
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        className="lf-menu-item"
        onClick={() => onChange([...filters, { propId: "title", op: "contains", value: "" }])}
      >
        <Plus size={13} /> Add filter
      </button>
    </Popover>
  );
}

export { PROP_TYPES };
