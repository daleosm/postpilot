CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "person_id" uuid NOT NULL REFERENCES "people"("id") ON DELETE cascade, "activity_id" uuid REFERENCES "activity_log"("id") ON DELETE cascade,
  "title" text NOT NULL, "body" text NOT NULL, "read_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "notifications_person_unread_idx" ON "notifications" ("person_id", "read_at");
