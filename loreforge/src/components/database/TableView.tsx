import { useState } from "react";
import { Plus, Trash2, Type } from "lucide-react";
import type { DbApi } from "./DatabaseView";
import { PROP_TYPES } from "./DatabaseView";
import { CellEditor, CommitInput } from "./cells";
import { Popover } from "../ui/Popover";
import type { PropType } from "../../lib/types";

export function TableView({ db }: { db: DbApi }) {
  const [headerMenu, setHeaderMenu] = useState<{ propId: string; anchor: DOMRect } | null>(null);
  const [newPropMenu, setNewPropMenu] = useState<DOMRect | null>(null);
  const headerProp = headerMenu ? db.props.find((p) => p.id === headerMenu.propId) : null;

  return (
    <div style={{ overflowX: "auto", paddingBottom: 8 }}>
      <table className="db-table">
        <thead>
          <tr>
            <th style={{ minWidth: 220 }}>
              <span className="th-inner"><Type size={12} /> Title</span>
            </th>
            {db.props.map((prop) => (
              <th key={prop.id} style={{ minWidth: 130 }}>
                <span
                  className="th-inner"
                  onClick={(e) => setHeaderMenu({ propId: prop.id, anchor: e.currentTarget.getBoundingClientRect() })}
                >
                  {prop.name}
                </span>
              </th>
            ))}
            <th style={{ width: 40 }}>
              <button className="lf-icon-btn" title="Add property" onClick={(e) => setNewPropMenu(e.currentTarget.getBoundingClientRect())}>
                <Plus size={13} />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {db.rows.map((row) => (
            <tr key={row._id}>
              <td>
                <span className="row-title">
                  <span style={{ fontSize: 15 }}>{row.icon ?? "•"}</span>
                  <CommitInput
                    initial={row.title}
                    placeholder="Untitled"
                    onCommit={(title) => db.setTitle(row._id, title)}
                    className="db-cell-input"
                  />
                  <button className="open-tag" onClick={() => db.openEntry(row._id)}>
                    Open
                  </button>
                </span>
              </td>
              {db.props.map((prop) => (
                <td key={prop.id}>
                  <CellEditor
                    prop={prop}
                    value={row.cells?.[prop.id]}
                    onChange={(value) => db.setCell(row._id, prop.id, value)}
                    onAddOption={db.addOption}
                    compact
                  />
                </td>
              ))}
              <td>
                <button
                  className="lf-icon-btn"
                  style={{ width: 22, height: 22 }}
                  title="Delete row"
                  onClick={() => {
                    if (confirm(`Delete “${row.title || "Untitled"}”?`)) db.removeEntry(row._id);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={db.props.length + 2} style={{ borderBottom: "none" }}>
              <button className="lf-btn" style={{ fontSize: 13, color: "var(--text-3)" }} onClick={() => db.createEntry()}>
                <Plus size={13} /> New row
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      {headerMenu && headerProp && (
        <Popover anchor={headerMenu.anchor} onClose={() => setHeaderMenu(null)} width={230}>
          <div style={{ padding: "4px 4px 6px" }}>
            <input
              className="lf-input"
              defaultValue={headerProp.name}
              autoFocus
              onBlur={(e) => e.target.value !== headerProp.name && db.updateProp(headerProp.id, { name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </div>
          <div className="lf-menu-label">Type</div>
          {PROP_TYPES.map((type) => (
            <button
              key={type.id}
              className="lf-menu-item"
              data-active={headerProp.type === type.id}
              onClick={() => {
                db.updateProp(headerProp.id, {
                  type: type.id,
                  ...(type.id === "select" || type.id === "multiSelect"
                    ? { options: headerProp.options ?? [] }
                    : {}),
                });
                setHeaderMenu(null);
              }}
            >
              {type.label}
            </button>
          ))}
          <div className="lf-menu-sep" />
          <button
            className="lf-menu-item danger"
            onClick={() => {
              if (confirm(`Delete property “${headerProp.name}”? Its values will be lost.`)) {
                db.deleteProp(headerProp.id);
              }
              setHeaderMenu(null);
            }}
          >
            <Trash2 size={13} /> Delete property
          </button>
        </Popover>
      )}

      {newPropMenu && (
        <NewPropMenu
          anchor={newPropMenu}
          onClose={() => setNewPropMenu(null)}
          onAdd={(name, type) => db.addProp(name, type)}
        />
      )}
    </div>
  );
}

export function NewPropMenu({
  anchor,
  onClose,
  onAdd,
}: {
  anchor: DOMRect;
  onClose: () => void;
  onAdd: (name: string, type: PropType) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<PropType>("text");
  return (
    <Popover anchor={anchor} onClose={onClose} width={230}>
      <div style={{ padding: "4px 4px 6px" }}>
        <input
          autoFocus
          className="lf-input"
          placeholder="Property name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              onAdd(name.trim(), type);
              onClose();
            }
          }}
        />
      </div>
      <div className="lf-menu-label">Type</div>
      {PROP_TYPES.map((propType) => (
        <button
          key={propType.id}
          className="lf-menu-item"
          data-active={type === propType.id}
          onClick={() => setType(propType.id)}
        >
          {propType.label}
        </button>
      ))}
      <div className="lf-menu-sep" />
      <button
        className="lf-menu-item"
        style={{ justifyContent: "center", fontWeight: 600, color: "var(--accent-text)" }}
        onClick={() => {
          if (name.trim()) {
            onAdd(name.trim(), type);
            onClose();
          }
        }}
      >
        Add property
      </button>
    </Popover>
  );
}
