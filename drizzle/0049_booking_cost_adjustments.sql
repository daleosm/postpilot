CREATE TABLE "booking_cost_adjustments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "amount" numeric(14, 2) NOT NULL,
  "currency" text NOT NULL,
  "note" text NOT NULL,
  "created_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "booking_cost_adjustments_org_booking_idx"
  ON "booking_cost_adjustments" USING btree ("organization_id", "booking_id");
