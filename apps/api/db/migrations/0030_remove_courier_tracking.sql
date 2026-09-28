-- 0030_remove_courier_tracking.sql : owner's decision (roadmap #22): delivery stays a fulfillment type — an order
-- can still be marked for delivery, with an address and a delivery fee — but the system never tracks WHICH person
-- is delivering it. There was no way to create a courier account from the team screen in the first place (1.15
-- limits it to admin/staff), so the whole assignment feature was unreachable dead weight.
--
-- Dropping the column takes its index and foreign key with it automatically.
ALTER TABLE orders DROP COLUMN delivery_user_id;

-- The role itself, if a database happens to have it seeded with no one actually holding it (true of every database
-- this project has touched so far, since the account could never be created through the app). Left alone, harmlessly,
-- if some user somehow does hold it — this migration removes dead configuration, not anyone's access.
DELETE FROM roles WHERE key = 'delivery' AND NOT EXISTS (SELECT 1 FROM users WHERE role_id = roles.id);
