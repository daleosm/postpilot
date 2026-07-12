CREATE TYPE "public"."catering_request_status" AS ENUM('requested', 'acknowledged', 'preparing', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."catering_request_type" AS ENUM('lunch', 'tea_coffee', 'snack');--> statement-breakpoint
ALTER TYPE "public"."person_role" ADD VALUE 'runner' BEFORE 'freelancer';--> statement-breakpoint
CREATE TABLE "catering_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"booking_id" uuid,
	"room_id" uuid,
	"requested_by_person_id" uuid,
	"fulfilled_by_person_id" uuid,
	"request_type" "catering_request_type" NOT NULL,
	"item" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"requested_for" timestamp with time zone,
	"status" "catering_request_status" DEFAULT 'requested' NOT NULL,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catering_requests" ADD CONSTRAINT "catering_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catering_requests" ADD CONSTRAINT "catering_requests_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catering_requests" ADD CONSTRAINT "catering_requests_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catering_requests" ADD CONSTRAINT "catering_requests_requested_by_person_id_people_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catering_requests" ADD CONSTRAINT "catering_requests_fulfilled_by_person_id_people_id_fk" FOREIGN KEY ("fulfilled_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catering_requests_organization_status_idx" ON "catering_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "catering_requests_booking_idx" ON "catering_requests" USING btree ("booking_id");