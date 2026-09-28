-- 0018_deposit_rule.sql : a deposit the shop may require before committing paper and time to a job
--
-- Off by default (deposit_percent = 0), matching every other business rule in this project: the owner turns it on
-- and sets the number, nothing is assumed. When set, it applies to every order unless a threshold is also set, in
-- which case only orders at or above that amount need a deposit — useful for a shop that only wants this friction
-- on its bigger jobs.

ALTER TABLE branches ADD COLUMN deposit_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (deposit_percent >= 0 AND deposit_percent <= 100);
ALTER TABLE branches ADD COLUMN deposit_threshold numeric(10,2) CHECK (deposit_threshold IS NULL OR deposit_threshold >= 0);
COMMENT ON COLUMN branches.deposit_percent IS 'Percent of an order''s total required as a deposit before it may move to printing. 0 = the rule is off.';
COMMENT ON COLUMN branches.deposit_threshold IS 'The deposit rule only applies to orders with total >= this amount. NULL means it applies to every order.';
