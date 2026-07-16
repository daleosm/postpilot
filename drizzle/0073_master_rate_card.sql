-- One tenant-wide card supplies the inherited defaults for every network,
-- show and episode. More-specific cards remain ordinary scoped exceptions.
CREATE UNIQUE INDEX "rate_cards_master_organization_idx"
  ON "rate_cards" ("organization_id")
  WHERE "client_company_id" IS NULL
    AND "network" IS NULL
    AND "show_id" IS NULL
    AND "episode_id" IS NULL;
