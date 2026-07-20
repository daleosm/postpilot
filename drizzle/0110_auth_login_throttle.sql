CREATE TABLE "auth_login_attempts" (
  "email" text PRIMARY KEY NOT NULL,
  "failed_attempts" integer DEFAULT 0 NOT NULL,
  "window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_login_attempts_locked_until_idx" ON "auth_login_attempts" USING btree ("locked_until");
