import { Modal } from './ui';

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Documents',
    rows: [
      ['Ctrl+N', 'New document (opens the template picker)'],
      ['Ctrl+L', 'Back to library'],
      ['Ctrl+S', 'Save now (autosave runs anyway)'],
      ['Ctrl+E', 'Export PDF'],
      ['Ctrl+Shift+E', 'Export PNG'],
      ['Ctrl+P', 'Print'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
      ['Ctrl+B / Ctrl+I', 'Bold / italic (in text)'],
      ['Ctrl+H', 'Yellow highlight (in a callout bar)'],
      ['Ctrl+F', 'Find & replace'],
      ['Enter / Backspace', 'Add / remove list items'],
    ],
  },
  {
    title: 'Blocks',
    rows: [
      ['Ctrl+C / Ctrl+X', 'Copy / cut the selected block'],
      ['Ctrl+V', 'Paste a copied block — or paste plain text as new blocks'],
      ['Ctrl+Shift+V', 'Paste plain text as blocks (bullets, steps, headers…)'],
      ['Alt+↑ / Alt+↓', 'Move the selected block up / down'],
      ['Delete', 'Remove the selected block'],
      ['Esc', 'Deselect'],
    ],
  },
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      {GROUPS.map((g) => (
        <div key={g.title} className="mb-4 last:mb-0">
          <h3
            className="mb-1.5 text-[11px] font-bold tracking-[0.1em] text-[#6D6E71] uppercase"
            style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
          >
            {g.title}
          </h3>
          <table className="w-full text-[12.5px]">
            <tbody>
              {g.rows.map(([keys, what]) => (
                <tr key={keys} className="border-b border-[#F0F1F2] last:border-0">
                  <td className="w-[200px] py-1.5 pr-3 align-top">
                    <code className="rounded bg-[#F3F4F5] px-1.5 py-0.5 text-[11.5px] font-semibold text-[#15181D]">
                      {keys}
                    </code>
                  </td>
                  <td className="py-1.5 text-[#4A4F57]">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </Modal>
  );
}
