CREATE TYPE "client_purchase_order_status" AS ENUM ('draft', 'active', 'closed', 'cancelled');
CREATE TYPE "client_purchase_order_allocation_type" AS ENUM ('billable', 'client_invoice', 'change_order');

CREATE TABLE "client_purchase_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "client_company_id" uuid NOT NULL REFERENCES "crm_companies"("id") ON DELETE RESTRICT,
  "show_id" uuid REFERENCES "shows"("id") ON DELETE SET NULL,
  "episode_id" uuid REFERENCES "episodes"("id") ON DELETE SET NULL,
  "po_number" text NOT NULL,
  "currency" text NOT NULL,
  "approved_amount" numeric(14,2) NOT NULL CHECK ("approved_amount" > 0),
  "issue_date" date,
  "expiry_date" date,
  "status" "client_purchase_order_status" DEFAULT 'draft' NOT NULL,
  "notes" text,
  "external_document_url" text,
  "created_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_purchase_orders_dates_check" CHECK ("expiry_date" IS NULL OR "issue_date" IS NULL OR "expiry_date" >= "issue_date")
);

CREATE UNIQUE INDEX "client_purchase_orders_org_number_idx" ON "client_purchase_orders" ("organization_id", "po_number");
CREATE INDEX "client_purchase_orders_org_client_status_idx" ON "client_purchase_orders" ("organization_id", "client_company_id", "status");
CREATE INDEX "client_purchase_orders_org_show_episode_idx" ON "client_purchase_orders" ("organization_id", "show_id", "episode_id");
CREATE INDEX "client_purchase_orders_org_expiry_idx" ON "client_purchase_orders" ("organization_id", "expiry_date");

CREATE TABLE "client_purchase_order_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "client_purchase_order_id" uuid NOT NULL REFERENCES "client_purchase_orders"("id") ON DELETE CASCADE,
  "allocation_type" "client_purchase_order_allocation_type" NOT NULL,
  "billable_id" uuid REFERENCES "billables"("id") ON DELETE SET NULL,
  "client_invoice_id" uuid REFERENCES "client_invoices"("id") ON DELETE SET NULL,
  "change_order_reference" text,
  "amount" numeric(14,2) NOT NULL CHECK ("amount" > 0),
  "allocation_date" date NOT NULL,
  "reference" text,
  "description" text,
  "created_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_purchase_order_allocations_source_check" CHECK (
    ("allocation_type" = 'billable' AND "billable_id" IS NOT NULL AND "client_invoice_id" IS NULL AND "change_order_reference" IS NULL)
    OR ("allocation_type" = 'client_invoice' AND "billable_id" IS NULL AND "client_invoice_id" IS NOT NULL AND "change_order_reference" IS NULL)
    OR ("allocation_type" = 'change_order' AND "billable_id" IS NULL AND "client_invoice_id" IS NULL AND "change_order_reference" IS NOT NULL)
  )
);

CREATE INDEX "client_po_allocations_org_po_date_idx" ON "client_purchase_order_allocations" ("organization_id", "client_purchase_order_id", "allocation_date");
CREATE UNIQUE INDEX "client_po_allocations_po_billable_idx" ON "client_purchase_order_allocations" ("client_purchase_order_id", "billable_id");
CREATE UNIQUE INDEX "client_po_allocations_po_invoice_idx" ON "client_purchase_order_allocations" ("client_purchase_order_id", "client_invoice_id");
CREATE UNIQUE INDEX "client_po_allocations_po_change_order_idx" ON "client_purchase_order_allocations" ("client_purchase_order_id", "change_order_reference");
