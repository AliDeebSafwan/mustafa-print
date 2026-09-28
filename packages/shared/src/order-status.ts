export const ORDER_STATUSES = [
  'pending',            // web order waiting for staff confirmation
  'received',
  'in_design',
  'awaiting_approval',  // proof sent to the customer
  'printing',
  'finishing',
  'ready',
  'out_for_delivery',
  'delivered',          // handed to the customer (pickup or delivery)
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TERMINAL_STATUSES: readonly OrderStatus[] = ['delivered', 'cancelled'];

/** Allowed status moves. The API enforces this for online AND offline (replayed) changes. */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['received', 'cancelled'],
  received: ['in_design', 'printing', 'cancelled'],
  in_design: ['awaiting_approval', 'printing', 'cancelled'],
  awaiting_approval: ['in_design', 'printing', 'cancelled'],
  printing: ['finishing', 'ready', 'cancelled'],
  finishing: ['ready', 'printing', 'cancelled'],
  ready: ['out_for_delivery', 'delivered'],
  out_for_delivery: ['delivered', 'ready'],   // back to "ready" when a delivery attempt fails
  delivered: [],
  cancelled: [],
};

export const isOrderStatus = (v: unknown): v is OrderStatus =>
  typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v);

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  ORDER_STATUS_TRANSITIONS[from].includes(to);

export const ORDER_STATUS_LABELS: Record<OrderStatus, { ar: string; en: string }> = {
  pending: { ar: 'بانتظار التأكيد', en: 'Pending confirmation' },
  received: { ar: 'تم الاستلام', en: 'Received' },
  in_design: { ar: 'قيد التصميم', en: 'In design' },
  awaiting_approval: { ar: 'بانتظار موافقتك', en: 'Awaiting approval' },
  printing: { ar: 'قيد الطباعة', en: 'Printing' },
  finishing: { ar: 'قيد التشطيب', en: 'Finishing' },
  ready: { ar: 'جاهز للاستلام', en: 'Ready' },
  out_for_delivery: { ar: 'خرج للتوصيل', en: 'Out for delivery' },
  delivered: { ar: 'تم التسليم', en: 'Delivered' },
  cancelled: { ar: 'ملغى', en: 'Cancelled' },
};
