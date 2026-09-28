import { computeOrderTotals, decimal, discountExceedsCap, toWesternDigits, uuidv7, type OrderTotals } from '@mpe/shared'
import type { NewOrderInput } from './actions'

/**
 * The state of the "new order" form and its rules, kept free of any UI so it can be tested on its own.
 * Every number is validated with the SAME schema the server uses, so a form that says "OK" produces an order the server accepts.
 */
export interface DraftLine { key: string; name: string; quantity: string; unitPrice: string; discount: string; productId?: string }
export interface OrderDraft {
  customerId: string | null
  lines: DraftLine[]
  fulfillmentType: 'pickup' | 'delivery'
  deliveryAddress: string
  deliveryCity: string
  deliveryNotes: string
  deliveryFee: string
  discountTotal: string
  paymentMethod: 'cash' | 'cod' | 'whish_money'
  /** yyyy-mm-dd from a date input, or '' */
  dueDate: string
  customerNotes: string
  internalNotes: string
}

export const newLine = (over: Partial<DraftLine> = {}): DraftLine => ({ key: uuidv7(), name: '', quantity: '1', unitPrice: '', discount: '', ...over })

export const emptyDraft = (): OrderDraft => ({
  customerId: null, lines: [newLine()], fulfillmentType: 'pickup', deliveryAddress: '', deliveryCity: '', deliveryNotes: '', deliveryFee: '',
  discountTotal: '', paymentMethod: 'cod', dueDate: '', customerNotes: '', internalNotes: '',
})

/** Arabic keyboards type ٣٫٥ or 3,5; keep only what a decimal number can contain. */
export const cleanDecimal = (text: string): string => toWesternDigits(text).replace(/[٫,،]/g, '.').replace(/[^\d.]/g, '')

export type DraftIssueCode =
  | 'customer' | 'no_lines' | 'line_name' | 'line_quantity' | 'line_price' | 'line_discount' | 'negative_line'
  | 'discount_total' | 'delivery_fee' | 'negative_total' | 'too_large' | 'address' | 'discount_cap'
export interface DraftIssue { code: DraftIssueCode; /** 1-based line number for line issues */ line?: number }

export interface DraftEvaluation {
  issues: DraftIssue[]
  /** Present only when every amount is valid. */
  totals: (OrderTotals & { ok: true }) | null
  /** Lines the person actually filled in (an untouched blank row is ignored). */
  lines: DraftLine[]
}

const validDecimal = (value: string) => decimal.safeParse(value).success
const isBlank = (line: DraftLine) => !line.name.trim() && !line.unitPrice.trim() && !line.discount.trim()
const isPositive = (value: string) => Number(value) > 0

/** What the shop allows this person to do, so the form refuses early instead of letting the server refuse later. */
export interface DraftPolicy { maxDiscountPercent: number | null; mayOverrideDiscount: boolean }

/**
 * The line-item and discount rules shared by a new order and an edit to an existing one's items: every filled
 * line has a name, a positive quantity, and a valid price; the discount (if any) is a valid amount and, unless
 * this person may override it, does not exceed the shop's cap.
 */
