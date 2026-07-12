ALTER TABLE "deliverables" DROP CONSTRAINT "deliverables_media_asset_id_media_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "review_cuts" DROP CONSTRAINT "review_cuts_media_asset_id_media_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "deliverables" DROP COLUMN "media_asset_id";--> statement-breakpoint
ALTER TABLE "review_cuts" DROP COLUMN "media_asset_id";--> statement-breakpoint
ALTER TABLE "review_cuts" DROP COLUMN "external_url";--> statement-breakpoint
ALTER TABLE "media_assets" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "media_assets";--> statement-breakpoint
DROP TYPE "public"."asset_kind";--> statement-breakpoint
DROP TYPE "public"."asset_status";
