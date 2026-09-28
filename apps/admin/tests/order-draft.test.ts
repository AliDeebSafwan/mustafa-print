import { describe, expect, it } from 'vitest'
import { MUTATION_PAYLOADS } from '@mpe/shared'
import { cleanDecimal, draftToInput, emptyDraft, evaluateDraft, newLine, type OrderDraft } from '../src/offline/order-draft'

const CUSTOMER = '018f0000-0000-7000-8000-000000000001'
const draft = (over: Partial<OrderDraft> = {}): OrderDraft => ({ ...emptyDraft(), customerId: CUSTOMER, lines: [newLine({ name: 'Flyers A5', quantity: '3', unitPrice: '10.10' })], ...over })
const codes = (d: OrderDraft) => evaluateDraft(d).issues.map((i) => (i.line ? `${i.code}#${i.line}` : i.code))

describe('order draft', () => {
  it('a fresh form is incomplete but not noisy: the blank row is ignored', () => {
    expect(codes(emptyDraft())).toEqual(['customer', 'no_lines'])
  })

  it('computes totals as the customer will be charged', () => {
    const e = evaluateDraft(draft({ discountTotal: '1', fulfillmentType: 'delivery', deliveryAddress: 'Hermel', deliveryFee: '2.50', lines: [newLine({ name: 'A', quantity: '3', unitPrice: '10.10', discount: '0.30' }), newLine({ name: 'B', quantity: '2', unitPrice: '4.5' })] }))
    expect(e.issues).toEqual([])
    expect(e.totals).toMatchObject({ lines: ['30.00', '9.00'], subtotal: '39.00', total: '40.50' })
  })

  it('points at the exact line and field that is wrong', () => {
    const d = draft({ lines: [newLine({ name: 'ok', unitPrice: '5' }), newLine({ name: '', unitPrice: '5' }), newLine({ name: 'x', quantity: '0', unitPrice: '5' }), newLine({ name: 'y', unitPrice: '5.12345' }), newLine({ name: 'z', unitPrice: '5', discount: 'abc' })] })
    expect(codes(d)).toEqual(['line_name#2', 'line_quantity#3', 'line_price#4', 'line_discount#5'])
  })

  it('catches discounts larger than what they discount', () => {
    expect(codes(draft({ lines: [newLine({ name: 'x', unitPrice: '5', discount: '9' })] }))).toEqual(['negative_line#1'])
    expect(codes(draft({ discountTotal: '99' }))).toEqual(['negative_total'])
  })

  it('needs an address only for delivery, and ignores delivery fields for pickup', () => {
    expect(codes(draft({ fulfillmentType: 'delivery' }))).toEqual(['address'])
    expect(codes(draft({ fulfillmentType: 'pickup', deliveryFee: 'garbage' }))).toEqual([])
    expect(evaluateDraft(draft({ fulfillmentType: 'pickup', deliveryFee: '5' })).totals?.total).toBe('30.30')
  })

  it('cleans Arabic-keyboard input into plain decimals', () => {
    expect(cleanDecimal('٣٫٥')).toBe('3.5')
    expect(cleanDecimal('1,250')).toBe('1.250')
    expect(cleanDecimal(' 12 $')).toBe('12')
    expect(cleanDecimal('۱۲.۵۰')).toBe('12.50')
  })

  it('a form that passes the rules always yields a payload the server schema accepts', () => {
    const d = draft({
      fulfillmentType: 'delivery', deliveryAddress: 'Main street', deliveryCity: 'Hermel', deliveryNotes: 'ring twice', deliveryFee: '3', discountTotal: '1.5',
      paymentMethod: 'cash', dueDate: '2026-10-01', customerNotes: 'blue ink', internalNotes: 'VIP',
      lines: [newLine({ name: 'Cards', quantity: '500', unitPrice: '0.05', discount: '1', productId: '018f0000-0000-7000-8000-0000000000aa' }), newLine({ name: 'Poster', quantity: '2.5', unitPrice: '12' })],
    })
    expect(evaluateDraft(d).issues).toEqual([])
    const input = draftToInput(d)
    expect(input).toMatchObject({ customerId: CUSTOMER, fulfillmentType: 'delivery', paymentMethod: 'cash', deliveryFee: '3', discountTotal: '1.5' })
    expect(input.dueAt).toMatch(/^2026-10-0[12]T/)
    expect(() => draftToInput(draft({ customerId: null }))).toThrow()
    // and through the full action -> outbox path this is covered in actions.test.ts
    expect(MUTATION_PAYLOADS['orders:insert']).toBeDefined()
  })
})
