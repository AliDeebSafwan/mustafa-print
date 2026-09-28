-- 0011_discount_cap.sql : how much the shop lets staff discount without a manager
-- NULL means no limit (the shop has not set one yet), so adding this column changes nothing until the owner decides.

ALTER TABLE branches ADD COLUMN max_discount_percent numeric(5,2)
  CHECK (max_discount_percent >= 0 AND max_discount_percent <= 100);

COMMENT ON COLUMN branches.max_discount_percent IS
  'Largest discount, as a percent of an order''s subtotal, that staff without orders:discount:override may give. NULL = no limit.';
