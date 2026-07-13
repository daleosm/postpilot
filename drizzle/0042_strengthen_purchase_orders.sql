ALTER TABLE "purchase_orders" ADD COLUMN "episode_id" uuid REFERENCES "episodes"("id") ON DELETE SET NULL;
ALTER TABLE "purchase_orders" ADD COLUMN "consumed_amount" numeric(12, 2) DEFAULT '0' NOT NULL;
ALTER TABLE "purchase_orders" ADD COLUMN "expires_at" date;
CREATE INDEX "purchase_orders_org_episode_idx" ON "purchase_orders" USING btree ("organization_id", "episode_id");
