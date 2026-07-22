import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  TEMPLATE_META,
  TEMPLATE_SECTIONS,
  generateDoc,
  type TemplateKind,
  type WizardAnswers,
} from '../model/templates';
import { ACCENT_PRESETS } from '../model/types';
import { useStore } from '../store';
import { AppHeader, Btn, Field, Swatches, inputCls } from './ui';
import { PageView } from './PageView';

const STEPS = ['Type', 'Basics', 'Sections'] as const;

export function Wizard() {
  const toLibrary = useStore((s) => s.toLibrary);
  const createFromWizard = useStore((s) => s.createFromWizard);

  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<TemplateKind>('policy');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [accent, setAccent] = useState<string>(ACCENT_PRESETS[0]);
  const [chipOn, setChipOn] = useState(false);
  const [chipText, setChipText] = useState('');
  const [chipColor, setChipColor] = useState('#F39200');
  const [sectionKeys, setSectionKeys] = useState<string[]>(
    TEMPLATE_SECTIONS.policy.filter((s) => s.recommended).map((s) => s.key),
  );

  const answers: WizardAnswers = useMemo(
    () => ({
      kind,
      title: title || 'Your Document Title',
      subtitle: subtitle || TEMPLATE_META[kind].subtitlePlaceholder,
      accent,
      chip: chipOn ? { text: chipText || 'BRAND', color: chipColor } : null,
      sectionKeys,
    }),
    [kind, title, subtitle, accent, chipOn, chipText, chipColor, sectionKeys],
  );

  const preview = useMemo(() => generateDoc(answers), [answers]);

  const pickKind = (k: TemplateKind) => {
    setKind(k);
    setSectionKeys(TEMPLATE_SECTIONS[k].filter((s) => s.recommended).map((s) => s.key));
  };

  const toggleSection = (key: string) => {
    setSectionKeys((keys) => {
      if (keys.includes(key)) return keys.filter((k) => k !== key);
      // keep template order
      const order = TEMPLATE_SECTIONS[kind].map((s) => s.key);
      return [...keys, key].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    });
  };

  const create = () => {
    void createFromWizard({ ...answers, title: title.trim() || 'Untitled document' });
  };

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        left={
          <Btn variant="topbar" onClick={() => void toLibrary()}>
            <ArrowLeft size={14} /> Library
          </Btn>
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1020px] gap-8 px-8 py-8">
          {/* left: the questions */}
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 text-[#C8102E]">
              <Sparkles size={16} />
              <span
                className="text-[12px] font-bold tracking-[0.1em] uppercase"
                style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
              >
                New document
              </span>
            </div>
            <h1
              className="text-[26px] font-extrabold text-[#15181D] uppercase"
              style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
            >
              {step === 0 && 'What are we making?'}
              {step === 1 && 'The basics'}
              {step === 2 && 'Pick your sections'}
            </h1>

            <div className="mb-6 mt-3 flex items-center gap-2">
              {STEPS.map((label, i) => (
                <div key={label} className="flex items-center gap-2">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10.5px] font-bold ${
                      i < step
                        ? 'bg-[#005238] text-white'
                        : i === step
                          ? 'bg-[#C8102E] text-white'
                          : 'bg-[#D8DBDE] text-[#6D6E71]'
                    }`}
                  >
                    {i < step ? <Check size={11} /> : i + 1}
                  </span>
                  <span
                    className={`text-[11.5px] font-semibold uppercase tracking-wide ${
                      i === step ? 'text-[#15181D]' : 'text-[#9AA1A8]'
                    }`}
                    style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
                  >
                    {label}
                  </span>
                  {i < STEPS.length - 1 && <span className="h-px w-6 bg-[#D8DBDE]" />}
                </div>
              ))}
            </div>

            {step === 0 && (
              <div className="flex flex-col gap-3">
                {(Object.keys(TEMPLATE_META) as TemplateKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    data-testid={`wizard-kind-${k}`}
                    onClick={() => pickKind(k)}
                    className={`cursor-pointer rounded-[8px] border-2 bg-white p-4 text-left transition-colors ${
                      kind === k
                        ? 'border-[#C8102E] shadow-[0_2px_10px_rgba(200,16,46,0.12)]'
                        : 'border-[#DDE0E3] hover:border-[#9AA1A8]'
                    }`}
                  >
                    <div
                      className="text-[15.5px] font-extrabold text-[#15181D] uppercase"
                      style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
                    >
                      {TEMPLATE_META[k].label}
                    </div>
                    <div className="mt-1 text-[12.5px] leading-relaxed text-[#4A4F57]">
                      {TEMPLATE_META[k].description}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {step === 1 && (
              <div className="max-w-[420px]">
                <Field label="Document title">
                  <input
                    data-testid="wizard-title"
                    className={inputCls}
                    value={title}
                    autoFocus
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Returns & Refunds"
                  />
                </Field>
                <Field label="Subtitle — what this document covers">
                  <input
                    data-testid="wizard-subtitle"
                    className={inputCls}
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    placeholder={TEMPLATE_META[kind].subtitlePlaceholder}
                  />
                </Field>
                <Field label="Accent color">
                  <Swatches value={accent} onChange={setAccent} presets={ACCENT_PRESETS} />
                </Field>
                <label className="mt-3 flex items-center gap-2 text-[12.5px] text-[#20242B]">
                  <input
                    type="checkbox"
                    checked={chipOn}
                    onChange={(e) => setChipOn(e.target.checked)}
                  />
                  Add a brand chip in the header (like the orange STIHL tag)
                </label>
                {chipOn && (
                  <div className="mt-2 flex items-center gap-2 pl-6">
                    <input
                      className={`${inputCls} w-[140px] uppercase`}
                      value={chipText}
                      onChange={(e) => setChipText(e.target.value)}
                      placeholder="STIHL"
                      style={{ fontFamily: "'Barlow Semi Condensed', sans-serif", fontWeight: 700 }}
                    />
                    <input
                      type="color"
                      aria-label="Chip color"
                      value={chipColor}
                      onChange={(e) => setChipColor(e.target.value)}
                      className="h-8 w-11 cursor-pointer rounded border border-[#C9CED4]"
                    />
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="flex max-w-[460px] flex-col gap-2">
                {TEMPLATE_SECTIONS[kind].map((s) => (
                  <label
                    key={s.key}
                    data-testid={`wizard-section-${s.key}`}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-[7px] border bg-white p-3 ${
                      sectionKeys.includes(s.key) ? 'border-[#C8102E]' : 'border-[#DDE0E3]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={sectionKeys.includes(s.key)}
                      onChange={() => toggleSection(s.key)}
                    />
                    <span>
                      <span className="block text-[13px] font-semibold text-[#15181D]">
                        {s.label}
                      </span>
                      <span className="block text-[11.5px] text-[#6D6E71]">{s.hint}</span>
                    </span>
                  </label>
                ))}
                <p className="mt-1 text-[11.5px] text-[#8A9099]">
                  This just builds your starting outline — you can add, remove, and drag
                  sections around any time.
                </p>
              </div>
            )}

            <div className="mt-7 flex items-center gap-2">
              {step > 0 && (
                <Btn onClick={() => setStep(step - 1)}>
                  <ArrowLeft size={13} /> Back
                </Btn>
              )}
              {step < 2 ? (
                <Btn
                  variant="primary"
                  data-testid="wizard-next"
                  disabled={step === 1 && !title.trim()}
                  onClick={() => setStep(step + 1)}
                >
                  Next <ArrowRight size={13} />
                </Btn>
              ) : (
                <Btn variant="primary" data-testid="wizard-create" onClick={create}>
                  Create document <ArrowRight size={13} />
                </Btn>
              )}
              {step === 1 && !title.trim() && (
                <span className="text-[11.5px] text-[#9E0620]">Give it a title first.</span>
              )}
            </div>
          </div>

          {/* right: live preview */}
          <div className="hidden w-[300px] shrink-0 lg:block">
            <div
              className="mb-2 text-[11px] font-bold tracking-[0.1em] text-[#6D6E71] uppercase"
              style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
            >
              Live preview
            </div>
            <div
              className="overflow-hidden rounded-[7px] border border-[#D8DBDE] bg-white shadow-[0_2px_10px_rgba(21,24,29,0.10)]"
              style={{ height: 300 * (11 / 8.5) }}
            >
              <div
                style={{
                  transform: `scale(${300 / 816})`,
                  transformOrigin: 'top left',
                  width: 816,
                  pointerEvents: 'none',
                }}
              >
                <PageView doc={preview} mode="thumb" />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
