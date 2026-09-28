import Dexie, { type EntityTable } from 'dexie'
import type { Mutation, SyncEntity } from '@mpe/shared'

/** Rows are stored exactly as the server sends them (snake_case), so pulling changes is a plain bulkPut. */
export interface Row {
  id: string
  row_version?: number
  updated_at?: string
  deleted_at?: string | null
  /** true while a local change has not been confirmed by the server yet */
  _pending?: boolean
  /** the server refused this row's creation for good; the value is the reason code */
  _rejected?: string
  [key: string]: unknown
}
export interface CustomerRow extends Row {
  full_name: string
  phone_e164: string | null
  email?: string | null
  whatsapp_opt_in?: boolean
  sms_opt_in?: boolean
  email_opt_in?: boolean
  locale?: string
  notes?: string | null
  customer_type?: 'b2c' | 'b2b'
  company_name?: string | null
  tax_number?: string | null
  credit_limit?: string | null
}
export interface ProductRow extends Row {
  sku: string
  name_ar: string
  name_en: string
  category?: string
  unit: string
  pricing_model?: string
  base_price: string
  min_quantity?: string
  price_rules?: unknown
  is_active?: boolean
  is_public?: boolean
  sort_order?: number
  description_ar?: string | null
  description_en?: string | null
  cover_media_id?: string | null
  service_id?: string | null
}
export interface CompanyPriceOverrideRow extends Row {
  customer_id: string
  product_id: string
  unit_price: string
}
export interface OrderRow extends Row {
  public_code: string
  order_number: string | null
  status: string
  source?: string
  delivery_fee_pending?: boolean
  proof_status?: 'pending' | 'approved' | 'changes_requested' | null
  customer_id: string
  total: string
  currency: string
  placed_at?: string
  subtotal?: string
  discount_total?: string
  delivery_fee?: string
  tax_total?: string
  invoice_number?: string | null
  invoice_issued_at?: string | null
  paid_total?: string
  payment_status?: string
  payment_method?: string
  fulfillment_type?: string
  delivery_address?: string | null
  delivery_city?: string | null
  delivery_notes?: string | null
  customer_notes?: string | null
  internal_notes?: string | null
  due_at?: string | null
}
export interface OrderItemRow extends Row {
  order_id: string; name_snapshot: string; quantity: string; unit_price: string; line_total: string
  sort_order?: number; product_id?: string | null; discount?: string; notes?: string | null
}
export interface TransactionRow extends Row {
  order_id: string
  txn_type: 'payment' | 'refund'
  method: string
  amount: string
  status: string
  currency?: string
  collected_at?: string
  collected_by?: string | null
  settled_at?: string | null
  settled_by?: string | null
  note?: string | null
}
export interface StatusHistoryRow extends Row { order_id: string; from_status: string | null; to_status: string; source?: string; occurred_at: string }
/** The branch's delivery staff, as sent by the server: a name and a phone, nothing more. */
export interface NotificationLogRow extends Row {
  order_id: string | null
  customer_id: string | null
  channel: 'whatsapp' | 'sms' | 'email'
  trigger: 'status_change' | 'manual' | 'invoice' | 'system'
  recipient: string
  subject?: string | null
  body: string
  status: 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped'
  error_message?: string | null
  queued_at: string
  sent_at?: string | null
  created_by?: string | null
}
export interface InventoryRow extends Row {
  sku: string
  name_ar: string
  name_en: string
  category?: string
  unit: string
  quantity_on_hand: string
  reorder_level: string
  reorder_quantity?: string | null
  cost_per_unit?: string | null
  supplier_name?: string | null
  is_active?: boolean
}

export interface OutboxItem {
  id: string                    // mutation id = idempotency key on the server
  entity: SyncEntity
  entityId: string
  op: Mutation['op']
  baseVersion: number | null
  payload: Record<string, unknown>
  clientCreatedAt: string
  attempts: number
  lastError?: string
}
export interface ConflictItem {
  id: string
  mutation: OutboxItem
  result: 'conflict' | 'rejected'
  error?: string
  serverRow?: Record<string, unknown>
  createdAt: string
  resolved: 0 | 1
}
export interface MetaItem { key: string; value: unknown }

export class StaffDB extends Dexie {
  customers!: EntityTable<CustomerRow, 'id'>
  orders!: EntityTable<OrderRow, 'id'>
  order_items!: EntityTable<OrderItemRow, 'id'>
  order_status_history!: EntityTable<StatusHistoryRow, 'id'>
  barcodes!: EntityTable<Row, 'id'>
  stock_movements!: EntityTable<Row, 'id'>
  transactions!: EntityTable<TransactionRow, 'id'>
  notification_logs!: EntityTable<NotificationLogRow, 'id'>
  products!: EntityTable<ProductRow, 'id'>
  inventory_items!: EntityTable<InventoryRow, 'id'>
  notification_templates!: EntityTable<Row, 'id'>
  product_materials!: EntityTable<Row, 'id'>
  company_price_overrides!: EntityTable<CompanyPriceOverrideRow, 'id'>
  outbox!: EntityTable<OutboxItem, 'id'>
  conflicts!: EntityTable<ConflictItem, 'id'>
  meta!: EntityTable<MetaItem, 'key'>

  constructor(name = 'mpe-staff') {
    super(name)
    this.version(1).stores({
      customers: 'id, phone_e164',
      orders: 'id, &public_code, status, order_number',
      order_items: 'id, order_id',
      order_status_history: 'id, order_id',
      barcodes: 'id, code, order_id',
      stock_movements: 'id, item_id',
      transactions: 'id, order_id',
      notification_logs: 'id, order_id',
      products: 'id, sku',
      inventory_items: 'id, sku',
      notification_templates: 'id',
      outbox: 'id, clientCreatedAt',
      conflicts: 'id, resolved, createdAt',
      meta: 'key',
    })
    // v2: the branch's couriers, so a device can assign a delivery while offline.
    this.version(2).stores({ couriers: 'id' })
    // v3: product recipes, so a device can show what a job will consume while offline.
    this.version(3).stores({ product_materials: 'id, product_id' })
    // v4: a company's own agreed prices, so a device can suggest one while offline.
    this.version(4).stores({ company_price_overrides: 'id, customer_id, product_id' })
    // v5: courier accounts never shipped (the team screen only ever offered admin/staff) — the store some devices
    // created in v2 is dropped. `null` removes an object store; it is Dexie's documented way to do this, not a hack.
    this.version(5).stores({ couriers: null })
  }
}

export const db = new StaffDB()

/** Tables that mirror server rows (everything except the local bookkeeping tables). */
export const DATA_TABLES = [
  'customers', 'orders', 'order_items', 'order_status_history', 'barcodes', 'stock_movements', 'transactions',
  'notification_logs', 'products', 'inventory_items', 'notification_templates', 'product_materials', 'company_price_overrides',
] as const
export type DataTable = (typeof DATA_TABLES)[number]
export const isDataTable = (name: string): name is DataTable => (DATA_TABLES as readonly string[]).includes(name)

export const getMeta = async <T>(key: string): Promise<T | undefined> => (await db.meta.get(key))?.value as T | undefined
export const setMeta = (key: string, value: unknown) => db.meta.put({ key, value })

/** Removes everything stored for the previous user (data, unsent work, cursor). Used on sign-out and when another user signs in. */
export const wipeLocalData = () => db.transaction('rw', db.tables, () => Promise.all(db.tables.map((table) => table.clear())))
