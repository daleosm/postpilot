CREATE TYPE "purchase_order_status" AS ENUM ('draft', 'approved', 'closed', 'cancelled');
CREATE TYPE "purchase_order_allocation_type" AS ENUM ('work_order', 'budget_line', 'vendor_invoice');

CREATE TABLE "purchase_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "vendor_company_id" uuid NOT NULL REFERENCES "crm_companies"("id") ON DELETE RESTRICT,
  "show_id" uuid REFERENCES "shows"("id") ON DELETE SET NULL,
  "episode_id" uuid REFERENCES "episodes"("id") ON DELETE SET NULL,
  "po_number" text NOT NULL,
  "currency" text NOT NULL,
  "approved_amount" numeric(14,2) NOT NULL CHECK ("approved_amount" > 0),
  "issue_date" date,
  "expiry_date" date,
  "status" "purchase_order_status" DEFAULT 'draft' NOT NULL,
  "notes" text,
  "external_document_url" text,
  "created_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_orders_dates_check" CHECK ("expiry_date" IS NULL OR "issue_date" IS NULL OR "expiry_date" >= "issue_date")
);

CREATE UNIQUE INDEX "purchase_orders_org_number_idx" ON "purchase_orders" ("organization_id", "po_number");
CREATE INDEX "purchase_orders_org_vendor_status_idx" ON "purchase_orders" ("organization_id", "vendor_company_id", "status");
CREATE INDEX "purchase_orders_org_show_episode_idx" ON "purchase_orders" ("organization_id", "show_id", "episode_id");
CREATE INDEX "purchase_orders_org_expiry_idx" ON "purchase_orders" ("organization_id", "expiry_date");

CREATE TABLE "purchase_order_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "purchase_order_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
  "allocation_type" "purchase_order_allocation_type" NOT NULL,
  "work_order_id" uuid REFERENCES "post_work_orders"("id") ON DELETE SET NULL,
  "budget_line_id" uuid REFERENCES "budget_lines"("id") ON DELETE SET NULL,
  "vendor_invoice_id" uuid REFERENCES "vendor_invoices"("id") ON DELETE SET NULL,
  "amount" numeric(14,2) NOT NULL CHECK ("amount" > 0),
  "allocation_date" date NOT NULL,
  "reference" text,
  "description" text,
  "created_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_order_allocations_source_check" CHECK (
    ("allocation_type" = 'work_order' AND "work_order_id" IS NOT NULL AND "budget_line_id" IS NULL AND "vendor_invoice_id" IS NULL)
    OR ("allocation_type" = 'budget_line' AND "work_order_id" IS NULL AND "budget_line_id" IS NOT NULL AND "vendor_invoice_id" IS NULL)
    OR ("allocation_type" = 'vendor_invoice' AND "work_order_id" IS NULL AND "budget_line_id" IS NULL AND "vendor_invoice_id" IS NOT NULL)
  )
);

CREATE INDEX "purchase_order_allocations_org_po_date_idx" ON "purchase_order_allocations" ("organization_id", "purchase_order_id", "allocation_date");
CREATE UNIQUE INDEX "purchase_order_allocations_po_work_order_idx" ON "purchase_order_allocations" ("purchase_order_id", "work_order_id");
CREATE UNIQUE INDEX "purchase_order_allocations_po_budget_line_idx" ON "purchase_order_allocations" ("purchase_order_id", "budget_line_id");
CREATE UNIQUE INDEX "purchase_order_allocations_po_vendor_invoice_idx" ON "purchase_order_allocations" ("purchase_order_id", "vendor_invoice_id");
