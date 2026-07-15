ALTER TABLE "workflow_stages" ADD COLUMN IF NOT EXISTS "requires_qc_pass" boolean DEFAULT false NOT NULL;

-- The former correction/re-QC stage was a linear modelling error. QC failures
-- remain within Quality control as a correction-and-retest loop instead.
UPDATE "workflow_stages" SET "requires_qc_pass" = true WHERE "key" = 'quality_control';

UPDATE "episodes" AS "episode"
SET "workflow_stage_id" = "quality_control"."id", "updated_at" = NOW()
FROM "workflow_stages" AS "corrections"
INNER JOIN "workflow_stages" AS "quality_control"
  ON "quality_control"."workflow_id" = "corrections"."workflow_id"
  AND "quality_control"."key" = 'quality_control'
WHERE "episode"."workflow_stage_id" = "corrections"."id"
  AND "corrections"."key" = 'corrections_re_qc';

UPDATE "post_work_orders" AS "work_order"
SET "workflow_stage_id" = "quality_control"."id", "updated_at" = NOW()
FROM "workflow_stages" AS "corrections"
INNER JOIN "workflow_stages" AS "quality_control"
  ON "quality_control"."workflow_id" = "corrections"."workflow_id"
  AND "quality_control"."key" = 'quality_control'
WHERE "work_order"."workflow_stage_id" = "corrections"."id"
  AND "corrections"."key" = 'corrections_re_qc';

-- Repack positions without colliding with the unique workflow position index.
UPDATE "workflow_stages" AS "stage"
SET "position" = "stage"."position" + 1000
FROM "workflow_stages" AS "corrections"
WHERE "stage"."workflow_id" = "corrections"."workflow_id"
  AND "stage"."position" > "corrections"."position"
  AND "corrections"."key" = 'corrections_re_qc';

DELETE FROM "workflow_stages" WHERE "key" = 'corrections_re_qc';

UPDATE "workflow_stages" SET "position" = "position" - 1001 WHERE "position" > 1000;
