import { pgTable, text, timestamp, index, uniqueIndex, foreignKey, check, uuid, boolean, integer, unique, char, numeric, jsonb, bigint, smallint, date, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const schemaMigrations = pgTable("schema_migrations", {
	filename: text().primaryKey().notNull(),
	checksum: text().notNull(),
	appliedAt: timestamp("applied_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	roleId: uuid("role_id").notNull(),
	fullName: text("full_name").notNull(),
	email: text(),
	phoneE164: text("phone_e164"),
	passwordHash: text("password_hash"),
	locale: text().default('ar').notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	tokenVersion: integer("token_version").default(0).notNull(),
	lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
	grantedPermissions: text("granted_permissions").array().default([""]).notNull(),
}, (table) => [
	index("users_branch_role_idx").using("btree", table.branchId.asc().nullsLast().op("uuid_ops"), table.roleId.asc().nullsLast().op("uuid_ops")).where(sql`(deleted_at IS NULL)`),
	uniqueIndex("users_email_uq").using("btree", sql`lower(email)`).where(sql`((email IS NOT NULL) AND (deleted_at IS NULL))`),
	uniqueIndex("users_phone_uq").using("btree", table.phoneE164.asc().nullsLast().op("text_ops")).where(sql`((phone_e164 IS NOT NULL) AND (deleted_at IS NULL))`),
	index("users_sync_idx").using("btree", table.branchId.asc().nullsLast().op("timestamptz_ops"), table.updatedAt.asc().nullsLast().op("uuid_ops"), table.id.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "users_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [roles.id],
			name: "users_role_id_fkey"
		}),
	check("users_phone_e164_check", sql`phone_e164 ~ '^\+[1-9][0-9]{6,14}$'::text`),
	check("users_locale_check", sql`locale = ANY (ARRAY['ar'::text, 'en'::text])`),
	check("users_has_login_identifier", sql`(email IS NOT NULL) OR (phone_e164 IS NOT NULL)`),
	check("users_granted_permissions_allowlist", sql`granted_permissions <@ ARRAY['orders:cancel'::text, 'orders:discount:override'::text, 'transactions:refund'::text, 'products:write'::text, 'reports:read'::text, 'inventory:manage'::text, 'notifications:templates:write'::text, 'orders:items:override'::text, 'orders:credit:override'::text]`),
]);

export const customers = pgTable("customers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	customerType: text("customer_type").default('b2c').notNull(),
	fullName: text("full_name").notNull(),
	companyName: text("company_name"),
	phoneE164: text("phone_e164"),
	email: text(),
	addressLine: text("address_line"),
	city: text(),
	countryCode: char("country_code", { length: 2 }),
	locale: text().default('ar').notNull(),
	whatsappOptIn: boolean("whatsapp_opt_in").default(false).notNull(),
	smsOptIn: boolean("sms_opt_in").default(false).notNull(),
	emailOptIn: boolean("email_opt_in").default(false).notNull(),
	preferredChannel: text("preferred_channel").default('whatsapp').notNull(),
	consentRecordedAt: timestamp("consent_recorded_at", { withTimezone: true, mode: 'string' }),
	consentSource: text("consent_source"),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
	taxNumber: text("tax_number"),
	creditLimit: numeric("credit_limit", { precision: 14, scale:  2 }),
}, (table) => [
	index("customers_email_idx").using("btree", sql`branch_id`, sql`lower(email)`).where(sql`(email IS NOT NULL)`),
	index("customers_name_trgm").using("gin", table.fullName.asc().nullsLast().op("gin_trgm_ops")),
	uniqueIndex("customers_phone_uq").using("btree", table.branchId.asc().nullsLast().op("uuid_ops"), table.phoneE164.asc().nullsLast().op("uuid_ops")).where(sql`((phone_e164 IS NOT NULL) AND (deleted_at IS NULL))`),
	index("customers_sync_idx").using("btree", table.branchId.asc().nullsLast().op("timestamptz_ops"), table.updatedAt.asc().nullsLast().op("timestamptz_ops"), table.id.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "customers_branch_id_fkey"
		}),
	unique("customers_id_branch_uq").on(table.id, table.branchId),
	check("customers_customer_type_check", sql`customer_type = ANY (ARRAY['b2c'::text, 'b2b'::text])`),
	check("customers_phone_e164_check", sql`phone_e164 ~ '^\+[1-9][0-9]{6,14}$'::text`),
	check("customers_locale_check", sql`locale = ANY (ARRAY['ar'::text, 'en'::text])`),
	check("customers_preferred_channel_check", sql`preferred_channel = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'email'::text])`),
	check("customers_consent_source_check", sql`consent_source = ANY (ARRAY['checkout'::text, 'in_person'::text, 'phone'::text, 'migration'::text])`),
	check("customers_contact_present", sql`(phone_e164 IS NOT NULL) OR (email IS NOT NULL)`),
	check("customers_credit_limit_check", sql`credit_limit >= (0)::numeric`),
]);

export const roles = pgTable("roles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	key: text().notNull(),
	nameAr: text("name_ar").notNull(),
	nameEn: text("name_en").notNull(),
	permissions: text().array().default([""]).notNull(),
	isSystem: boolean("is_system").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	unique("roles_key_key").on(table.key),
]);

export const products = pgTable("products", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	sku: text().notNull(),
	slug: text(),
	nameAr: text("name_ar").notNull(),
	nameEn: text("name_en").notNull(),
	descriptionAr: text("description_ar"),
	descriptionEn: text("description_en"),
	category: text().default('general').notNull(),
	unit: text().default('piece').notNull(),
	pricingModel: text("pricing_model").default('per_unit').notNull(),
	basePrice: numeric("base_price", { precision: 14, scale:  4 }).default('0').notNull(),
	minQuantity: numeric("min_quantity", { precision: 14, scale:  3 }).default('1').notNull(),
	optionsSchema: jsonb("options_schema").default({}).notNull(),
	priceRules: jsonb("price_rules").default([]).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	isPublic: boolean("is_public").default(false).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
	coverMediaId: uuid("cover_media_id"),
	serviceId: uuid("service_id"),
}, (table) => [
	index("products_public_idx").using("btree", table.branchId.asc().nullsLast().op("uuid_ops"), table.sortOrder.asc().nullsLast().op("int4_ops")).where(sql`(is_public AND is_active AND (deleted_at IS NULL))`),
	uniqueIndex("products_sku_uq").using("btree", sql`branch_id`, sql`lower(sku)`).where(sql`(deleted_at IS NULL)`),
	uniqueIndex("products_slug_uq").using("btree", table.branchId.asc().nullsLast().op("text_ops"), table.slug.asc().nullsLast().op("uuid_ops")).where(sql`((slug IS NOT NULL) AND (deleted_at IS NULL))`),
	index("products_sync_idx").using("btree", table.branchId.asc().nullsLast().op("timestamptz_ops"), table.updatedAt.asc().nullsLast().op("timestamptz_ops"), table.id.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "products_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.coverMediaId],
			foreignColumns: [media.id, media.branchId],
			name: "products_cover_fk"
		}),
	foreignKey({
			columns: [table.branchId, table.serviceId],
			foreignColumns: [services.id, services.branchId],
			name: "products_service_fk"
		}),
	unique("products_id_branch_uq").on(table.id, table.branchId),
	check("products_unit_check", sql`unit = ANY (ARRAY['piece'::text, 'sheet'::text, 'sqm'::text, 'meter'::text, 'set'::text, 'hour'::text])`),
	check("products_pricing_model_check", sql`pricing_model = ANY (ARRAY['fixed'::text, 'per_unit'::text, 'per_area'::text, 'tiered'::text, 'quote'::text])`),
	check("products_base_price_check", sql`base_price >= (0)::numeric`),
	check("products_min_quantity_check", sql`min_quantity > (0)::numeric`),
]);

