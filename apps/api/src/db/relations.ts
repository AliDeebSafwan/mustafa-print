import { relations } from "drizzle-orm/relations";
import { branches, users, roles, customers, products, media, services, inventoryItems, orders, companyInvoices, orderItems, barcodes, productMaterials, orderStatusHistory, stockMovements, transactions, notificationTemplates, notificationLogs, refreshTokens, clientMutations, galleryItems, siteSettings, customerAccounts, customerSessions, orderFiles, customerTokens, auditLog, pushSubscriptions, quotes, quoteItems, proofs, companyPriceOverrides, proofResponses, branchCounters, galleryItemMedia } from "./schema";

export const usersRelations = relations(users, ({one, many}) => ({
	branch: one(branches, {
		fields: [users.branchId],
		references: [branches.id]
	}),
	role: one(roles, {
		fields: [users.roleId],
		references: [roles.id]
	}),
	orders: many(orders),
	orderStatusHistories: many(orderStatusHistory),
	stockMovements: many(stockMovements),
	transactions_collectedBy: many(transactions, {
		relationName: "transactions_collectedBy_users_id"
	}),
	transactions_settledBy: many(transactions, {
		relationName: "transactions_settledBy_users_id"
	}),
	transactions_createdBy: many(transactions, {
		relationName: "transactions_createdBy_users_id"
	}),
	notificationLogs: many(notificationLogs),
	services: many(services),
	refreshTokens: many(refreshTokens),
	media: many(media),
	clientMutations: many(clientMutations),
	galleryItems: many(galleryItems),
	siteSettings: many(siteSettings),
	orderFiles: many(orderFiles),
	auditLogs: many(auditLog),
	pushSubscriptions: many(pushSubscriptions),
	quotes: many(quotes),
	proofs: many(proofs),
	companyInvoices: many(companyInvoices),
}));

export const branchesRelations = relations(branches, ({many}) => ({
	users: many(users),
	customers: many(customers),
	products: many(products),
	inventoryItems: many(inventoryItems),
	orders: many(orders),
	orderItems: many(orderItems),
	barcodes: many(barcodes),
	productMaterials: many(productMaterials),
	orderStatusHistories: many(orderStatusHistory),
	stockMovements: many(stockMovements),
	transactions: many(transactions),
	notificationTemplates: many(notificationTemplates),
	notificationLogs: many(notificationLogs),
	services: many(services),
	media: many(media),
	clientMutations: many(clientMutations),
	galleryItems: many(galleryItems),
	siteSettings: many(siteSettings),
	customerAccounts: many(customerAccounts),
	orderFiles: many(orderFiles),
	auditLogs: many(auditLog),
	pushSubscriptions: many(pushSubscriptions),
	quotes: many(quotes),
	quoteItems: many(quoteItems),
	proofs: many(proofs),
	companyPriceOverrides: many(companyPriceOverrides),
	proofResponses: many(proofResponses),
	companyInvoices: many(companyInvoices),
	branchCounters: many(branchCounters),
	galleryItemMedias: many(galleryItemMedia),
}));

export const rolesRelations = relations(roles, ({many}) => ({
	users: many(users),
}));

export const customersRelations = relations(customers, ({one, many}) => ({
	branch: one(branches, {
		fields: [customers.branchId],
		references: [branches.id]
	}),
	orders: many(orders),
	transactions: many(transactions),
	notificationLogs: many(notificationLogs),
	customerAccounts: many(customerAccounts),
	quotes: many(quotes),
	companyPriceOverrides: many(companyPriceOverrides),
	companyInvoices: many(companyInvoices),
}));

export const productsRelations = relations(products, ({one, many}) => ({
	branch: one(branches, {
		fields: [products.branchId],
		references: [branches.id]
	}),
	media: one(media, {
		fields: [products.branchId],
		references: [media.id]
	}),
	service: one(services, {
		fields: [products.branchId],
		references: [services.id]
	}),
	orderItems: many(orderItems),
	productMaterials: many(productMaterials),
	companyPriceOverrides: many(companyPriceOverrides),
}));

export const mediaRelations = relations(media, ({one, many}) => ({
	products: many(products),
	services: many(services),
	branch: one(branches, {
		fields: [media.branchId],
		references: [branches.id]
	}),
	user: one(users, {
		fields: [media.createdBy],
		references: [users.id]
	}),
	siteSettings: many(siteSettings),
	galleryItemMedias: many(galleryItemMedia),
}));

