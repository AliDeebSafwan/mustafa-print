import { toWesternDigits, uuidv7, type Locale } from '@mpe/shared'
import { db, type CustomerRow } from '../db'
import { buildPatch } from '../patch'
import { newMutation } from './mutation'

export interface NewCustomerInput {
  fullName: string
  /** Already in E.164 (see normalizePhone). */
  phone: string
  /** The customer agreed, in person, to receive WhatsApp messages about their orders. Without it nothing is ever sent. */
  whatsappOptIn: boolean
  locale?: Locale
}

/**
 * Registers a customer on this device. If a customer with the same phone is already known here, that customer is
 * returned instead of creating a duplicate.
 */
export async function createCustomerLocally(input: NewCustomerInput): Promise<{ customer: CustomerRow; created: boolean }> {
  const existing = await db.customers.filter((c) => c.phone_e164 === input.phone && !c.deleted_at).first()
  if (existing) return { customer: existing, created: false }

  const id = uuidv7()
  const fullName = input.fullName.trim()
  const customer: CustomerRow = {
    id, full_name: fullName, phone_e164: input.phone, whatsapp_opt_in: input.whatsappOptIn, locale: input.locale ?? 'ar', customer_type: 'b2c', _pending: true,
  }
  const mutation = newMutation('customers:insert', id, {
    full_name: fullName, phone_e164: input.phone, locale: input.locale ?? 'ar', preferred_channel: 'whatsapp',
    whatsapp_opt_in: input.whatsappOptIn, ...(input.whatsappOptIn ? { consent_source: 'in_person' as const } : {}),
  })
  await db.transaction('rw', db.customers, db.outbox, async () => {
    await db.customers.add(customer)
    await db.outbox.add(mutation)
  })
  return { customer, created: true }
}

/** Search the customers stored on this device, by name or by (part of) the phone number. Works offline. */
export async function searchCustomers(query: string, limit = 8): Promise<CustomerRow[]> {
  const text = toWesternDigits(query).trim().toLowerCase()
  if (text.length < 2) return []
  const digits = text.replace(/\D/g, '')
  const byPhone = digits.length >= 3
  const matches = await db.customers
    .filter((c) => !c.deleted_at && (c.full_name.toLowerCase().includes(text) || (byPhone && (c.phone_e164 ?? '').replace(/\D/g, '').includes(digits))))
    .limit(limit * 4)
    .toArray()
  return matches.sort((a, b) => a.full_name.localeCompare(b.full_name)).slice(0, limit)
}

/** Fields of a customer a person may correct. Consent flags are here because the shop must be able to withdraw them. */
export const EDITABLE_CUSTOMER_FIELDS = [
  'full_name', 'phone_e164', 'email', 'address_line', 'city', 'notes', 'locale', 'whatsapp_opt_in', 'consent_source',
  'customer_type', 'company_name', 'tax_number', 'credit_limit',
] as const

/**
 * Saves only what changed. Returns false when nothing did, so a person who opens the form and closes it sends nothing.
 * Turning a messaging opt-in ON needs a consent source; the caller supplies it, and the shared schema refuses otherwise.
 */
export async function editCustomer(customer: CustomerRow, next: Record<string, unknown>): Promise<boolean> {
  const patch = buildPatch(customer, next, EDITABLE_CUSTOMER_FIELDS)
  if (!patch) return false
  const mutation = newMutation('customers:update', customer.id, patch as never, customer.row_version ?? null)
  await db.transaction('rw', db.customers, db.outbox, async () => {
    await db.customers.update(customer.id, { ...patch.changes, _pending: true })
    await db.outbox.add(mutation)
  })
  return true
}
