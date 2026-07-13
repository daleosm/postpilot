ALTER TABLE "catering_requests" ADD COLUMN "actual_cost" numeric(12, 2);
ALTER TABLE "catering_requests" ADD COLUMN "currency" text DEFAULT 'GBP' NOT NULL;
ALTER TABLE "catering_requests" ADD COLUMN "receipt_reference" text;
ALTER TABLE "catering_requests" ADD COLUMN "billable_id" uuid REFERENCES "billables"("id") ON DELETE SET NULL;
ALTER TABLE "catering_requests" ADD COLUMN "budget_line_id" uuid REFERENCES "budget_lines"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "catering_requests_billable_idx" ON "catering_requests" USING btree ("billable_id");
CREATE UNIQUE INDEX "catering_requests_budget_line_idx" ON "catering_requests" USING btree ("budget_line_id");
