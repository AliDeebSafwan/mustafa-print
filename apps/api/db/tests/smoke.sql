-- Smoke tests for the schema rules. Runs inside a transaction and ROLLS BACK.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/smoke.sql
BEGIN;

CREATE FUNCTION pg_temp.expect_error(p_state text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN RETURN; END IF;
    RAISE EXCEPTION 'expected SQLSTATE % but got % (%): %', p_state, SQLSTATE, SQLERRM, p_sql;
  END;
  RAISE EXCEPTION 'expected SQLSTATE % but statement succeeded: %', p_state, p_sql;
END $$;

DO $$
DECLARE
  b1 uuid := '11111111-1111-1111-1111-111111111111';
  b2 uuid := '22222222-2222-2222-2222-222222222222';
  r  uuid := '33333333-3333-3333-3333-333333333333';
  u  uuid := '44444444-4444-4444-4444-444444444444';
  c1 uuid := '55555555-5555-5555-5555-555555555551';
  c2 uuid := '55555555-5555-5555-5555-555555555552';
  o1 uuid := '66666666-6666-6666-6666-666666666661';
  o2 uuid := '66666666-6666-6666-6666-666666666662';
  o3 uuid := '66666666-6666-6666-6666-666666666663';
  i1 uuid := '77777777-7777-7777-7777-777777777771';
  m1 uuid := '88888888-8888-8888-8888-888888888881';
  n1 int; n2 int; n3 int;
  v numeric; s text; ver int; ver2 int; t1 timestamptz; t2 timestamptz;
BEGIN
  INSERT INTO branches (id, code, name_ar, name_en) VALUES (b1, 'MAIN', 'الفرع الرئيسي', 'Main'), (b2, 'B2', 'فرع ٢', 'Branch 2');
  INSERT INTO roles (id, key, name_ar, name_en) VALUES (r, 'admin', 'مدير', 'Admin');
  INSERT INTO users (id, branch_id, role_id, full_name, email) VALUES (u, b1, r, 'Test Admin', 'a@example.com');
  INSERT INTO customers (id, branch_id, full_name, phone_e164) VALUES (c1, b1, 'عميل أول', '+96170000001'), (c2, b2, 'Customer B2', '+96170000002');

  -- 1. order numbers: gap-free per branch
  INSERT INTO orders (id, branch_id, public_code, customer_id) VALUES (o1, b1, 'ABCDEFGH23', c1);
  INSERT INTO orders (id, branch_id, public_code, customer_id) VALUES (o2, b1, 'ABCDEFGH24', c1);
  INSERT INTO orders (id, branch_id, public_code, customer_id) VALUES (o3, b2, 'ABCDEFGH25', c2);
  SELECT order_number INTO n1 FROM orders WHERE id = o1;
  SELECT order_number INTO n2 FROM orders WHERE id = o2;
  SELECT order_number INTO n3 FROM orders WHERE id = o3;
  ASSERT n1 = 1 AND n2 = 2 AND n3 = 1, format('order numbers per branch: %s %s %s', n1, n2, n3);

  -- 2. cross-branch references are rejected by the composite FK
  PERFORM pg_temp.expect_error('23503', format($q$INSERT INTO orders (branch_id, public_code, customer_id) VALUES (%L, 'ABCDEFGH26', %L)$q$, b1, c2));

  -- 3. money consistency + code format + status domain
  PERFORM pg_temp.expect_error('23514', format($q$INSERT INTO orders (branch_id, public_code, customer_id, subtotal, total) VALUES (%L, 'ABCDEFGH27', %L, 10, 5)$q$, b1, c1));
  PERFORM pg_temp.expect_error('23514', format($q$INSERT INTO orders (branch_id, public_code, customer_id) VALUES (%L, 'short', %L)$q$, b1, c1));
  PERFORM pg_temp.expect_error('23514', format($q$UPDATE orders SET status = 'teleported' WHERE id = %L$q$, o1));

  -- 4. status timestamps
  UPDATE orders SET status = 'delivered' WHERE id = o1;
  ASSERT (SELECT completed_at IS NOT NULL FROM orders WHERE id = o1), 'completed_at set on delivered';

  -- 5. inventory: derived quantity, guarded, sign rules, idempotent replay, append-only
  INSERT INTO inventory_items (id, branch_id, sku, name_ar, name_en, category, unit, reorder_level)
       VALUES (i1, b1, 'PAPER-A4-80', 'ورق A4 80غ', 'A4 paper 80gsm', 'paper', 'sheet', 50);
  PERFORM pg_temp.expect_error('P0001', format($q$INSERT INTO inventory_items (branch_id, sku, name_ar, name_en, category, unit, quantity_on_hand) VALUES (%L, 'X1', 'x', 'x', 'ink', 'ml', 5)$q$, b1));
  INSERT INTO stock_movements (id, branch_id, item_id, movement_type, quantity_delta) VALUES (m1, b1, i1, 'receipt', 100);
  INSERT INTO stock_movements (branch_id, item_id, movement_type, quantity_delta, order_id) VALUES (b1, i1, 'consumption', -30, o2);
  SELECT quantity_on_hand INTO v FROM inventory_items WHERE id = i1;
  ASSERT v = 70, format('balance after receipt+consumption = %s', v);
  INSERT INTO stock_movements (id, branch_id, item_id, movement_type, quantity_delta) VALUES (m1, b1, i1, 'receipt', 100) ON CONFLICT (id) DO NOTHING;
  SELECT quantity_on_hand INTO v FROM inventory_items WHERE id = i1;
  ASSERT v = 70, 'replaying the same movement id must not double-apply';
  PERFORM pg_temp.expect_error('P0001', format($q$UPDATE inventory_items SET quantity_on_hand = 999 WHERE id = %L$q$, i1));
  PERFORM pg_temp.expect_error('23514', format($q$INSERT INTO stock_movements (branch_id, item_id, movement_type, quantity_delta) VALUES (%L, %L, 'consumption', 5)$q$, b1, i1));
  PERFORM pg_temp.expect_error('23001', format($q$UPDATE stock_movements SET reason = 'edit' WHERE id = %L$q$, m1));
  PERFORM pg_temp.expect_error('23001', format($q$DELETE FROM stock_movements WHERE id = %L$q$, m1));
  ASSERT (SELECT count(*) FROM inventory_items WHERE branch_id = b1 AND is_active AND quantity_on_hand <= reorder_level) = 0, 'not low-stock yet';
  INSERT INTO stock_movements (branch_id, item_id, movement_type, quantity_delta, reason) VALUES (b1, i1, 'waste', -30, 'test');
  ASSERT (SELECT count(*) FROM inventory_items WHERE branch_id = b1 AND is_active AND quantity_on_hand <= reorder_level) = 1, 'low-stock detected';

  -- 6. payments derive order payment state
  UPDATE orders SET subtotal = 100, total = 100 WHERE id = o2;
  INSERT INTO transactions (branch_id, order_id, txn_type, method, status, amount) VALUES (b1, o2, 'payment', 'cod', 'pending', 100);
  SELECT payment_status INTO s FROM orders WHERE id = o2;  ASSERT s = 'unpaid', 'pending payment does not count';
  INSERT INTO transactions (branch_id, order_id, txn_type, method, status, amount) VALUES (b1, o2, 'payment', 'cash', 'completed', 40);
  SELECT payment_status, paid_total INTO s, v FROM orders WHERE id = o2;  ASSERT s = 'partial' AND v = 40, format('partial: %s %s', s, v);
  INSERT INTO transactions (branch_id, order_id, txn_type, method, status, amount) VALUES (b1, o2, 'payment', 'cash', 'completed', 60);
  SELECT payment_status, paid_total INTO s, v FROM orders WHERE id = o2;  ASSERT s = 'paid' AND v = 100, format('paid: %s %s', s, v);
  INSERT INTO transactions (branch_id, order_id, txn_type, method, status, amount) VALUES (b1, o2, 'refund', 'cash', 'completed', 100);
  SELECT payment_status INTO s FROM orders WHERE id = o2;  ASSERT s = 'refunded', format('refunded: %s', s);
  INSERT INTO transactions (branch_id, order_id, txn_type, method, status, amount, provider, provider_txn_id) VALUES (b1, o2, 'payment', 'whish_money', 'pending', 5, 'whish_money', 'W-1');
  PERFORM pg_temp.expect_error('23505', format($q$INSERT INTO transactions (branch_id, order_id, txn_type, method, amount, provider, provider_txn_id) VALUES (%L, %L, 'payment', 'whish_money', 5, 'whish_money', 'W-1')$q$, b1, o2));

  -- 7. sync metadata is server-controlled
  SELECT row_version, updated_at INTO ver, t1 FROM customers WHERE id = c1;
  PERFORM pg_sleep(0.01);
  UPDATE customers SET full_name = 'اسم جديد' WHERE id = c1;
  SELECT row_version, updated_at INTO ver2, t2 FROM customers WHERE id = c1;
  ASSERT ver2 = ver + 1 AND t2 > t1, 'row_version and updated_at bump on change';
  UPDATE customers SET full_name = 'اسم جديد' WHERE id = c1;
  SELECT row_version INTO ver FROM customers WHERE id = c1;
  ASSERT ver = ver2, 'no-op update must not bump row_version';
  UPDATE customers SET row_version = 999, updated_at = '2000-01-01' WHERE id = c1;
  SELECT row_version INTO ver FROM customers WHERE id = c1;
  ASSERT ver = ver2 + 1 AND (SELECT updated_at > '2020-01-01' FROM customers WHERE id = c1), 'clients cannot forge sync columns';

  -- 8. notifications: dedupe per branch, template email subject rule
  INSERT INTO notification_logs (branch_id, order_id, channel, locale, recipient, body, dedupe_key) VALUES (b1, o2, 'whatsapp', 'ar', '+96170000001', 'hi', 'order:o2:printing:whatsapp');
  PERFORM pg_temp.expect_error('23505', format($q$INSERT INTO notification_logs (branch_id, channel, locale, recipient, body, dedupe_key) VALUES (%L, 'whatsapp', 'ar', '+96170000001', 'hi', 'order:o2:printing:whatsapp')$q$, b1));
  INSERT INTO notification_logs (branch_id, channel, locale, recipient, body, dedupe_key) VALUES (b2, 'whatsapp', 'ar', '+96170000002', 'hi', 'order:o2:printing:whatsapp');
  PERFORM pg_temp.expect_error('23514', format($q$INSERT INTO notification_templates (branch_id, template_key, channel, locale, body) VALUES (%L, 'order.received', 'email', 'ar', 'x')$q$, b1));

  -- 9. order status history is append-only
  INSERT INTO order_status_history (branch_id, order_id, from_status, to_status, source) VALUES (b1, o2, 'received', 'printing', 'scanner');
  PERFORM pg_temp.expect_error('23001', format($q$DELETE FROM order_status_history WHERE order_id = %L$q$, o2));

  -- 10. staff need a login identifier
  PERFORM pg_temp.expect_error('23514', format($q$INSERT INTO users (branch_id, role_id, full_name) VALUES (%L, %L, 'No Login')$q$, b1, r));

  RAISE NOTICE 'ALL SMOKE TESTS PASSED';
END $$;

ROLLBACK;
