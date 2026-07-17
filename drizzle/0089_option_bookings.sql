ALTER TABLE "bookings" ADD COLUMN "is_option" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "option_rank" integer;
--> statement-breakpoint
CREATE INDEX "bookings_option_resource_time_idx" ON "bookings" USING btree ("organization_id", "is_option", "room_id", "person_id", "starts_at");