export const inventoryItems = pgTable("inventory_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	sku: text().notNull(),
	nameAr: text("name_ar").notNull(),
	nameEn: text("name_en").notNull(),
	category: text().notNull(),
	unit: text().notNull(),
	quantityOnHand: numeric("quantity_on_hand", { precision: 14, scale:  3 }).default('0').notNull(),
	reorderLevel: numeric("reorder_level", { precision: 14, scale:  3 }).default('0').notNull(),
	reorderQuantity: numeric("reorder_quantity", { precision: 14, scale:  3 }),
	costPerUnit: numeric("cost_per_unit", { precision: 14, scale:  4 }),
	supplierName: text("supplier_name"),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	index("inventory_items_low_stock_idx").using("btree", table.branchId.asc().nullsLast().op("uuid_ops")).where(sql`(is_active AND (deleted_at IS NULL) AND (quantity_on_hand <= reorder_level))`),
	uniqueIndex("inventory_items_sku_uq").using("btree", sql`branch_id`, sql`lower(sku)`).where(sql`(deleted_at IS NULL)`),
	index("inventory_items_sync_idx").using("btree", table.branchId.asc().nullsLast().op("uuid_ops"), table.updatedAt.asc().nullsLast().op("timestamptz_ops"), table.id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "inventory_items_branch_id_fkey"
		}),
	unique("inventory_items_id_branch_uq").on(table.id, table.branchId),
	check("inventory_items_category_check", sql`category = ANY (ARRAY['paper'::text, 'ink'::text, 'plate'::text, 'film'::text, 'packaging'::text, 'chemical'::text, 'spare_part'::text, 'other'::text])`),
	check("inventory_items_unit_check", sql`unit = ANY (ARRAY['sheet'::text, 'ream'::text, 'ml'::text, 'liter'::text, 'g'::text, 'kg'::text, 'piece'::text, 'meter'::text, 'roll'::text, 'box'::text])`),
	check("inventory_items_reorder_level_check", sql`reorder_level >= (0)::numeric`),
	check("inventory_items_reorder_quantity_check", sql`reorder_quantity > (0)::numeric`),
	check("inventory_items_cost_per_unit_check", sql`cost_per_unit >= (0)::numeric`),
]);

export const orders = pgTable("orders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	orderNumber: bigint("order_number", { mode: "number" }),
	publicCode: text("public_code").notNull(),
	customerId: uuid("customer_id").notNull(),
	source: text().default('staff').notNull(),
	status: text().default('received').notNull(),
	statusChangedAt: timestamp("status_changed_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	fulfillmentType: text("fulfillment_type").default('pickup').notNull(),
	deliveryAddress: text("delivery_address"),
	deliveryCity: text("delivery_city"),
	deliveryNotes: text("delivery_notes"),
	paymentStatus: text("payment_status").default('unpaid').notNull(),
	paymentMethod: text("payment_method").default('cod').notNull(),
	currency: char({ length: 3 }).default('USD').notNull(),
	subtotal: numeric({ precision: 14, scale:  2 }).default('0').notNull(),
	discountTotal: numeric("discount_total", { precision: 14, scale:  2 }).default('0').notNull(),
	deliveryFee: numeric("delivery_fee", { precision: 14, scale:  2 }).default('0').notNull(),
	taxTotal: numeric("tax_total", { precision: 14, scale:  2 }).default('0').notNull(),
	total: numeric({ precision: 14, scale:  2 }).default('0').notNull(),
	paidTotal: numeric("paid_total", { precision: 14, scale:  2 }).default('0').notNull(),
	customerNotes: text("customer_notes"),
	internalNotes: text("internal_notes"),
	dueAt: timestamp("due_at", { withTimezone: true, mode: 'string' }),
	placedAt: timestamp("placed_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
	cancelReason: text("cancel_reason"),
	createdBy: uuid("created_by"),
	originDeviceId: text("origin_device_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
	deliveryFeePending: boolean("delivery_fee_pending").default(false).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	invoiceNumber: bigint("invoice_number", { mode: "number" }),
	invoiceIssuedAt: timestamp("invoice_issued_at", { withTimezone: true, mode: 'string' }),
	proofStatus: text("proof_status"),
	companyInvoiceId: uuid("company_invoice_id"),
}, (table) => [
	index("orders_board_idx").using("btree", table.branchId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("text_ops"), table.placedAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`(deleted_at IS NULL)`),
	index("orders_company_invoice_idx").using("btree", table.companyInvoiceId.asc().nullsLast().op("uuid_ops")).where(sql`(company_invoice_id IS NOT NULL)`),
	index("orders_customer_idx").using("btree", table.customerId.asc().nullsLast().op("uuid_ops"), table.placedAt.desc().nullsFirst().op("uuid_ops")),
	uniqueIndex("orders_invoice_number_uq").using("btree", table.branchId.asc().nullsLast().op("int8_ops"), table.invoiceNumber.asc().nullsLast().op("uuid_ops")).where(sql`(invoice_number IS NOT NULL)`),
	uniqueIndex("orders_number_uq").using("btree", table.branchId.asc().nullsLast().op("int8_ops"), table.orderNumber.asc().nullsLast().op("int8_ops")).where(sql`(order_number IS NOT NULL)`),
	uniqueIndex("orders_public_code_uq").using("btree", table.publicCode.asc().nullsLast().op("text_ops")),
	index("orders_sync_idx").using("btree", table.branchId.asc().nullsLast().op("timestamptz_ops"), table.updatedAt.asc().nullsLast().op("uuid_ops"), table.id.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "orders_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "orders_created_by_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.customerId],
			foreignColumns: [customers.id, customers.branchId],
			name: "orders_customer_fk"
		}),
	foreignKey({
			columns: [table.companyInvoiceId],
			foreignColumns: [companyInvoices.id],
			name: "orders_company_invoice_id_fkey"
		}),
	unique("orders_id_branch_uq").on(table.id, table.branchId),
	check("orders_public_code_check", sql`public_code ~ '^[0-9A-HJKMNP-TV-Z]{10,16}$'::text`),
	check("orders_status_check", sql`status = ANY (ARRAY['pending'::text, 'received'::text, 'in_design'::text, 'awaiting_approval'::text, 'printing'::text, 'finishing'::text, 'ready'::text, 'out_for_delivery'::text, 'delivered'::text, 'cancelled'::text])`),
	check("orders_fulfillment_type_check", sql`fulfillment_type = ANY (ARRAY['pickup'::text, 'delivery'::text])`),
	check("orders_payment_status_check", sql`payment_status = ANY (ARRAY['unpaid'::text, 'partial'::text, 'paid'::text, 'refunded'::text])`),
	check("orders_payment_method_check", sql`payment_method = ANY (ARRAY['cash'::text, 'cod'::text, 'whish_money'::text])`),
	check("orders_currency_check", sql`currency ~ '^[A-Z]{3}$'::text`),
	check("orders_subtotal_check", sql`subtotal >= (0)::numeric`),
	check("orders_discount_total_check", sql`discount_total >= (0)::numeric`),
	check("orders_delivery_fee_check", sql`delivery_fee >= (0)::numeric`),
	check("orders_tax_total_check", sql`tax_total >= (0)::numeric`),
	check("orders_total_check", sql`total >= (0)::numeric`),
	check("orders_total_consistent", sql`total = (((subtotal - discount_total) + delivery_fee) + tax_total)`),
	check("orders_delivery_address", sql`(fulfillment_type = 'pickup'::text) OR (delivery_address IS NOT NULL)`),
	check("orders_fee_pending_needs_delivery", sql`(NOT delivery_fee_pending) OR (fulfillment_type = 'delivery'::text)`),
	check("orders_source_check", sql`source = ANY (ARRAY['staff'::text, 'web'::text, 'import'::text, 'quote'::text])`),
	check("orders_proof_status_check", sql`proof_status = ANY (ARRAY['pending'::text, 'approved'::text, 'changes_requested'::text])`),
	check("orders_invoiced_once", sql`(invoice_number IS NULL) OR (company_invoice_id IS NULL)`),
]);

