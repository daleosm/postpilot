CREATE TABLE "show_team_assignments" (
	"show_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "show_team_assignments_show_id_person_id_pk" PRIMARY KEY("show_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "show_team_assignments" ADD CONSTRAINT "show_team_assignments_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_team_assignments" ADD CONSTRAINT "show_team_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "show_team_assignments_person_idx" ON "show_team_assignments" USING btree ("person_id");--> statement-breakpoint
INSERT INTO "show_team_assignments" ("show_id", "person_id")
SELECT DISTINCT "show_id", "person_id"
FROM (
  SELECT s."show_id", assignment."person_id"
  FROM "episodes" e
  INNER JOIN "seasons" s ON e."season_id" = s."id"
  CROSS JOIN LATERAL (VALUES
    (e."assigned_producer_id"),
    (e."editor_id"),
    (e."colorist_id"),
    (e."sound_mixer_id")
  ) AS assignment("person_id")
  WHERE assignment."person_id" IS NOT NULL
  UNION
  SELECT s."show_id", b."person_id"
  FROM "bookings" b
  INNER JOIN "episodes" e ON b."episode_id" = e."id"
  INNER JOIN "seasons" s ON e."season_id" = s."id"
  WHERE b."person_id" IS NOT NULL
) AS existing_assignments
ON CONFLICT DO NOTHING;