function evaluateLinesAndDiscount(lines: DraftLine[], discountTotal: string, deliveryFee: string, policy: DraftPolicy): { issues: DraftIssue[]; totals: DraftEvaluation['totals']; lines: DraftLine[] } {
  const issues: DraftIssue[] = []
  const filled = lines.filter((line) => !isBlank(line))
  if (filled.length === 0) issues.push({ code: 'no_lines' })

  filled.forEach((line, index) => {
    const n = index + 1
    if (!line.name.trim()) issues.push({ code: 'line_name', line: n })
    if (!validDecimal(line.quantity) || !isPositive(line.quantity)) issues.push({ code: 'line_quantity', line: n })
    if (!validDecimal(line.unitPrice)) issues.push({ code: 'line_price', line: n })
    if (line.discount.trim() && !validDecimal(line.discount)) issues.push({ code: 'line_discount', line: n })
  })
  if (discountTotal.trim() && !validDecimal(discountTotal)) issues.push({ code: 'discount_total' })

  let totals: DraftEvaluation['totals'] = null
  if (issues.length === 0) {
    const computed = computeOrderTotals({
      lines: filled.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount.trim() || 0 })),
      discountTotal: discountTotal.trim() || 0, deliveryFee: deliveryFee.trim() || 0,
    })
    if (computed.ok) totals = computed
    else if (computed.error === 'negative_line') issues.push({ code: 'negative_line', line: (computed.line ?? 0) + 1 })
    else if (computed.error === 'negative_total') issues.push({ code: 'negative_total' })
    else issues.push({ code: 'too_large' })
  }

  if (totals && !policy.mayOverrideDiscount) {
    // Everything taken off the lines plus what is taken off the order, against the order before any discount.
    const lineDiscounts = filled.reduce((sum, l) => sum + Number(l.discount.trim() || 0), 0)
    const beforeDiscount = Number(totals.subtotal) + lineDiscounts
    const given = lineDiscounts + Number(totals.discountTotal)
    if (discountExceedsCap(beforeDiscount.toFixed(2), given.toFixed(2), policy.maxDiscountPercent)) issues.push({ code: 'discount_cap' })
  }
  return { issues, totals, lines: filled }
}

export function evaluateDraft(draft: OrderDraft, policy: DraftPolicy = { maxDiscountPercent: null, mayOverrideDiscount: true }): DraftEvaluation {
  const delivery = draft.fulfillmentType === 'delivery'
  const issues: DraftIssue[] = []
  if (!draft.customerId) issues.push({ code: 'customer' })
  const shared = evaluateLinesAndDiscount(draft.lines, draft.discountTotal, delivery ? draft.deliveryFee : '', policy)
  issues.push(...shared.issues)
  if (delivery && draft.deliveryFee.trim() && !validDecimal(draft.deliveryFee)) issues.push({ code: 'delivery_fee' })
  if (delivery && !draft.deliveryAddress.trim()) issues.push({ code: 'address' })
  return { issues, totals: shared.totals, lines: shared.lines }
}

/** Evaluating a change to an existing order's items: the same line and discount rules, without the customer or
 *  delivery fields — those are not part of this edit. */
export function evaluateItemsEdit(lines: DraftLine[], discountTotal: string, deliveryFee: string, policy: DraftPolicy = { maxDiscountPercent: null, mayOverrideDiscount: true }): DraftEvaluation {
  const { issues, totals, lines: filled } = evaluateLinesAndDiscount(lines, discountTotal, deliveryFee, policy)
  return { issues, totals, lines: filled }
}

/** Only call when evaluateDraft found no issues. */
export function draftToInput(draft: OrderDraft): NewOrderInput {
  const { issues, lines } = evaluateDraft(draft)
  if (issues.length > 0 || !draft.customerId) throw new Error('The draft is not valid')
  const delivery = draft.fulfillmentType === 'delivery'
  return {
    customerId: draft.customerId,
    items: lines.map((l) => ({ name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, ...(l.discount.trim() ? { discount: l.discount } : {}), ...(l.productId ? { productId: l.productId } : {}) })),
    fulfillmentType: draft.fulfillmentType,
    paymentMethod: draft.paymentMethod,
    ...(delivery ? { deliveryAddress: draft.deliveryAddress, deliveryCity: draft.deliveryCity, deliveryNotes: draft.deliveryNotes, ...(draft.deliveryFee.trim() ? { deliveryFee: draft.deliveryFee } : {}) } : {}),
    ...(draft.discountTotal.trim() ? { discountTotal: draft.discountTotal } : {}),
    ...(draft.customerNotes.trim() ? { customerNotes: draft.customerNotes } : {}),
    ...(draft.internalNotes.trim() ? { internalNotes: draft.internalNotes } : {}),
    ...(draft.dueDate ? { dueAt: new Date(`${draft.dueDate}T23:59:00`).toISOString() } : {}),
  }
}