export const orderItems = pgTable("order_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	orderId: uuid("order_id").notNull(),
	productId: uuid("product_id"),
	sortOrder: integer("sort_order").default(0).notNull(),
	nameSnapshot: text("name_snapshot").notNull(),
	unit: text().default('piece').notNull(),
	quantity: numeric({ precision: 14, scale:  3 }).notNull(),
	unitPrice: numeric("unit_price", { precision: 14, scale:  4 }).notNull(),
	discount: numeric({ precision: 14, scale:  2 }).default('0').notNull(),
	lineTotal: numeric("line_total", { precision: 14, scale:  2 }).notNull(),
	options: jsonb().default({}).notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	index("order_items_order_idx").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")).where(sql`(deleted_at IS NULL)`),
	index("order_items_sync_idx").using("btree", table.branchId.asc().nullsLast().op("uuid_ops"), table.updatedAt.asc().nullsLast().op("timestamptz_ops"), table.id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "order_items_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.orderId],
			foreignColumns: [orders.id, orders.branchId],
			name: "order_items_order_fk"
		}),
	foreignKey({
			columns: [table.branchId, table.productId],
			foreignColumns: [products.id, products.branchId],
			name: "order_items_product_fk"
		}),
	unique("order_items_id_branch_uq").on(table.id, table.branchId),
	check("order_items_quantity_check", sql`quantity > (0)::numeric`),
	check("order_items_unit_price_check", sql`unit_price >= (0)::numeric`),
	check("order_items_discount_check", sql`discount >= (0)::numeric`),
	check("order_items_line_total_check", sql`line_total >= (0)::numeric`),
]);

export const barcodes = pgTable("barcodes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	orderId: uuid("order_id").notNull(),
	orderItemId: uuid("order_item_id"),
	labelType: text("label_type").default('order').notNull(),
	code: text().notNull(),
	symbology: text().default('qr').notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	printCount: integer("print_count").default(0).notNull(),
	lastPrintedAt: timestamp("last_printed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	uniqueIndex("barcodes_code_uq").using("btree", table.branchId.asc().nullsLast().op("text_ops"), table.code.asc().nullsLast().op("text_ops")).where(sql`(deleted_at IS NULL)`),
	index("barcodes_order_idx").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	index("barcodes_sync_idx").using("btree", table.branchId.asc().nullsLast().op("timestamptz_ops"), table.updatedAt.asc().nullsLast().op("timestamptz_ops"), table.id.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "barcodes_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.orderId],
			foreignColumns: [orders.id, orders.branchId],
			name: "barcodes_order_fk"
		}),
	foreignKey({
			columns: [table.branchId, table.orderItemId],
			foreignColumns: [orderItems.id, orderItems.branchId],
			name: "barcodes_item_fk"
		}),
	unique("barcodes_id_branch_uq").on(table.id, table.branchId),
	check("barcodes_label_type_check", sql`label_type = ANY (ARRAY['order'::text, 'item'::text, 'package'::text])`),
	check("barcodes_symbology_check", sql`symbology = ANY (ARRAY['qr'::text, 'code128'::text])`),
	check("barcodes_print_count_check", sql`print_count >= 0`),
]);

export const productMaterials = pgTable("product_materials", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	productId: uuid("product_id").notNull(),
	itemId: uuid("item_id").notNull(),
	quantityPerUnit: numeric("quantity_per_unit", { precision: 14, scale:  6 }).notNull(),
	wastePct: numeric("waste_pct", { precision: 5, scale:  2 }).default('0').notNull(),
	optionMatch: jsonb("option_match"),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	index("product_materials_product_idx").using("btree", table.productId.asc().nullsLast().op("uuid_ops")).where(sql`(deleted_at IS NULL)`),
	index("product_materials_sync_idx").using("btree", table.branchId.asc().nullsLast().op("timestamptz_ops"), table.updatedAt.asc().nullsLast().op("uuid_ops"), table.id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "product_materials_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.productId],
			foreignColumns: [products.id, products.branchId],
			name: "product_materials_product_fk"
		}),
	foreignKey({
			columns: [table.branchId, table.itemId],
			foreignColumns: [inventoryItems.id, inventoryItems.branchId],
			name: "product_materials_item_fk"
		}),
	check("product_materials_quantity_per_unit_check", sql`quantity_per_unit > (0)::numeric`),
	check("product_materials_waste_pct_check", sql`(waste_pct >= (0)::numeric) AND (waste_pct <= (100)::numeric)`),
]);

export const orderStatusHistory = pgTable("order_status_history", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	orderId: uuid("order_id").notNull(),
	fromStatus: text("from_status"),
	toStatus: text("to_status").notNull(),
	source: text().default('manual').notNull(),
	barcodeId: uuid("barcode_id"),
	changedBy: uuid("changed_by"),
	note: text(),
	deviceId: text("device_id"),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	index("osh_order_idx").using("btree", table.orderId.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
	index("osh_sync_idx").using("btree", table.branchId.asc().nullsLast().op("timestamptz_ops"), table.updatedAt.asc().nullsLast().op("uuid_ops"), table.id.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "order_status_history_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.changedBy],
			foreignColumns: [users.id],
			name: "order_status_history_changed_by_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.orderId],
			foreignColumns: [orders.id, orders.branchId],
			name: "osh_order_fk"
		}),
	foreignKey({
			columns: [table.branchId, table.barcodeId],
			foreignColumns: [barcodes.id, barcodes.branchId],
			name: "osh_barcode_fk"
		}),
	check("order_status_history_to_status_check", sql`to_status = ANY (ARRAY['pending'::text, 'received'::text, 'in_design'::text, 'awaiting_approval'::text, 'printing'::text, 'finishing'::text, 'ready'::text, 'out_for_delivery'::text, 'delivered'::text, 'cancelled'::text])`),
	check("order_status_history_source_check", sql`source = ANY (ARRAY['manual'::text, 'scanner'::text, 'system'::text, 'web'::text, 'sync_resolution'::text])`),
]);

