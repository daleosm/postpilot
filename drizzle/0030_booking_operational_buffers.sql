ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "setup_minutes" integer DEFAULT 0 NOT NULL;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "handover_minutes" integer DEFAULT 0 NOT NULL;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "strike_minutes" integer DEFAULT 0 NOT NULL;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_setup_minutes_nonnegative" CHECK ("setup_minutes" >= 0);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_handover_minutes_nonnegative" CHECK ("handover_minutes" >= 0);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_strike_minutes_nonnegative" CHECK ("strike_minutes" >= 0);
