import { uid } from './blocks';
import type { Block, PolicyDoc } from './types';
import { DEFAULT_KICKER } from './types';

// The store's three existing Policy & Procedures documents, converted
// 1:1 from the claude.ai design project so the library starts full.

const s = (title: string): Block => ({ id: uid(), type: 'section', title });
const p = (html: string, muted = false): Block => ({
  id: uid(),
  type: 'paragraph',
  html,
  muted,
});
const badge = (
  label: string,
  html: string,
  badgeColor: 'accent' | 'ink' = 'accent',
): Block => ({ id: uid(), type: 'badgeRow', badge: label, badgeColor, html });
const bullets = (items: string[]): Block => ({ id: uid(), type: 'bullets', items });
const callout = (heading: string, body: string): Block => ({
  id: uid(),
  type: 'callout',
  heading,
  body,
});

function doc(
  id: string,
  title: string,
  subtitle: string,
  blocks: Block[],
  chip: PolicyDoc['chip'] = null,
): PolicyDoc {
  const now = Date.now();
  return {
    id,
    title,
    kicker: DEFAULT_KICKER,
    subtitle,
    chip,
    accent: '#C8102E',
    audience: 'employee',
    blocks,
    createdAt: now,
    updatedAt: now,
  };
}

export function starterDocs(): PolicyDoc[] {
  const grill = doc(
    'starter-grill',
    'Grill Special Orders',
    'Employee Policy — Assembly, Delivery & Payment',
    [
      s('Confirm Stock First — Then Pick the Order Path'),
      p(
        '<strong>No grill is promised as in stock without an employee putting eyes on the box.</strong> Verify physically before telling the customer anything.',
        true,
      ),
      badge('IN STOCK', 'Write the special order <strong>at the register in POS</strong>.'),
      badge(
        'ORDER IN',
        'Confirm the <strong>RSC has it in stock</strong>, order <strong>through AOS</strong>, then import to POS. Backordered? Offer alternatives or check the RSC ETA.',
        'ink',
      ),
      p(
        '<strong>Never add delivery in AOS.</strong> Adding it there schedules the delivery — delivery is scheduled only <strong>after assembly is complete</strong>.',
      ),
      s('Free Assembly & Delivery — All Three Required'),
      p(
        'Confirm all three before quoting free assembly & delivery. If any one fails, get a <strong>manager</strong> for delivery pricing — never quote your own.',
        true,
      ),
      badge(
        'REWARDS',
        '<strong>Ace Rewards member</strong> — a members-only benefit. Not a member? Sign them up.',
      ),
      badge(
        '$399+',
        'Order totals <strong>$399 or more</strong>. Under it? Add accessories — propane tank, cover, tools — to reach the threshold.',
      ),
      badge(
        '18 MI',
        'Address within an <strong>18-mile radius</strong> of the store. Outside it — manager for options.',
      ),
      p(
        '<strong>Special access adds a charge.</strong> Even within the radius, stairs, tight access, or a long carry may add a delivery fee — check with a manager for pricing <strong>before quoting the customer</strong>.',
      ),
      s('Payment & What Goes on Every Order'),
      bullets([
        '<strong>Paid in full at the time of order.</strong> Enter the full total as the deposit amount — no partial deposits.',
        '<strong>Ask about accessories — every order.</strong> Propane tank, grill cover, tools / cleaning kit.',
        '<strong>Note on the order (Comment F3):</strong> accessories taken now or out with the grill · assembled and/or delivered · access needs · haul-away · other notes (gift, secondary contact).',
        '<strong>Haul-away:</strong> free for members, <strong>$45 for non-members</strong>. Old grill must be disconnected and reachable.',
      ]),
      s('After the Sale — Scheduling & Filing'),
      callout(
        'Never promise a <span class="hl">delivery date</span> at the time of purchase',
        'The delivery team calls to schedule once the grill is assembled and ready. Attended deliveries: the customer must answer the confirmation call before we send the driver.',
      ),
      bullets([
        '<strong>In-stock grill:</strong> attach the printed invoice to the grill box <strong>immediately</strong> and notate the Assembly whiteboard to join the 3-day assembly queue.',
        '<strong>Ordered-in grill:</strong> printed invoice goes in the <strong>special-order folder behind the register</strong> so it joins the assembly queue when the grill arrives.',
      ]),
      s('Questions & Escalation'),
      p(
        'Unsure about delivery pricing, eligibility, or a special situation? Ask a <strong>manager</strong>. Do not guess on pricing, dates, or delivery fees.',
      ),
    ],
  );

  const stihl = doc(
    'starter-stihl',
    'STIHL Special Order Inquiries',
    'Employee Policy & Intake Procedures',
    [
      s('When to Write an Inquiry'),
      p(
        'Write a STIHL inquiry whenever a customer asks for a STIHL-branded product or part <strong>we do not have in stock</strong>. It’s written as a special order in POS using the <strong>STIHL ORDER INQUIRY</strong> item.',
        true,
      ),
      badge(
        '$0.00',
        '<strong>An inquiry is not a sale — never collect payment.</strong> The inquiry line is no charge; enter $0.00 at the deposit prompt.',
      ),
      s('What to Record — Every Inquiry'),
      bullets([
        '<strong>Customer name and phone number</strong> on the inquiry’s description lines.',
        '<strong>The part / product requested</strong> — plus a specific comment describing the request, e.g. <em>“Customer is looking for the air filter on an FS 91 R trimmer.”</em> Model numbers matter; vague notes stall the order.',
        '<strong>Ace Rewards card</strong> — enter it if the customer has one.',
      ]),
      s('Filing & Follow-Up'),
      bullets([
        '<strong>Save and print</strong> the inquiry so the customer leaves with a copy.',
        'Place the printed inquiry in the <strong>STIHL Inquiry folder behind the register</strong>.',
      ]),
      callout(
        'Follow-up: <span class="hl">48 hours</span>',
        'Tell the customer an Ace STIHL Team member will contact them within 48 hours to confirm the order, pricing, and details. Do not quote pricing or availability at the counter.',
      ),
      s('Questions & Escalation'),
      p(
        'Not sure whether something qualifies as a STIHL inquiry, or a customer asks about an open one? Ask a <strong>manager</strong> or the STIHL team — do not guess on pricing or availability.',
      ),
    ],
    { text: 'STIHL', color: '#F39200' },
  );

  const pickup = doc(
    'starter-pickup',
    'Special Orders for Pickup',
    'Employee Policy — Timelines, Payment & Filing',
    [
      s('Pickup Timeline — What to Tell the Customer'),
      badge(
        'WED 3PM',
        'Orders submitted by <strong>3pm Wednesday</strong> are scheduled to arrive on the <strong>Friday Ace truck</strong>.',
      ),
      badge(
        'SUN NOON',
        'Orders submitted by <strong>noon Sunday</strong> are scheduled to arrive on the following <strong>Tuesday Ace truck</strong>.',
      ),
      callout(
        'Backorder RSC dates are <span class="hl">estimates — not guarantees</span>',
        'The on-order date can change, and even when the RSC receives the product on time, we don’t have it in store until it arrives on the following Ace truck. Never promise a firm arrival date on backordered product.',
      ),
      s('Ordering Rules — Check Before Writing the Order'),
      bullets([
        '<strong>Confirm the RSC has it in stock</strong> before writing the order. Backordered? Check the estimated date — and treat it as an estimate.',
        '<strong>Order multiple &gt; 1? Stop — get a manager.</strong> Some items are only orderable by the full case / order quantity, so the customer may need to buy the whole quantity. Note on the order <strong>who approved it and the agreed quantity</strong>.',
        '<strong>Ask about related items — every order.</strong> Offer the parts, accessories, or consumables that complete the customer’s project and save them a second trip.',
      ]),
      s('Contact Info — Required on Every Order'),
      bullets([
        '<strong>Phone number</strong> and <strong>first &amp; last name</strong> — and note the customer’s <strong>preferred contact method</strong>, call or text.',
        '<strong>Alternate phone</strong> — only if the Ace Rewards number isn’t good for contact.',
        '<strong>Use the same phone number in AOS and at POS</strong> — it’s how the order is matched when importing.',
      ]),
      s('Payment & Filing'),
      bullets([
        '<strong>Paid in full at the time of order — every special order.</strong> Enter the full total as the deposit amount.',
        '<strong>Set expectations:</strong> we’ll contact the customer when the order has been set aside and is ready for pickup.',
        '<strong>Printed invoice → special-order folder behind the register</strong>, so it’s matched to the item when it arrives.',
      ]),
      s('Questions & Escalation'),
      p(
        'Unsure about an order multiple, a backorder date, or whether an item can be ordered? Ask a <strong>manager</strong>. Do not guess on quantities, dates, or pricing.',
      ),
    ],
  );

  return [grill, stihl, pickup];
}
