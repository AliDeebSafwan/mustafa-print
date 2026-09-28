-- 0020_drop_legacy_columns.sql : cleanup
--
-- customers.legacy_id/legacy_source, orders.legacy_id/legacy_source, and inventory_items.legacy_id/legacy_source
-- were prepared for importing data from a predecessor system. No such system exists, nothing in the application
-- ever read or wrote them, and no row in a real deployment has ever had them set — confirmed by searching the
-- whole codebase (server, shared package, both staff and customer apps) before writing this migration.

DROP INDEX customers_legacy_uq;
ALTER TABLE customers DROP COLUMN legacy_id;
ALTER TABLE customers DROP COLUMN legacy_source;

DROP INDEX orders_legacy_uq;
ALTER TABLE orders DROP COLUMN legacy_id;
ALTER TABLE orders DROP COLUMN legacy_source;

DROP INDEX inventory_items_legacy_uq;
ALTER TABLE inventory_items DROP COLUMN legacy_id;
ALTER TABLE inventory_items DROP COLUMN legacy_source;
