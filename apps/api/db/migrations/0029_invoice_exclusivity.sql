-- 0029_invoice_exclusivity.sql : an order is invoiced ONCE — either on its own invoice or on a company's consolidated
-- one, never both. 0027's comment called the two "independent"; that was wrong: the same sale on two invoices is the
-- same revenue declared twice. Corrected here (applied migrations are never edited) and enforced by the database.
ALTER TABLE orders ADD CONSTRAINT orders_invoiced_once CHECK (invoice_number IS NULL OR company_invoice_id IS NULL);
COMMENT ON COLUMN orders.company_invoice_id IS 'The consolidated company invoice this order was billed on. Exclusive with invoice_number: an order is invoiced once.';
