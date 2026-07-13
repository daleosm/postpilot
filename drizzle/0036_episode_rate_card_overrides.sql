ALTER TABLE "rate_cards" ADD COLUMN "network" text;
ALTER TABLE "rate_cards" ADD COLUMN "episode_id" uuid REFERENCES "episodes"("id") ON DELETE CASCADE;
CREATE INDEX "rate_cards_org_network_idx" ON "rate_cards" USING btree ("organization_id", "network");
CREATE INDEX "rate_cards_org_episode_idx" ON "rate_cards" USING btree ("organization_id", "episode_id");

-- Existing client-level cards remain valid as the legacy client fallback.
