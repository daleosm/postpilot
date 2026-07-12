ALTER TYPE "public"."person_role" ADD VALUE 'online_editor' BEFORE 'colorist';--> statement-breakpoint
ALTER TYPE "public"."person_role" ADD VALUE 'supervising_sound_editor' BEFORE 'vfx_coordinator';--> statement-breakpoint
ALTER TYPE "public"."person_role" ADD VALUE 'rerecording_mixer' BEFORE 'vfx_coordinator';--> statement-breakpoint
ALTER TYPE "public"."person_role" ADD VALUE 'vfx_supervisor' BEFORE 'qc';--> statement-breakpoint
ALTER TYPE "public"."person_role" ADD VALUE 'network_client_executive' BEFORE 'client';--> statement-breakpoint
ALTER TYPE "public"."person_role" ADD VALUE 'network_client_representative' BEFORE 'client';--> statement-breakpoint
ALTER TABLE "people" ALTER COLUMN "role" SET DATA TYPE "public"."person_role" USING "role"::"public"."person_role";