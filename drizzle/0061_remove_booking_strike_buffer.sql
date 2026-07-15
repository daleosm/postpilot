-- Custom SQL migration file, put your code below! --
-- Strike/reset is no longer a booking buffer. Actual time and overtime are
-- stored independently on the booking and are unaffected by this removal.
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_strike_minutes_nonnegative";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "strike_minutes";
