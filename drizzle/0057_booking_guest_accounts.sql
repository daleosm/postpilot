ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "guest_person_id" uuid REFERENCES "people"("id") ON DELETE set null;
CREATE INDEX IF NOT EXISTS "bookings_guest_person_time_idx" ON "bookings" USING btree ("guest_person_id", "starts_at");
