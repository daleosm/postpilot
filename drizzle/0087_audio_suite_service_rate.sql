-- Add the standard audio-post room rate to existing post houses without
-- overwriting any tenant's negotiated overrides.
INSERT INTO "service_rates" (
  "organization_id", "name", "category", "unit", "rate", "currency", "notes"
)
SELECT
  organization."id",
  'Audio suite',
  'Audio suite',
  'day',
  920.00,
  organization."currency",
  'Audio post suite for sound editorial, ADR, and mix preparation.'
FROM "organizations" AS organization
WHERE NOT EXISTS (
  SELECT 1
  FROM "service_rates" AS service_rate
  WHERE service_rate."organization_id" = organization."id"
    AND service_rate."name" = 'Audio suite'
);
--> statement-breakpoint
-- A master-card entry makes the new service inherit consistently through the
-- existing network, show, and episode override chain.
INSERT INTO "rate_card_items" (
  "organization_id", "rate_card_id", "service_rate_id", "category", "unit", "rate"
)
SELECT
  master_card."organization_id",
  master_card."id",
  audio_suite."id",
  audio_suite."category",
  audio_suite."unit",
  audio_suite."rate"
FROM "rate_cards" AS master_card
INNER JOIN "service_rates" AS audio_suite
  ON audio_suite."organization_id" = master_card."organization_id"
  AND audio_suite."name" = 'Audio suite'
WHERE master_card."client_company_id" IS NULL
  AND master_card."network" IS NULL
  AND master_card."show_id" IS NULL
  AND master_card."episode_id" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "rate_card_items" AS existing_item
    WHERE existing_item."rate_card_id" = master_card."id"
      AND existing_item."category" = audio_suite."category"
      AND existing_item."unit" = audio_suite."unit"
  );
