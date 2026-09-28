-- 0001_foundation.sql
-- Extensions + trigger helpers shared by every table.
--
-- Offline-first contract (see docs/DB-DESIGN.md):
--   * every syncable table carries created_at / updated_at / deleted_at / row_version
--   * updated_at and row_version are written ONLY by the server (sync_touch trigger)
--   * append-only ledgers (stock_movements, order_status_history) reject UPDATE/DELETE

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE FUNCTION sync_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.updated_at  := clock_timestamp();
    NEW.row_version := 1;
  ELSE
    IF NEW IS NOT DISTINCT FROM OLD THEN
      RETURN NEW;                                  -- no-op update: no sync noise
    END IF;
    NEW.created_at  := OLD.created_at;
    NEW.updated_at  := clock_timestamp();
    NEW.row_version := OLD.row_version + 1;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: table is append-only (write a compensating row instead)',
    TG_OP, TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;

CREATE PROCEDURE attach_sync_trigger(p_table regclass) LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER trg_sync_touch BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION sync_touch()',
    p_table);
END $$;

CREATE PROCEDURE attach_append_only(p_table regclass) LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER trg_append_only BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
    p_table);
END $$;
