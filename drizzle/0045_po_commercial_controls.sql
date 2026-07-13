CREATE TYPE "purchase_order_kind" AS ENUM ('vendor_commitment', 'client_authorisation');
CREATE TYPE "vendor_invoice_status" AS ENUM ('received', 'approved', 'paid', 'disputed', 'void');

ALTER TABLE "purchase_orders" ADD COLUMN "kind" "purchase_order_kind" DEFAULT 'vendor_commitment' NOT NULL;
ALTER TABLE "billables" ADD COLUMN "purchase_order_id" uuid REFERENCES "purchase_orders"("id") ON DELETE SET NULL;

CREATE TABLE "vendor_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "vendor_company_id" uuid NOT NULL REFERENCES "crm_companies"("id") ON DELETE restrict,
  "purchase_order_id" uuid REFERENCES "purchase_orders"("id") ON DELETE set null,
  "show_id" uuid REFERENCES "shows"("id") ON DELETE set null,
  "episode_id" uuid REFERENCES "episodes"("id") ON DELETE set null,
  "invoice_number" text NOT NULL,
  "description" text,
  "amount" numeric(14,2) NOT NULL,
  "currency" text DEFAULT 'GBP' NOT NULL,
  "status" "vendor_invoice_status" DEFAULT 'received' NOT NULL,
  "invoice_date" date,
  "due_date" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "vendor_invoices_org_number_idx" ON "vendor_invoices" ("organization_id", "vendor_company_id", "invoice_number");
CREATE INDEX "vendor_invoices_org_po_idx" ON "vendor_invoices" ("organization_id", "purchase_order_id");
CREATE INDEX "vendor_invoices_org_status_idx" ON "vendor_invoices" ("organization_id", "status");

ALTER TABLE "budget_lines" ADD COLUMN "vendor_invoice_id" uuid REFERENCES "vendor_invoices"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "budget_lines_vendor_invoice_id_idx" ON "budget_lines" ("vendor_invoice_id");
CREATE INDEX "budget_lines_organization_po_idx" ON "budget_lines" ("organization_id", "purchase_order_id");
CREATE INDEX "billables_organization_po_idx" ON "billables" ("organization_id", "purchase_order_id");
CREATE INDEX "purchase_orders_org_kind_status_idx" ON "purchase_orders" ("organization_id", "kind", "status");

CREATE TABLE "purchase_order_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "purchase_order_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE cascade,
  "actor_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "action" text NOT NULL,
  "amount" numeric(14,2),
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "purchase_order_events_org_po_created_idx" ON "purchase_order_events" ("organization_id", "purchase_order_id", "created_at");