export const stockMovements = pgTable("stock_movements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	itemId: uuid("item_id").notNull(),
	movementType: text("movement_type").notNull(),
	quantityDelta: numeric("quantity_delta", { precision: 14, scale:  3 }).notNull(),
	unitCost: numeric("unit_cost", { precision: 14, scale:  4 }),
	orderId: uuid("order_id"),
	orderItemId: uuid("order_item_id"),
	reason: text(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	createdBy: uuid("created_by"),
	deviceId: text("device_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	rowVersion: integer("row_version").default(1).notNull(),
	sourceEventId: uuid("source_event_id"),
}, (table) => [
	uniqueIndex("stock_movements_auto_bom_uq").using("btree", table.orderItemId.asc().nullsLast().op("uuid_ops"), table.itemId.asc().nullsLast().op("uuid_ops"), table.sourceEventId.asc().nullsLast().op("uuid_ops")).where(sql`(reason = 'auto:bom'::text)`),
	index("stock_movements_item_idx").using("btree", table.itemId.asc().nullsLast().op("uuid_ops"), table.occurredAt.desc().nullsFirst().op("timestamptz_ops")),
	index("stock_movements_order_idx").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")).where(sql`(order_id IS NOT NULL)`),
	index("stock_movements_sync_idx").using("btree", table.branchId.asc().nullsLast().op("uuid_ops"), table.updatedAt.asc().nullsLast().op("uuid_ops"), table.id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.branchId, table.orderId],
			foreignColumns: [orders.id, orders.branchId],
			name: "stock_movements_order_fk"
		}),
	foreignKey({
			columns: [table.branchId, table.orderItemId],
			foreignColumns: [orderItems.id, orderItems.branchId],
			name: "stock_movements_order_item_fk"
		}),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "stock_movements_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "stock_movements_created_by_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.itemId],
			foreignColumns: [inventoryItems.id, inventoryItems.branchId],
			name: "stock_movements_item_fk"
		}),
	foreignKey({
			columns: [table.sourceEventId],
			foreignColumns: [orderStatusHistory.id],
			name: "stock_movements_source_event_id_fkey"
		}),
	check("stock_movements_movement_type_check", sql`movement_type = ANY (ARRAY['opening_balance'::text, 'receipt'::text, 'consumption'::text, 'waste'::text, 'adjustment'::text, 'transfer_in'::text, 'transfer_out'::text, 'return'::text])`),
	check("stock_movements_quantity_delta_check", sql`quantity_delta <> (0)::numeric`),
	check("stock_movements_unit_cost_check", sql`unit_cost >= (0)::numeric`),
	check("stock_movements_sign", sql`((movement_type = ANY (ARRAY['opening_balance'::text, 'receipt'::text, 'transfer_in'::text, 'return'::text])) AND (quantity_delta > (0)::numeric)) OR ((movement_type = ANY (ARRAY['consumption'::text, 'waste'::text, 'transfer_out'::text])) AND (quantity_delta < (0)::numeric)) OR (movement_type = 'adjustment'::text)`),
]);

export const transactions = pgTable("transactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	orderId: uuid("order_id"),
	customerId: uuid("customer_id"),
	txnType: text("txn_type").notNull(),
	method: text().notNull(),
	status: text().default('pending').notNull(),
	amount: numeric({ precision: 14, scale:  2 }).notNull(),
	currency: char({ length: 3 }).default('USD').notNull(),
	provider: text(),
	providerTxnId: text("provider_txn_id"),
	providerPayload: jsonb("provider_payload"),
	collectedBy: uuid("collected_by"),
	collectedAt: timestamp("collected_at", { withTimezone: true, mode: 'string' }),
	settledAt: timestamp("settled_at", { withTimezone: true, mode: 'string' }),
	settledBy: uuid("settled_by"),
	note: text(),
	createdBy: uuid("created_by"),
	deviceId: text("device_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	index("transactions_cod_open_idx").using("btree", table.branchId.asc().nullsLast().op("uuid_ops"), table.collectedBy.asc().nullsLast().op("uuid_ops")).where(sql`((method = 'cod'::text) AND (status = 'completed'::text) AND (settled_at IS NULL))`),
	index("transactions_order_idx").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("transactions_provider_uq").using("btree", table.provider.asc().nullsLast().op("text_ops"), table.providerTxnId.asc().nullsLast().op("text_ops")).where(sql`(provider_txn_id IS NOT NULL)`),
	index("transactions_sync_idx").using("btree", table.branchId.asc().nullsLast().op("timestamptz_ops"), table.updatedAt.asc().nullsLast().op("uuid_ops"), table.id.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "transactions_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.collectedBy],
			foreignColumns: [users.id],
			name: "transactions_collected_by_fkey"
		}),
	foreignKey({
			columns: [table.settledBy],
			foreignColumns: [users.id],
			name: "transactions_settled_by_fkey"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "transactions_created_by_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.orderId],
			foreignColumns: [orders.id, orders.branchId],
			name: "transactions_order_fk"
		}),
	foreignKey({
			columns: [table.branchId, table.customerId],
			foreignColumns: [customers.id, customers.branchId],
			name: "transactions_customer_fk"
		}),
	check("transactions_txn_type_check", sql`txn_type = ANY (ARRAY['payment'::text, 'refund'::text, 'adjustment'::text])`),
	check("transactions_method_check", sql`method = ANY (ARRAY['cash'::text, 'cod'::text, 'whish_money'::text])`),
	check("transactions_status_check", sql`status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])`),
	check("transactions_amount_check", sql`amount > (0)::numeric`),
	check("transactions_currency_check", sql`currency ~ '^[A-Z]{3}$'::text`),
]);

export const notificationTemplates = pgTable("notification_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	templateKey: text("template_key").notNull(),
	channel: text().notNull(),
	locale: text().notNull(),
	subject: text(),
	body: text().notNull(),
	variables: text().array().default([""]).notNull(),
	providerTemplateName: text("provider_template_name"),
	providerTemplateLanguage: text("provider_template_language"),
	isActive: boolean("is_active").default(true).notNull(),
	isSystem: boolean("is_system").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	index("notification_templates_sync_idx").using("btree", table.branchId.asc().nullsLast().op("timestamptz_ops"), table.updatedAt.asc().nullsLast().op("uuid_ops"), table.id.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("notification_templates_uq").using("btree", table.branchId.asc().nullsLast().op("uuid_ops"), table.templateKey.asc().nullsLast().op("uuid_ops"), table.channel.asc().nullsLast().op("text_ops"), table.locale.asc().nullsLast().op("uuid_ops")).where(sql`(deleted_at IS NULL)`),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "notification_templates_branch_id_fkey"
		}),
	unique("notification_templates_id_branch_uq").on(table.id, table.branchId),
	check("notification_templates_channel_check", sql`channel = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'email'::text])`),
	check("notification_templates_locale_check", sql`locale = ANY (ARRAY['ar'::text, 'en'::text])`),
	check("notification_templates_email_subject", sql`(channel <> 'email'::text) OR (subject IS NOT NULL)`),
]);

