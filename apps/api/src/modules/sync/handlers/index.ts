import type { MutationKind } from '@mpe/shared';
import { insertCustomer, updateCustomer } from './customers';
import { deletePriceOverride, insertPriceOverride, updatePriceOverride } from './company-price-overrides';
import { sendManualMessage } from './notifications';
import { changeOrderStatus } from './order-status';
import { editOrderItems } from './order-items';
import { insertOrder, updateOrder } from './orders';
import { insertInventoryItem, updateInventoryItem } from './inventory';
import { insertProduct, updateProduct } from './products';
import { deleteProductMaterial, insertProductMaterial, updateProductMaterial } from './product-materials';
import { recordStockMovement } from './stock-movements';
import { recordTransaction, settleTransaction } from './transactions';
import type { Handler } from './types';

/** One handler per supported mutation kind. Adding a new offline action = a payload schema in @mpe/shared + an entry here. */
export const HANDLERS: { [K in MutationKind]: Handler<K> } = {
  'customers:insert': insertCustomer,
  'customers:update': updateCustomer,
  'products:insert': insertProduct,
  'products:update': updateProduct,
  'orders:insert': insertOrder,
  'orders:update': updateOrder,
  'orders:edit_items': editOrderItems,
  'order_status_history:status_change': changeOrderStatus,
  'inventory_items:insert': insertInventoryItem,
  'inventory_items:update': updateInventoryItem,
  'product_materials:insert': insertProductMaterial,
  'product_materials:update': updateProductMaterial,
  'product_materials:delete': deleteProductMaterial,
  'stock_movements:stock_movement': recordStockMovement,
  'transactions:insert': recordTransaction,
  'transactions:settle': settleTransaction,
  'notification_logs:manual_send': sendManualMessage,
  'company_price_overrides:insert': insertPriceOverride,
  'company_price_overrides:update': updatePriceOverride,
  'company_price_overrides:delete': deletePriceOverride,
};
