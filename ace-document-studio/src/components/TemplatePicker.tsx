import { Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { BUILTIN_TEMPLATES } from '../model/templates';
import type { StudioDoc, UserTemplate } from '../model/types';
import { useStore } from '../store';
import { Modal } from './ui';
import { PageView } from './PageView';

const THUMB_W = 148;
const THUMB_SCALE = THUMB_W / 816;

function TemplateCard({
  name,
  tagline,
  doc,
  testId,
  onPick,
  onDelete,
}: {
  name: string;
  tagline: string;
  doc: StudioDoc;
  testId: string;
  onPick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="group relative w-[148px]">
      <button
        type="button"
        data-testid={testId}
        onClick={onPick}
        className="block w-full cursor-pointer overflow-hidden rounded-[7px] border border-[#D8DBDE] bg-white shadow-[0_1px_4px_rgba(21,24,29,0.08)] transition-all hover:border-[#C8102E] hover:shadow-[0_4px_14px_rgba(21,24,29,0.18)]"
        style={{ height: THUMB_W * (11 / 8.5) }}
        aria-label={`New document from ${name}`}
      >
        <div
          style={{
            transform: `scale(${THUMB_SCALE})`,
            transformOrigin: 'top left',
            width: 816,
            pointerEvents: 'none',
          }}
        >
          <PageView doc={doc} mode="thumb" />
        </div>
      </button>
      {onDelete && (
        <button
          type="button"
          aria-label={`Delete template ${name}`}
          title="Delete this saved template"
          onClick={onDelete}
          className="absolute top-1.5 right-1.5 cursor-pointer rounded-[5px] border border-[#D8DBDE] bg-white p-1.5 text-[#4A4F57] opacity-0 shadow transition-opacity group-hover:opacity-100 hover:text-[#C8102E]"
        >
          <Trash2 size={12} />
        </button>
      )}
      <div className="mt-1.5 px-0.5">
        <div
          className="truncate text-[12.5px] font-bold text-[#15181D]"
          style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
        >
          {name}
        </div>
        <div className="text-[10.5px] leading-tight text-[#6D6E71]">{tagline}</div>
      </div>
    </div>
  );
}

// "New Document" → pick a starting point: the built-in store document
// types, plus anything saved with "Save as template".
export function TemplatePicker({ onClose }: { onClose: () => void }) {
  const createNewDoc = useStore((s) => s.createNewDoc);
  const [userTemplates, setUserTemplates] = useState<UserTemplate[]>([]);

  useEffect(() => {
    void api.listTemplates().then(setUserTemplates);
  }, []);

  // Template docs are built once per open, so thumbnails stay stable.
  const builtins = useMemo(
    () => BUILTIN_TEMPLATES.map((t) => ({ ...t, doc: t.make() })),
    [],
  );

  const pick = (doc: StudioDoc) => {
    onClose();
    void createNewDoc(doc);
  };

  return (
    <Modal title="New document — pick a starting point" onClose={onClose} wide>
      <div className="flex flex-wrap gap-4" data-testid="template-grid">
        {builtins.map((t) => (
          <TemplateCard
            key={t.id}
            name={t.name}
            tagline={t.tagline}
            doc={t.doc}
            testId={`template-${t.id}`}
            onPick={() => pick(t.doc)}
          />
        ))}
      </div>
      {userTemplates.length > 0 && (
        <>
          <h3
            className="mt-5 mb-2 text-[11px] font-bold tracking-[0.1em] text-[#6D6E71] uppercase"
            style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
          >
            Your saved templates
          </h3>
          <div className="flex flex-wrap gap-4">
            {userTemplates.map((t) => (
              <TemplateCard
                key={t.id}
                name={t.name}
                tagline={`Saved ${new Date(t.savedAt).toLocaleDateString()}`}
                doc={t.doc}
                testId={`template-user-${t.id}`}
                onPick={() => pick(t.doc)}
                onDelete={() => {
                  void api.deleteTemplate(t.id).then(() =>
                    setUserTemplates((cur) => cur.filter((x) => x.id !== t.id)),
                  );
                }}
              />
            ))}
          </div>
        </>
      )}
      <p className="mt-4 text-[11px] text-[#8A9099]">
        Any document can become a starting point — open it and use “Save as template” in the
        left panel.
      </p>
    </Modal>
  );
}