export const notificationLogs = pgTable("notification_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	orderId: uuid("order_id"),
	customerId: uuid("customer_id"),
	templateId: uuid("template_id"),
	templateKey: text("template_key"),
	channel: text().notNull(),
	locale: text().notNull(),
	trigger: text().default('status_change').notNull(),
	recipient: text().notNull(),
	subject: text(),
	body: text().notNull(),
	variables: jsonb().default({}).notNull(),
	status: text().default('queued').notNull(),
	provider: text(),
	providerMessageId: text("provider_message_id"),
	errorCode: text("error_code"),
	errorMessage: text("error_message"),
	attempts: integer().default(0).notNull(),
	maxAttempts: integer("max_attempts").default(5).notNull(),
	nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	lockedAt: timestamp("locked_at", { withTimezone: true, mode: 'string' }),
	queuedAt: timestamp("queued_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: 'string' }),
	readAt: timestamp("read_at", { withTimezone: true, mode: 'string' }),
	failedAt: timestamp("failed_at", { withTimezone: true, mode: 'string' }),
	dedupeKey: text("dedupe_key"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	uniqueIndex("notification_logs_dedupe_uq").using("btree", table.branchId.asc().nullsLast().op("text_ops"), table.dedupeKey.asc().nullsLast().op("text_ops")).where(sql`(dedupe_key IS NOT NULL)`),
	index("notification_logs_order_idx").using("btree", table.orderId.asc().nullsLast().op("timestamptz_ops"), table.queuedAt.desc().nullsFirst().op("timestamptz_ops")),
	uniqueIndex("notification_logs_provider_uq").using("btree", table.provider.asc().nullsLast().op("text_ops"), table.providerMessageId.asc().nullsLast().op("text_ops")).where(sql`(provider_message_id IS NOT NULL)`),
	index("notification_logs_queue_idx").using("btree", table.status.asc().nullsLast().op("text_ops"), table.nextAttemptAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = ANY (ARRAY['queued'::text, 'sending'::text]))`),
	index("notification_logs_sync_idx").using("btree", table.branchId.asc().nullsLast().op("timestamptz_ops"), table.updatedAt.asc().nullsLast().op("timestamptz_ops"), table.id.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "notification_logs_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "notification_logs_created_by_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.orderId],
			foreignColumns: [orders.id, orders.branchId],
			name: "notification_logs_order_fk"
		}),
	foreignKey({
			columns: [table.branchId, table.customerId],
			foreignColumns: [customers.id, customers.branchId],
			name: "notification_logs_customer_fk"
		}),
	foreignKey({
			columns: [table.branchId, table.templateId],
			foreignColumns: [notificationTemplates.id, notificationTemplates.branchId],
			name: "notification_logs_template_fk"
		}),
	check("notification_logs_channel_check", sql`channel = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'email'::text])`),
	check("notification_logs_locale_check", sql`locale = ANY (ARRAY['ar'::text, 'en'::text])`),
	check("notification_logs_trigger_check", sql`trigger = ANY (ARRAY['status_change'::text, 'manual'::text, 'invoice'::text, 'system'::text])`),
	check("notification_logs_status_check", sql`status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'failed'::text, 'skipped'::text])`),
]);

export const services = pgTable("services", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	slug: text().notNull(),
	titleAr: text("title_ar").notNull(),
	titleEn: text("title_en"),
	summaryAr: text("summary_ar"),
	summaryEn: text("summary_en"),
	bodyAr: text("body_ar"),
	bodyEn: text("body_en"),
	coverMediaId: uuid("cover_media_id"),
	status: text().default('draft').notNull(),
	isFeatured: boolean("is_featured").default(false).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	index("services_public_idx").using("btree", table.branchId.asc().nullsLast().op("int4_ops"), table.sortOrder.asc().nullsLast().op("uuid_ops")).where(sql`((status = 'published'::text) AND (deleted_at IS NULL))`),
	uniqueIndex("services_slug_uq").using("btree", table.branchId.asc().nullsLast().op("uuid_ops"), table.slug.asc().nullsLast().op("text_ops")).where(sql`(deleted_at IS NULL)`),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "services_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "services_updated_by_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.coverMediaId],
			foreignColumns: [media.id, media.branchId],
			name: "services_cover_fk"
		}),
	unique("services_id_branch_uq").on(table.id, table.branchId),
	check("services_slug_check", sql`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text`),
	check("services_title_ar_check", sql`length(TRIM(BOTH FROM title_ar)) > 0`),
	check("services_status_check", sql`status = ANY (ARRAY['draft'::text, 'published'::text])`),
]);

export const refreshTokens = pgTable("refresh_tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	familyId: uuid("family_id").notNull(),
	userId: uuid("user_id").notNull(),
	tokenHash: text("token_hash").notNull(),
	tokenVersion: integer("token_version").notNull(),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	replacedBy: uuid("replaced_by"),
}, (table) => [
	index("refresh_tokens_expiry_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	index("refresh_tokens_family_idx").using("btree", table.familyId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("refresh_tokens_hash_uq").using("btree", table.tokenHash.asc().nullsLast().op("text_ops")),
	index("refresh_tokens_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(revoked_at IS NULL)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "refresh_tokens_user_id_fkey"
		}),
	foreignKey({
			columns: [table.replacedBy],
			foreignColumns: [table.id],
			name: "refresh_tokens_replaced_by_fkey"
		}),
]);

export const loginFailures = pgTable("login_failures", {
	identifier: text().primaryKey().notNull(),
	failedCount: integer("failed_count").default(0).notNull(),
	lockedUntil: timestamp("locked_until", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
});

export const media = pgTable("media", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	storageKey: text("storage_key").notNull(),
	originalName: text("original_name"),
	mimeType: text("mime_type").notNull(),
	width: integer().notNull(),
	height: integer().notNull(),
	bytes: integer().notNull(),
	variants: jsonb().default([]).notNull(),
	altAr: text("alt_ar"),
	altEn: text("alt_en"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "media_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "media_created_by_fkey"
		}),
	unique("media_id_branch_uq").on(table.id, table.branchId),
	check("media_mime_type_check", sql`mime_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text])`),
	check("media_width_check", sql`width > 0`),
	check("media_height_check", sql`height > 0`),
	check("media_bytes_check", sql`bytes > 0`),
]);

export const clientMutations = pgTable("client_mutations", {
	id: uuid().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	userId: uuid("user_id"),
	deviceId: text("device_id").notNull(),
	entity: text().notNull(),
	entityId: uuid("entity_id").notNull(),
	op: text().notNull(),
	baseVersion: integer("base_version"),
	payload: jsonb().notNull(),
	result: text().notNull(),
	error: text(),
	clientCreatedAt: timestamp("client_created_at", { withTimezone: true, mode: 'string' }),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
}, (table) => [
	index("client_mutations_entity_idx").using("btree", table.entity.asc().nullsLast().op("text_ops"), table.entityId.asc().nullsLast().op("uuid_ops")),
	index("client_mutations_review_idx").using("btree", table.branchId.asc().nullsLast().op("timestamptz_ops"), table.receivedAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`(result = ANY (ARRAY['conflict'::text, 'rejected'::text]))`),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "client_mutations_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "client_mutations_user_id_fkey"
		}),
	check("client_mutations_result_check", sql`result = ANY (ARRAY['applied'::text, 'duplicate'::text, 'conflict'::text, 'rejected'::text])`),
	check("client_mutations_op_check", sql`op = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text, 'status_change'::text, 'stock_movement'::text, 'settle'::text, 'manual_send'::text, 'edit_items'::text])`),
]);

export const galleryItems = pgTable("gallery_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	titleAr: text("title_ar").notNull(),
	titleEn: text("title_en"),
	descriptionAr: text("description_ar"),
	descriptionEn: text("description_en"),
	serviceId: uuid("service_id"),
	status: text().default('draft').notNull(),
	isFeatured: boolean("is_featured").default(false).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	index("gallery_items_public_idx").using("btree", table.branchId.asc().nullsLast().op("int4_ops"), table.sortOrder.asc().nullsLast().op("uuid_ops")).where(sql`((status = 'published'::text) AND (deleted_at IS NULL))`),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "gallery_items_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "gallery_items_updated_by_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.serviceId],
			foreignColumns: [services.id, services.branchId],
			name: "gallery_items_service_fk"
		}),
	unique("gallery_items_id_branch_uq").on(table.id, table.branchId),
	check("gallery_items_title_ar_check", sql`length(TRIM(BOTH FROM title_ar)) > 0`),
	check("gallery_items_status_check", sql`status = ANY (ARRAY['draft'::text, 'published'::text])`),
]);

export const siteSettings = pgTable("site_settings", {
	branchId: uuid("branch_id").primaryKey().notNull(),
	taglineAr: text("tagline_ar"),
	taglineEn: text("tagline_en"),
	aboutAr: text("about_ar"),
	aboutEn: text("about_en"),
	phone: text(),
	whatsapp: text(),
	email: text(),
	addressAr: text("address_ar"),
	addressEn: text("address_en"),
	mapUrl: text("map_url"),
	openingHours: jsonb("opening_hours").default([]).notNull(),
	socialLinks: jsonb("social_links").default({}).notNull(),
	heroMediaId: uuid("hero_media_id"),
	priceDisplay: text("price_display").default('from').notNull(),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "site_settings_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "site_settings_updated_by_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.heroMediaId],
			foreignColumns: [media.id, media.branchId],
			name: "site_settings_hero_fk"
		}),
	check("site_settings_map_url_check", sql`(map_url IS NULL) OR (map_url ~ '^https://'::text)`),
	check("site_settings_price_display_check", sql`price_display = ANY (ARRAY['exact'::text, 'from'::text, 'hidden'::text])`),
]);

export const customerAccounts = pgTable("customer_accounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	email: text().notNull(),
	passwordHash: text("password_hash").notNull(),
	fullName: text("full_name").notNull(),
	phoneE164: text("phone_e164"),
	locale: text().default('ar').notNull(),
	customerId: uuid("customer_id"),
	emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true, mode: 'string' }),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	uniqueIndex("customer_accounts_customer_uq").using("btree", table.customerId.asc().nullsLast().op("uuid_ops")).where(sql`((customer_id IS NOT NULL) AND (deleted_at IS NULL))`),
	uniqueIndex("customer_accounts_email_uq").using("btree", table.branchId.asc().nullsLast().op("text_ops"), table.email.asc().nullsLast().op("text_ops")).where(sql`(deleted_at IS NULL)`),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "customer_accounts_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.customerId],
			foreignColumns: [customers.id, customers.branchId],
			name: "customer_accounts_customer_fk"
		}),
	unique("customer_accounts_id_branch_uq").on(table.id, table.branchId),
	check("customer_accounts_email_check", sql`(email = lower(email)) AND (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text)`),
	check("customer_accounts_full_name_check", sql`length(TRIM(BOTH FROM full_name)) > 0`),
	check("customer_accounts_phone_e164_check", sql`phone_e164 ~ '^\+[1-9][0-9]{6,14}$'::text`),
	check("customer_accounts_locale_check", sql`locale = ANY (ARRAY['ar'::text, 'en'::text])`),
	check("customer_accounts_verified_link", sql`(customer_id IS NULL) OR (email_verified_at IS NOT NULL)`),
]);

export const customerSessions = pgTable("customer_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	tokenHash: text("token_hash").notNull(),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("customer_sessions_account_idx").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("customer_sessions_expiry_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("customer_sessions_token_uq").using("btree", table.tokenHash.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [customerAccounts.id],
			name: "customer_sessions_account_id_fkey"
		}).onDelete("cascade"),
]);

export const orderFiles = pgTable("order_files", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	orderId: uuid("order_id"),
	orderItemId: uuid("order_item_id"),
	storageKey: text("storage_key").notNull(),
	originalName: text("original_name").notNull(),
	kind: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	bytes: bigint({ mode: "number" }).notNull(),
	uploadedByAccount: uuid("uploaded_by_account"),
	uploadedByUser: uuid("uploaded_by_user"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("order_files_order_idx").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")).where(sql`(deleted_at IS NULL)`),
	index("order_files_unattached_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((order_id IS NULL) AND (deleted_at IS NULL))`),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "order_files_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.uploadedByAccount],
			foreignColumns: [customerAccounts.id],
			name: "order_files_uploaded_by_account_fkey"
		}),
	foreignKey({
			columns: [table.uploadedByUser],
			foreignColumns: [users.id],
			name: "order_files_uploaded_by_user_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.orderId],
			foreignColumns: [orders.id, orders.branchId],
			name: "order_files_order_fk"
		}),
	foreignKey({
			columns: [table.branchId, table.orderItemId],
			foreignColumns: [orderItems.id, orderItems.branchId],
			name: "order_files_item_fk"
		}),
	unique("order_files_id_branch_uq").on(table.id, table.branchId),
	check("order_files_kind_check", sql`kind = ANY (ARRAY['pdf'::text, 'jpg'::text, 'png'::text, 'tiff'::text, 'psd'::text, 'zip'::text])`),
	check("order_files_bytes_check", sql`bytes > 0`),
	check("order_files_uploader", sql`(uploaded_by_account IS NOT NULL) OR (uploaded_by_user IS NOT NULL)`),
	check("order_files_item_needs_order", sql`(order_item_id IS NULL) OR (order_id IS NOT NULL)`),
]);

