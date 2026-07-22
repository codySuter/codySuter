// Keep pasted/typed rich text down to the formatting the documents use:
// bold, italics, line breaks, and the yellow callout highlight span.
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'BR', 'SPAN']);

function cleanNode(node: Node, out: Node[], doc: Document): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(doc.createTextNode(node.textContent ?? ''));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName;
  const isHl = tag === 'SPAN' && el.classList.contains('hl');
  if (ALLOWED.has(tag) && (tag !== 'SPAN' || isHl)) {
    const kept = doc.createElement(tag.toLowerCase());
    if (isHl) kept.setAttribute('class', 'hl');
    const children: Node[] = [];
    el.childNodes.forEach((c) => cleanNode(c, children, doc));
    children.forEach((c) => kept.appendChild(c));
    out.push(kept);
  } else {
    // Unwrap: keep the children, drop the element. Block-level elements
    // become line breaks so pasted paragraphs don't glue together.
    const blocky = /^(DIV|P|LI|TR|H[1-6])$/.test(tag);
    if (blocky && out.length > 0) out.push(doc.createElement('br'));
    el.childNodes.forEach((c) => cleanNode(c, out, doc));
  }
}

export function sanitizeHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(
    `<div>${html}</div>`,
    'text/html',
  );
  const root = parsed.body.firstElementChild;
  if (!root) return '';
  const out: Node[] = [];
  root.childNodes.forEach((c) => cleanNode(c, out, parsed));
  const holder = parsed.createElement('div');
  out.forEach((n) => holder.appendChild(n));
  // Trim trailing <br>s and collapse whitespace-only content to ''.
  while (
    holder.lastChild &&
    holder.lastChild.nodeType === Node.ELEMENT_NODE &&
    (holder.lastChild as Element).tagName === 'BR'
  ) {
    holder.removeChild(holder.lastChild);
  }
  if (!holder.textContent?.trim() && !holder.querySelector('br')) return '';
  return holder.innerHTML;
}

export function plainText(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return parsed.body.textContent ?? '';
}