export const servicesRelations = relations(services, ({one, many}) => ({
	products: many(products),
	branch: one(branches, {
		fields: [services.branchId],
		references: [branches.id]
	}),
	user: one(users, {
		fields: [services.updatedBy],
		references: [users.id]
	}),
	media: one(media, {
		fields: [services.branchId],
		references: [media.id]
	}),
	galleryItems: many(galleryItems),
}));

export const inventoryItemsRelations = relations(inventoryItems, ({one, many}) => ({
	branch: one(branches, {
		fields: [inventoryItems.branchId],
		references: [branches.id]
	}),
	productMaterials: many(productMaterials),
	stockMovements: many(stockMovements),
}));

export const ordersRelations = relations(orders, ({one, many}) => ({
	branch: one(branches, {
		fields: [orders.branchId],
		references: [branches.id]
	}),
	user: one(users, {
		fields: [orders.createdBy],
		references: [users.id]
	}),
	customer: one(customers, {
		fields: [orders.branchId],
		references: [customers.id]
	}),
	companyInvoice: one(companyInvoices, {
		fields: [orders.companyInvoiceId],
		references: [companyInvoices.id]
	}),
	orderItems: many(orderItems),
	barcodes: many(barcodes),
	orderStatusHistories: many(orderStatusHistory),
	stockMovements: many(stockMovements),
	transactions: many(transactions),
	notificationLogs: many(notificationLogs),
	orderFiles: many(orderFiles),
	quotes: many(quotes),
	proofs: many(proofs),
}));

export const companyInvoicesRelations = relations(companyInvoices, ({one, many}) => ({
	orders: many(orders),
	branch: one(branches, {
		fields: [companyInvoices.branchId],
		references: [branches.id]
	}),
	user: one(users, {
		fields: [companyInvoices.issuedBy],
		references: [users.id]
	}),
	customer: one(customers, {
		fields: [companyInvoices.branchId],
		references: [customers.id]
	}),
}));

export const orderItemsRelations = relations(orderItems, ({one, many}) => ({
	branch: one(branches, {
		fields: [orderItems.branchId],
		references: [branches.id]
	}),
	order: one(orders, {
		fields: [orderItems.branchId],
		references: [orders.id]
	}),
	product: one(products, {
		fields: [orderItems.branchId],
		references: [products.id]
	}),
	barcodes: many(barcodes),
	stockMovements: many(stockMovements),
	orderFiles: many(orderFiles),
}));

export const barcodesRelations = relations(barcodes, ({one, many}) => ({
	branch: one(branches, {
		fields: [barcodes.branchId],
		references: [branches.id]
	}),
	order: one(orders, {
		fields: [barcodes.branchId],
		references: [orders.id]
	}),
	orderItem: one(orderItems, {
		fields: [barcodes.branchId],
		references: [orderItems.id]
	}),
	orderStatusHistories: many(orderStatusHistory),
}));

export const productMaterialsRelations = relations(productMaterials, ({one}) => ({
	branch: one(branches, {
		fields: [productMaterials.branchId],
		references: [branches.id]
	}),
	product: one(products, {
		fields: [productMaterials.branchId],
		references: [products.id]
	}),
	inventoryItem: one(inventoryItems, {
		fields: [productMaterials.branchId],
		references: [inventoryItems.id]
	}),
}));

export const orderStatusHistoryRelations = relations(orderStatusHistory, ({one, many}) => ({
	branch: one(branches, {
		fields: [orderStatusHistory.branchId],
		references: [branches.id]
	}),
	user: one(users, {
		fields: [orderStatusHistory.changedBy],
		references: [users.id]
	}),
	order: one(orders, {
		fields: [orderStatusHistory.branchId],
		references: [orders.id]
	}),
	barcode: one(barcodes, {
		fields: [orderStatusHistory.branchId],
		references: [barcodes.id]
	}),
	stockMovements: many(stockMovements),
}));