export const customerTokens = pgTable("customer_tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	purpose: text().notNull(),
	tokenHash: text("token_hash").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	usedAt: timestamp("used_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
}, (table) => [
	index("customer_tokens_account_idx").using("btree", table.accountId.asc().nullsLast().op("text_ops"), table.purpose.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	uniqueIndex("customer_tokens_hash_uq").using("btree", table.tokenHash.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [customerAccounts.id],
			name: "customer_tokens_account_id_fkey"
		}).onDelete("cascade"),
	check("customer_tokens_purpose_check", sql`purpose = ANY (ARRAY['verify_email'::text, 'reset_password'::text])`),
]);

export const auditLog = pgTable("audit_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	actorUserId: uuid("actor_user_id"),
	action: text().notNull(),
	targetType: text("target_type"),
	targetId: uuid("target_id"),
	details: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
}, (table) => [
	index("audit_log_branch_idx").using("btree", table.branchId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "audit_log_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.actorUserId],
			foreignColumns: [users.id],
			name: "audit_log_actor_user_id_fkey"
		}),
]);

export const branches = pgTable("branches", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: text().notNull(),
	nameAr: text("name_ar").notNull(),
	nameEn: text("name_en").notNull(),
	countryCode: char("country_code", { length: 2 }),
	timezone: text().default('UTC').notNull(),
	baseCurrency: char("base_currency", { length: 3 }).default('USD').notNull(),
	phoneE164: text("phone_e164"),
	email: text(),
	address: text(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
	maxDiscountPercent: numeric("max_discount_percent", { precision: 5, scale:  2 }),
	legalNameAr: text("legal_name_ar"),
	legalNameEn: text("legal_name_en"),
	taxNumber: text("tax_number"),
	vatEnabled: boolean("vat_enabled").default(false).notNull(),
	vatRatePercent: numeric("vat_rate_percent", { precision: 5, scale:  2 }).default('0').notNull(),
	invoiceFooterAr: text("invoice_footer_ar"),
	invoiceFooterEn: text("invoice_footer_en"),
	depositPercent: numeric("deposit_percent", { precision: 5, scale:  2 }).default('0').notNull(),
	depositThreshold: numeric("deposit_threshold", { precision: 10, scale:  2 }),
	summaryEmail: text("summary_email"),
	summaryHour: smallint("summary_hour").default(21).notNull(),
	summaryLastDate: date("summary_last_date"),
}, (table) => [
	uniqueIndex("branches_code_uq").using("btree", sql`lower(code)`).where(sql`(deleted_at IS NULL)`),
	check("branches_base_currency_check", sql`base_currency ~ '^[A-Z]{3}$'::text`),
	check("branches_phone_e164_check", sql`phone_e164 ~ '^\+[1-9][0-9]{6,14}$'::text`),
	check("branches_max_discount_percent_check", sql`(max_discount_percent >= (0)::numeric) AND (max_discount_percent <= (100)::numeric)`),
	check("branches_vat_rate_percent_check", sql`(vat_rate_percent >= (0)::numeric) AND (vat_rate_percent <= (100)::numeric)`),
	check("branches_deposit_percent_check", sql`(deposit_percent >= (0)::numeric) AND (deposit_percent <= (100)::numeric)`),
	check("branches_deposit_threshold_check", sql`(deposit_threshold IS NULL) OR (deposit_threshold >= (0)::numeric)`),
	check("branches_summary_hour_check", sql`(summary_hour >= 0) AND (summary_hour <= 23)`),
]);

