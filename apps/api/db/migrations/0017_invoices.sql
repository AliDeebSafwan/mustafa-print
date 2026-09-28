-- 0017_invoices.sql : printed invoices, with VAT off by default until the owner's accountant says otherwise
--
-- Nothing here assumes whether the shop charges VAT or what its legal paperwork looks like — that is exactly the
-- open question the owner's accountant answers. Everything defaults to "off" / blank, so invoices already work
-- correctly (no tax line, the shop's ordinary name) before anyone configures anything, and become fully compliant
-- the moment real values are entered from Settings.

ALTER TABLE branches ADD COLUMN legal_name_ar text;
ALTER TABLE branches ADD COLUMN legal_name_en text;
ALTER TABLE branches ADD COLUMN tax_number text;
ALTER TABLE branches ADD COLUMN vat_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE branches ADD COLUMN vat_rate_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate_percent >= 0 AND vat_rate_percent <= 100);
ALTER TABLE branches ADD COLUMN invoice_footer_ar text;
ALTER TABLE branches ADD COLUMN invoice_footer_en text;
COMMENT ON COLUMN branches.legal_name_ar IS 'The shop''s registered legal name for invoices, if it differs from name_ar. Blank falls back to name_ar.';
COMMENT ON COLUMN branches.vat_rate_percent IS 'Only applied when vat_enabled. The owner''s accountant sets this; it is never assumed.';

-- Invoices get their own gap-free sequence (next_branch_counter, from migration 0002), separate from order_number:
-- a cancelled order never consumes an invoice number, and reprinting the same order's invoice never issues a new one.
ALTER TABLE orders ADD COLUMN invoice_number bigint;
ALTER TABLE orders ADD COLUMN invoice_issued_at timestamptz;
CREATE UNIQUE INDEX orders_invoice_number_uq ON orders (branch_id, invoice_number) WHERE invoice_number IS NOT NULL;
COMMENT ON COLUMN orders.invoice_number IS 'Assigned once, the first time an invoice is printed for this order (never for a cancelled one). Reprinting reuses it.';

-- The one place VAT is actually computed, so every order-money write (creation, a web order, pricing a delivery)
-- agrees with the invoice that is printed from it later.
CREATE FUNCTION branch_vat_amount(p_branch_id uuid, p_taxable_base numeric) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN b.vat_enabled THEN round(p_taxable_base * b.vat_rate_percent / 100, 2) ELSE 0 END
    FROM branches b WHERE b.id = p_branch_id
$$;
COMMENT ON FUNCTION branch_vat_amount IS 'tax_total for an order: 0 unless the branch has VAT enabled, in which case p_taxable_base * vat_rate_percent / 100.';
