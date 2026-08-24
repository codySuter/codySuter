import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { sanitizeHtml } from '../model/sanitize';
import { useStore } from '../store';

export interface EditableHandle {
  focus(): void;
}

interface Props {
  html: string;
  onCommit: (html: string) => void;
  style?: CSSProperties;
  className?: string;
  singleLine?: boolean;
  placeholder?: string;
  allowHighlight?: boolean;
  onEnter?: () => void;
  onEmptyBackspace?: () => void;
  onFocus?: () => void;
  /**
   * Multi-line paste handler: the first pasted line is inserted at the
   * caret; the remaining non-empty lines are handed here (lists turn them
   * into items, paragraphs into new paragraph blocks).
   */
  onPasteLines?: (lines: string[]) => void;
}

// Toggle the brand-yellow highlight span on the current selection.
// Used inside callout headings (dark background), via Ctrl+H or the
// inspector button.
export function toggleHighlightSelection(): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);

  let hl: HTMLElement | null = null;
  let node: Node | null = range.commonAncestorContainer;
  while (node) {
    if (node instanceof HTMLElement) {
      if (node.classList.contains('hl')) {
        hl = node;
        break;
      }
      if (node.hasAttribute('contenteditable')) break;
    }
    node = node.parentNode;
  }

  if (hl) {
    const parent = hl.parentNode;
    if (!parent) return;
    while (hl.firstChild) parent.insertBefore(hl.firstChild, hl);
    parent.removeChild(hl);
  } else {
    const span = document.createElement('span');
    span.className = 'hl';
    try {
      range.surroundContents(span);
    } catch {
      span.appendChild(range.extractContents());
      range.insertNode(span);
    }
    sel.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(span);
    sel.addRange(r);
  }

  const anchor = sel.anchorNode;
  const host =
    (anchor instanceof HTMLElement ? anchor : anchor?.parentElement)?.closest(
      '[contenteditable="true"]',
    ) ?? null;
  host?.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

export const Editable = forwardRef<EditableHandle, Props>(function Editable(
  {
    html,
    onCommit,
    style,
    className,
    singleLine,
    placeholder,
    allowHighlight,
    onEnter,
    onEmptyBackspace,
    onFocus,
    onPasteLines,
  },
  outerRef,
) {
  const ref = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(outerRef, () => ({
    focus() {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    },
  }));

  // Uncontrolled: only write the DOM when the prop genuinely differs
  // (external change, undo, sanitize-on-blur) so the caret never jumps
  // while typing.
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== html) el.innerHTML = html;
  });

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (onEnter) onEnter();
      else if (singleLine) ref.current?.blur();
      else document.execCommand('insertLineBreak');
      return;
    }
    if (e.key === 'Enter' && e.shiftKey && !singleLine) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      return;
    }
    if (
      e.key === 'Backspace' &&
      onEmptyBackspace &&
      (ref.current?.textContent ?? '') === ''
    ) {
      e.preventDefault();
      onEmptyBackspace();
      return;
    }
    if (allowHighlight && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      toggleHighlightSelection();
    }
  };

  return (
    <div
      ref={ref}
      className={`aps-editable ${className ?? ''}`}
      style={style}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-ph={placeholder ?? 'Type here…'}
      onInput={() => {
        const el = ref.current;
        if (el) onCommit(el.innerHTML);
      }}
      onFocus={onFocus}
      onBlur={() => {
        const el = ref.current;
        if (el) onCommit(sanitizeHtml(el.innerHTML));
        // Each focus-edit-blur session becomes its own undo step.
        useStore.getState().breakHistory();
      }}
      onKeyDown={handleKeyDown}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        const lines = text
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '');
        if (lines.length === 0) return;
        if (singleLine) {
          document.execCommand('insertText', false, lines.join(' '));
          return;
        }
        if (onPasteLines && lines.length > 1) {
          document.execCommand('insertText', false, lines[0]);
          onPasteLines(lines.slice(1));
          return;
        }
        // Multi-line into one field: keep the line structure with breaks.
        lines.forEach((line, i) => {
          if (i > 0) document.execCommand('insertLineBreak');
          document.execCommand('insertText', false, line);
        });
      }}
    />
  );
});