export const pushSubscriptions = pgTable("push_subscriptions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	userId: uuid("user_id").notNull(),
	endpoint: text().notNull(),
	p256Dh: text().notNull(),
	auth: text().notNull(),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	lastSentAt: timestamp("last_sent_at", { withTimezone: true, mode: 'string' }),
	lastError: text("last_error"),
}, (table) => [
	index("push_subscriptions_branch_idx").using("btree", table.branchId.asc().nullsLast().op("uuid_ops")).where(sql`(last_error IS NULL)`),
	uniqueIndex("push_subscriptions_endpoint_uq").using("btree", table.endpoint.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "push_subscriptions_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "push_subscriptions_user_id_fkey"
		}),
]);

export const quotes = pgTable("quotes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	quoteNumber: bigint("quote_number", { mode: "number" }).notNull(),
	publicCode: text("public_code").notNull(),
	customerId: uuid("customer_id").notNull(),
	status: text().default('sent').notNull(),
	currency: char({ length: 3 }).notNull(),
	subtotal: numeric({ precision: 14, scale:  2 }).notNull(),
	discountTotal: numeric("discount_total", { precision: 14, scale:  2 }).default('0').notNull(),
	taxTotal: numeric("tax_total", { precision: 14, scale:  2 }).default('0').notNull(),
	total: numeric({ precision: 14, scale:  2 }).notNull(),
	validUntil: timestamp("valid_until", { withTimezone: true, mode: 'string' }).notNull(),
	notes: text(),
	internalNotes: text("internal_notes"),
	declineReason: text("decline_reason"),
	orderId: uuid("order_id"),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	index("quotes_branch_idx").using("btree", table.branchId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`(deleted_at IS NULL)`),
	uniqueIndex("quotes_number_uq").using("btree", table.branchId.asc().nullsLast().op("uuid_ops"), table.quoteNumber.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("quotes_public_code_uq").using("btree", table.publicCode.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "quotes_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "quotes_created_by_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.customerId],
			foreignColumns: [customers.id, customers.branchId],
			name: "quotes_customer_fk"
		}),
	foreignKey({
			columns: [table.branchId, table.orderId],
			foreignColumns: [orders.id, orders.branchId],
			name: "quotes_order_fk"
		}),
	unique("quotes_id_branch_uq").on(table.id, table.branchId),
	check("quotes_public_code_check", sql`public_code ~ '^[0-9A-HJKMNP-TV-Z]{10,16}$'::text`),
	check("quotes_status_check", sql`status = ANY (ARRAY['sent'::text, 'accepted'::text, 'declined'::text, 'cancelled'::text])`),
	check("quotes_subtotal_check", sql`subtotal >= (0)::numeric`),
	check("quotes_discount_total_check", sql`discount_total >= (0)::numeric`),
	check("quotes_tax_total_check", sql`tax_total >= (0)::numeric`),
	check("quotes_total_check", sql`total >= (0)::numeric`),
	check("quotes_total_consistent", sql`total = ((subtotal - discount_total) + tax_total)`),
	check("quotes_accepted_has_order", sql`(status = 'accepted'::text) = ((order_id IS NOT NULL) AND (accepted_at IS NOT NULL))`),
]);