export const stockMovementsRelations = relations(stockMovements, ({one}) => ({
	order: one(orders, {
		fields: [stockMovements.branchId],
		references: [orders.id]
	}),
	orderItem: one(orderItems, {
		fields: [stockMovements.branchId],
		references: [orderItems.id]
	}),
	branch: one(branches, {
		fields: [stockMovements.branchId],
		references: [branches.id]
	}),
	user: one(users, {
		fields: [stockMovements.createdBy],
		references: [users.id]
	}),
	inventoryItem: one(inventoryItems, {
		fields: [stockMovements.branchId],
		references: [inventoryItems.id]
	}),
	orderStatusHistory: one(orderStatusHistory, {
		fields: [stockMovements.sourceEventId],
		references: [orderStatusHistory.id]
	}),
}));

export const transactionsRelations = relations(transactions, ({one}) => ({
	branch: one(branches, {
		fields: [transactions.branchId],
		references: [branches.id]
	}),
	user_collectedBy: one(users, {
		fields: [transactions.collectedBy],
		references: [users.id],
		relationName: "transactions_collectedBy_users_id"
	}),
	user_settledBy: one(users, {
		fields: [transactions.settledBy],
		references: [users.id],
		relationName: "transactions_settledBy_users_id"
	}),
	user_createdBy: one(users, {
		fields: [transactions.createdBy],
		references: [users.id],
		relationName: "transactions_createdBy_users_id"
	}),
	order: one(orders, {
		fields: [transactions.branchId],
		references: [orders.id]
	}),
	customer: one(customers, {
		fields: [transactions.branchId],
		references: [customers.id]
	}),
}));

export const notificationTemplatesRelations = relations(notificationTemplates, ({one, many}) => ({
	branch: one(branches, {
		fields: [notificationTemplates.branchId],
		references: [branches.id]
	}),
	notificationLogs: many(notificationLogs),
}));

export const notificationLogsRelations = relations(notificationLogs, ({one}) => ({
	branch: one(branches, {
		fields: [notificationLogs.branchId],
		references: [branches.id]
	}),
	user: one(users, {
		fields: [notificationLogs.createdBy],
		references: [users.id]
	}),
	order: one(orders, {
		fields: [notificationLogs.branchId],
		references: [orders.id]
	}),
	customer: one(customers, {
		fields: [notificationLogs.branchId],
		references: [customers.id]
	}),
	notificationTemplate: one(notificationTemplates, {
		fields: [notificationLogs.branchId],
		references: [notificationTemplates.id]
	}),
}));

export const refreshTokensRelations = relations(refreshTokens, ({one, many}) => ({
	user: one(users, {
		fields: [refreshTokens.userId],
		references: [users.id]
	}),
	refreshToken: one(refreshTokens, {
		fields: [refreshTokens.replacedBy],
		references: [refreshTokens.id],
		relationName: "refreshTokens_replacedBy_refreshTokens_id"
	}),
	refreshTokens: many(refreshTokens, {
		relationName: "refreshTokens_replacedBy_refreshTokens_id"
	}),
}));

export const clientMutationsRelations = relations(clientMutations, ({one}) => ({
	branch: one(branches, {
		fields: [clientMutations.branchId],
		references: [branches.id]
	}),
	user: one(users, {
		fields: [clientMutations.userId],
		references: [users.id]
	}),
}));

export const galleryItemsRelations = relations(galleryItems, ({one, many}) => ({
	branch: one(branches, {
		fields: [galleryItems.branchId],
		references: [branches.id]
	}),
	user: one(users, {
		fields: [galleryItems.updatedBy],
		references: [users.id]
	}),
	service: one(services, {
		fields: [galleryItems.branchId],
		references: [services.id]
	}),
	galleryItemMedias: many(galleryItemMedia),
}));

export const siteSettingsRelations = relations(siteSettings, ({one}) => ({
	branch: one(branches, {
		fields: [siteSettings.branchId],
		references: [branches.id]
	}),
	user: one(users, {
		fields: [siteSettings.updatedBy],
		references: [users.id]
	}),
	media: one(media, {
		fields: [siteSettings.branchId],
		references: [media.id]
	}),
}));

export const customerAccountsRelations = relations(customerAccounts, ({one, many}) => ({
	branch: one(branches, {
		fields: [customerAccounts.branchId],
		references: [branches.id]
	}),
	customer: one(customers, {
		fields: [customerAccounts.branchId],
		references: [customers.id]
	}),
	customerSessions: many(customerSessions),
	orderFiles: many(orderFiles),
	customerTokens: many(customerTokens),
}));

