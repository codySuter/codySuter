import { ArrowLeft, CheckCircle2, LifeBuoy, Mail } from 'lucide-react';
import { useState } from 'react';
import { api, type SupportResult, type SupportTicket } from '../api';
import { useStore } from '../store';
import { AppHeader, Btn, Field, Seg, inputCls } from './ui';

const CATEGORIES: SupportTicket['category'][] = ['Bug', 'Issue', 'Feature idea'];

export function Support() {
  const leaveSupport = useStore((s) => s.leaveSupport);
  const setStatus = useStore((s) => s.setStatus);
  const [category, setCategory] = useState<SupportTicket['category']>('Bug');
  const [message, setMessage] = useState('');
  const [expected, setExpected] = useState('');
  const [reporter, setReporter] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SupportResult | null>(null);

  const submit = async () => {
    if (!message.trim() || busy) return;
    setBusy(true);
    const r = await api.supportTicket({
      category,
      message: message.trim(),
      expected: expected.trim(),
      reporter: reporter.trim(),
    });
    setBusy(false);
    setResult(r);
    setStatus(
      r.ok
        ? `Support ticket ready — send the email to ${r.email}.`
        : `Couldn't create the ticket: ${r.error ?? 'unknown error'}`,
    );
  };

  const reset = () => {
    setResult(null);
    setMessage('');
    setExpected('');
  };

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        left={
          <Btn variant="topbar" onClick={leaveSupport} data-testid="support-back">
            <ArrowLeft size={14} /> Back
          </Btn>
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[640px] px-8 py-8">
          <div className="mb-1 flex items-center gap-2 text-[#C8102E]">
            <LifeBuoy size={16} />
            <span
              className="text-[12px] font-bold tracking-[0.1em] uppercase"
              style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
            >
              Support
            </span>
          </div>
          <h1
            className="text-[26px] font-extrabold text-[#15181D] uppercase"
            style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
          >
            Something broken? Want a feature?
          </h1>
          <div className="mb-6 mt-1 h-[3px] w-[64px] rounded bg-[#C8102E]" />

          {result?.ok ? (
            <div
              data-testid="support-done"
              className="rounded-[8px] border border-[#D8DBDE] bg-white p-6"
            >
              <div className="mb-3 flex items-center gap-2 text-[#005238]">
                <CheckCircle2 size={20} />
                <span
                  className="text-[16px] font-extrabold uppercase"
                  style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
                >
                  Ticket ready — one more step
                </span>
              </div>
              <ol className="ml-5 list-decimal space-y-2 text-[13px] leading-relaxed text-[#20242B]">
                <li>
                  {result.opened
                    ? `An email draft to ${result.email} just opened in your mail app — hit Send.`
                    : `Open your email and start a new message to ${result.email}. The full report is on your clipboard — paste it in.`}
                </li>
                {result.reportPath && (
                  <li>
                    A diagnostics file with logs was saved to your Desktop
                    {': '}
                    <span className="font-mono text-[11.5px] text-[#4A4F57]">{result.reportPath}</span>
                    {' — '}
                    <b>attach it to the email</b> so Cody can see what happened.
                  </li>
                )}
                <li>
                  Email didn't open? Everything was also copied to your clipboard — paste it into
                  any new email to <b>{result.email}</b>.
                </li>
              </ol>
              <div className="mt-5 flex gap-2">
                <Btn variant="primary" onClick={leaveSupport}>
                  Done
                </Btn>
                <Btn onClick={reset}>Report something else</Btn>
              </div>
            </div>
          ) : (
            <div className="rounded-[8px] border border-[#D8DBDE] bg-white p-6">
              <div className="mb-4">
                <span className="mb-1 block text-[11.5px] font-medium text-[#4A4F57]">
                  What kind of ticket is this?
                </span>
                <Seg
                  value={category}
                  onChange={setCategory}
                  options={CATEGORIES.map((c) => ({ value: c, label: c }))}
                />
              </div>
              <Field label="What happened? (or what do you wish the app did?)">
                <textarea
                  data-testid="support-message"
                  className={`${inputCls} min-h-[120px] resize-y`}
                  value={message}
                  autoFocus
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell it like it is — what were you doing, what went wrong, any error messages you saw…"
                />
              </Field>
              <Field label="What did you expect to happen? (optional)">
                <textarea
                  className={`${inputCls} min-h-[64px] resize-y`}
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                />
              </Field>
              <Field label="Your name (optional — helps Cody follow up)">
                <input
                  className={inputCls}
                  value={reporter}
                  onChange={(e) => setReporter(e.target.value)}
                />
              </Field>
              <div className="mt-2 flex items-center gap-3">
                <Btn
                  variant="primary"
                  data-testid="support-submit"
                  disabled={!message.trim() || busy}
                  onClick={() => void submit()}
                >
                  <Mail size={14} /> {busy ? 'Preparing…' : 'Create email ticket'}
                </Btn>
                <span className="text-[11.5px] text-[#8A9099]">
                  Opens a pre-filled email to csuter@snydersace.net with app logs and
                  diagnostics included.
                </span>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