export const quoteItems = pgTable("quote_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	quoteId: uuid("quote_id").notNull(),
	productId: uuid("product_id"),
	sortOrder: integer("sort_order").default(0).notNull(),
	nameSnapshot: text("name_snapshot").notNull(),
	unit: text().default('piece').notNull(),
	quantity: numeric({ precision: 14, scale:  3 }).notNull(),
	unitPrice: numeric("unit_price", { precision: 14, scale:  4 }).notNull(),
	discount: numeric({ precision: 14, scale:  2 }).default('0').notNull(),
	lineTotal: numeric("line_total", { precision: 14, scale:  2 }).notNull(),
	notes: text(),
}, (table) => [
	index("quote_items_quote_idx").using("btree", table.quoteId.asc().nullsLast().op("int4_ops"), table.sortOrder.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "quote_items_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.quoteId],
			foreignColumns: [quotes.id, quotes.branchId],
			name: "quote_items_quote_fk"
		}).onDelete("cascade"),
	check("quote_items_name_snapshot_check", sql`length(TRIM(BOTH FROM name_snapshot)) > 0`),
	check("quote_items_quantity_check", sql`quantity > (0)::numeric`),
	check("quote_items_unit_price_check", sql`unit_price >= (0)::numeric`),
	check("quote_items_discount_check", sql`discount >= (0)::numeric`),
	check("quote_items_line_total_check", sql`line_total >= (0)::numeric`),
]);

export const proofs = pgTable("proofs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	orderId: uuid("order_id").notNull(),
	version: integer().notNull(),
	publicCode: text("public_code").notNull(),
	storageKey: text("storage_key").notNull(),
	originalName: text("original_name").notNull(),
	kind: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	bytes: bigint({ mode: "number" }).notNull(),
	sha256: text().notNull(),
	status: text().default('pending').notNull(),
	uploadedBy: uuid("uploaded_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	uniqueIndex("proofs_public_code_uq").using("btree", table.publicCode.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "proofs_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.uploadedBy],
			foreignColumns: [users.id],
			name: "proofs_uploaded_by_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.orderId],
			foreignColumns: [orders.id, orders.branchId],
			name: "proofs_order_fk"
		}),
	unique("proofs_id_branch_uq").on(table.id, table.branchId),
	unique("proofs_order_version_uq").on(table.orderId, table.version),
	check("proofs_bytes_check", sql`bytes > 0`),
	check("proofs_sha256_check", sql`sha256 ~ '^[0-9a-f]{64}$'::text`),
	check("proofs_version_check", sql`version > 0`),
	check("proofs_public_code_check", sql`public_code ~ '^[0-9A-HJKMNP-TV-Z]{10,16}$'::text`),
	check("proofs_kind_check", sql`kind = ANY (ARRAY['pdf'::text, 'jpg'::text, 'png'::text])`),
	check("proofs_status_check", sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'changes_requested'::text, 'superseded'::text])`),
]);

export const companyPriceOverrides = pgTable("company_price_overrides", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	customerId: uuid("customer_id").notNull(),
	productId: uuid("product_id").notNull(),
	unitPrice: numeric("unit_price", { precision: 14, scale:  4 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	rowVersion: integer("row_version").default(1).notNull(),
}, (table) => [
	uniqueIndex("company_price_overrides_uq").using("btree", table.customerId.asc().nullsLast().op("uuid_ops"), table.productId.asc().nullsLast().op("uuid_ops")).where(sql`(deleted_at IS NULL)`),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "company_price_overrides_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.customerId],
			foreignColumns: [customers.id, customers.branchId],
			name: "company_price_overrides_customer_fk"
		}),
	foreignKey({
			columns: [table.branchId, table.productId],
			foreignColumns: [products.id, products.branchId],
			name: "company_price_overrides_product_fk"
		}),
	check("company_price_overrides_unit_price_check", sql`unit_price >= (0)::numeric`),
]);

export const proofResponses = pgTable("proof_responses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	proofId: uuid("proof_id").notNull(),
	orderId: uuid("order_id").notNull(),
	proofVersion: integer("proof_version").notNull(),
	fileSha256: text("file_sha256").notNull(),
	decision: text().notNull(),
	comment: text(),
	respondedAt: timestamp("responded_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	userAgent: text("user_agent"),
}, (table) => [
	index("proof_responses_order_idx").using("btree", table.orderId.asc().nullsLast().op("timestamptz_ops"), table.respondedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "proof_responses_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.proofId],
			foreignColumns: [proofs.id, proofs.branchId],
			name: "proof_responses_proof_fk"
		}),
	check("proof_responses_decision_check", sql`decision = ANY (ARRAY['approved'::text, 'changes_requested'::text])`),
	check("proof_responses_comment_needed", sql`(decision = 'approved'::text) OR (length(TRIM(BOTH FROM COALESCE(comment, ''::text))) > 0)`),
]);

export const companyInvoices = pgTable("company_invoices", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	branchId: uuid("branch_id").notNull(),
	customerId: uuid("customer_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	invoiceNumber: bigint("invoice_number", { mode: "number" }).notNull(),
	currency: char({ length: 3 }).notNull(),
	subtotal: numeric({ precision: 14, scale:  2 }).notNull(),
	taxTotal: numeric("tax_total", { precision: 14, scale:  2 }).default('0').notNull(),
	total: numeric({ precision: 14, scale:  2 }).notNull(),
	orderCount: integer("order_count").notNull(),
	issuedAt: timestamp("issued_at", { withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	issuedBy: uuid("issued_by"),
}, (table) => [
	uniqueIndex("company_invoices_number_uq").using("btree", table.branchId.asc().nullsLast().op("int8_ops"), table.invoiceNumber.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "company_invoices_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.issuedBy],
			foreignColumns: [users.id],
			name: "company_invoices_issued_by_fkey"
		}),
	foreignKey({
			columns: [table.branchId, table.customerId],
			foreignColumns: [customers.id, customers.branchId],
			name: "company_invoices_customer_fk"
		}),
	check("company_invoices_subtotal_check", sql`subtotal >= (0)::numeric`),
	check("company_invoices_tax_total_check", sql`tax_total >= (0)::numeric`),
	check("company_invoices_total_check", sql`total >= (0)::numeric`),
	check("company_invoices_order_count_check", sql`order_count > 0`),
	check("company_invoices_total_consistent", sql`total = (subtotal + tax_total)`),
]);

export const branchCounters = pgTable("branch_counters", {
	branchId: uuid("branch_id").notNull(),
	counter: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	nextValue: bigint("next_value", { mode: "number" }).default(1).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "branch_counters_branch_id_fkey"
		}),
	primaryKey({ columns: [table.branchId, table.counter], name: "branch_counters_pkey"}),
]);

export const galleryItemMedia = pgTable("gallery_item_media", {
	galleryItemId: uuid("gallery_item_id").notNull(),
	mediaId: uuid("media_id").notNull(),
	branchId: uuid("branch_id").notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.branchId],
			foreignColumns: [branches.id],
			name: "gallery_item_media_branch_id_fkey"
		}),
	foreignKey({
			columns: [table.galleryItemId, table.branchId],
			foreignColumns: [galleryItems.id, galleryItems.branchId],
			name: "gallery_item_media_item_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.mediaId, table.branchId],
			foreignColumns: [media.id, media.branchId],
			name: "gallery_item_media_media_fk"
		}),
	primaryKey({ columns: [table.galleryItemId, table.mediaId], name: "gallery_item_media_pkey"}),
]);
