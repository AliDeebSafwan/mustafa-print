import { describe, expect, it } from 'vitest'
import { ASSIGNABLE_ROLES, MUTATION_PAYLOADS, PAYMENT_STATUSES, QUOTE_STATUSES, ROLE_KEYS, TOGGLEABLE_PERMISSIONS } from '@mpe/shared'
import ar from '../src/i18n/ar.json'
import en from '../src/i18n/en.json'

const flatten = (obj: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]))
const arKeys = new Set(flatten(ar))
const enKeys = new Set(flatten(en))

// Every source file of the app as text (Vite resolves this at test time; no filesystem API needed).
const sources = import.meta.glob<string>('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

describe('translations', () => {
  it('Arabic and English define exactly the same keys', () => {
    expect([...arKeys].filter((k) => !enKeys.has(k))).toEqual([])
    expect([...enKeys].filter((k) => !arKeys.has(k))).toEqual([])
  })

  it('every literal key used in the code exists (a missing key would show up as raw text in the shop)', () => {
    const used = new Set<string>()
    for (const source of Object.values(sources)) {
      for (const m of source.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) used.add(m[1]!)
    }
    expect([...used].filter((k) => !arKeys.has(k))).toEqual([])
    expect(used.size).toBeGreaterThan(80)
  })

  it('covers every value behind the dynamically built keys', () => {
    const needed = [
      ...PAYMENT_STATUSES.map((s) => `paymentStatus.${s}`),
      ...['cod', 'cash', 'whish_money'].map((m) => `method.${m}`),
      ...['payment', 'refund'].map((k) => `pay.type.${k}`),
      ...['pickup', 'delivery'].map((k) => `newOrder.${k}`),
      ...['order_missing', 'invalid_amount', 'order_cancelled', 'refund_exceeds_paid'].map((c) => `pay.err.${c}`),
      // one sentence per kind of offline change, for the review screen
      ...Object.keys(MUTATION_PAYLOADS).map((kind) => `review.kind.${kind}`),
      ...['retry', 'dismiss', 'discard'].map((a) => `review.action.${a}`),
      ...['customer', 'no_lines', 'line_name', 'line_quantity', 'line_price', 'line_discount', 'negative_line', 'discount_total', 'delivery_fee', 'negative_total', 'too_large', 'address'].map((c) => `issue.${c}`),
      // codes the server sends back in mutation results
      ...['forbidden', 'order_not_found', 'refund_exceeds_paid', 'order_cancelled', 'reference_not_found', 'constraint_violation', 'invalid_payload', 'already_exists', 'order_closed', 'phone_already_registered', 'no_consented_channel'].map((c) => `reason.${c}`),
      // the team screen: every role a person could have, the roles this UI may assign, and every delegable permission
      ...ROLE_KEYS.map((r) => `team.role.${r}`),
      ...ASSIGNABLE_ROLES.map((r) => `team.role.${r}`),
      ...TOGGLEABLE_PERMISSIONS.map((p) => `team.permission.${p}`),
      ...['staff', 'auditLog', 'settings'].map((s) => `team.section.${s}`),
      ...[...QUOTE_STATUSES, 'expired'].map((q) => `quotes.status.${q}`),
      ...['pending', 'approved', 'changes_requested', 'superseded'].map((p) => `proofs.status.${p}`),
      ...['pending', 'approved', 'changes_requested'].map((p) => `proofs.orderBanner.${p}`),
    ]
    expect(needed.filter((k) => !arKeys.has(k))).toEqual([])
  })
})
