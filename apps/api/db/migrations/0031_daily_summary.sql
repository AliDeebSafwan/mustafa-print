-- 0031_daily_summary.sql : the owner's end-of-day email. Editable from the staff app (never a config file), so the
-- address or the hour can change any day without a developer. Off until an address is set.
ALTER TABLE branches ADD COLUMN summary_email text;
ALTER TABLE branches ADD COLUMN summary_hour smallint NOT NULL DEFAULT 21 CHECK (summary_hour BETWEEN 0 AND 23);   -- local hour, in the branch's timezone
-- The local date the summary last went out for. The worker claims a day by moving this forward in ONE statement,
-- so two workers (or a restart mid-tick) can never send the same day twice.
ALTER TABLE branches ADD COLUMN summary_last_date date;
