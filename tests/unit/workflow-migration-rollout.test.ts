import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(resolve(process.cwd(), "drizzle/0101_episode_workflow_legacy_review.sql"), "utf8");

test("workflow backfill infers progress only from a valid legacy stage pointer", () => {
  assert.match(migration, /WHEN valid_current_stage_id IS NULL THEN 'not_started'/);
  assert.match(migration, /WHEN stage_position < current_position THEN 'complete'/);
  assert.match(migration, /WHEN stage_id = valid_current_stage_id AND current_has_pending_approval THEN 'submitted'/);
  assert.match(migration, /WHEN stage_id = valid_current_stage_id THEN 'in_progress'/);
  assert.doesNotMatch(migration, /WHEN e\."status" = 'delivered' THEN 'complete'/);
});

test("workflow backfill creates tenant-scoped review records for ambiguous legacy rows", () => {
  assert.match(migration, /CREATE TABLE "episode_workflow_migration_reviews"/);
  assert.match(migration, /No default workflow exists for this tenant/);
  assert.match(migration, /Legacy workflow stage is empty; all tracks were left not started/);
  assert.match(migration, /Legacy workflow stage is not part of the tenant default workflow/);
  assert.match(migration, /Legacy episode status says delivered; verify the terminal workflow track/);
  assert.match(migration, /ON CONFLICT \("episode_id"\) DO NOTHING/);
});