export const customerSessionsRelations = relations(customerSessions, ({one}) => ({
	customerAccount: one(customerAccounts, {
		fields: [customerSessions.accountId],
		references: [customerAccounts.id]
	}),
}));

export const orderFilesRelations = relations(orderFiles, ({one}) => ({
	branch: one(branches, {
		fields: [orderFiles.branchId],
		references: [branches.id]
	}),
	customerAccount: one(customerAccounts, {
		fields: [orderFiles.uploadedByAccount],
		references: [customerAccounts.id]
	}),
	user: one(users, {
		fields: [orderFiles.uploadedByUser],
		references: [users.id]
	}),
	order: one(orders, {
		fields: [orderFiles.branchId],
		references: [orders.id]
	}),
	orderItem: one(orderItems, {
		fields: [orderFiles.branchId],
		references: [orderItems.id]
	}),
}));

export const customerTokensRelations = relations(customerTokens, ({one}) => ({
	customerAccount: one(customerAccounts, {
		fields: [customerTokens.accountId],
		references: [customerAccounts.id]
	}),
}));

export const auditLogRelations = relations(auditLog, ({one}) => ({
	branch: one(branches, {
		fields: [auditLog.branchId],
		references: [branches.id]
	}),
	user: one(users, {
		fields: [auditLog.actorUserId],
		references: [users.id]
	}),
}));

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({one}) => ({
	branch: one(branches, {
		fields: [pushSubscriptions.branchId],
		references: [branches.id]
	}),
	user: one(users, {
		fields: [pushSubscriptions.userId],
		references: [users.id]
	}),
}));

export const quotesRelations = relations(quotes, ({one, many}) => ({
	branch: one(branches, {
		fields: [quotes.branchId],
		references: [branches.id]
	}),
	user: one(users, {
		fields: [quotes.createdBy],
		references: [users.id]
	}),
	customer: one(customers, {
		fields: [quotes.branchId],
		references: [customers.id]
	}),
	order: one(orders, {
		fields: [quotes.branchId],
		references: [orders.id]
	}),
	quoteItems: many(quoteItems),
}));

export const quoteItemsRelations = relations(quoteItems, ({one}) => ({
	branch: one(branches, {
		fields: [quoteItems.branchId],
		references: [branches.id]
	}),
	quote: one(quotes, {
		fields: [quoteItems.branchId],
		references: [quotes.id]
	}),
}));

export const proofsRelations = relations(proofs, ({one, many}) => ({
	branch: one(branches, {
		fields: [proofs.branchId],
		references: [branches.id]
	}),
	user: one(users, {
		fields: [proofs.uploadedBy],
		references: [users.id]
	}),
	order: one(orders, {
		fields: [proofs.branchId],
		references: [orders.id]
	}),
	proofResponses: many(proofResponses),
}));

export const companyPriceOverridesRelations = relations(companyPriceOverrides, ({one}) => ({
	branch: one(branches, {
		fields: [companyPriceOverrides.branchId],
		references: [branches.id]
	}),
	customer: one(customers, {
		fields: [companyPriceOverrides.branchId],
		references: [customers.id]
	}),
	product: one(products, {
		fields: [companyPriceOverrides.branchId],
		references: [products.id]
	}),
}));

export const proofResponsesRelations = relations(proofResponses, ({one}) => ({
	branch: one(branches, {
		fields: [proofResponses.branchId],
		references: [branches.id]
	}),
	proof: one(proofs, {
		fields: [proofResponses.branchId],
		references: [proofs.id]
	}),
}));

export const branchCountersRelations = relations(branchCounters, ({one}) => ({
	branch: one(branches, {
		fields: [branchCounters.branchId],
		references: [branches.id]
	}),
}));

export const galleryItemMediaRelations = relations(galleryItemMedia, ({one}) => ({
	branch: one(branches, {
		fields: [galleryItemMedia.branchId],
		references: [branches.id]
	}),
	galleryItem: one(galleryItems, {
		fields: [galleryItemMedia.galleryItemId],
		references: [galleryItems.id]
	}),
	media: one(media, {
		fields: [galleryItemMedia.mediaId],
		references: [media.id]
	}),
}));