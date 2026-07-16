CREATE TYPE "public"."client_invoice_status" AS ENUM('issued', 'paid', 'void');

CREATE TABLE "invoice_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "legal_name" text,
  "legal_address" text,
  "billing_email" text,
  "tax_name" text DEFAULT 'VAT' NOT NULL,
  "tax_registration_number" text,
  "tax_rate_percent" numeric(7, 3) DEFAULT '0' NOT NULL,
  "payment_terms_days" integer DEFAULT 30 NOT NULL,
  "payment_instructions" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "invoice_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action
);
CREATE UNIQUE INDEX "invoice_settings_org_idx" ON "invoice_settings" USING btree ("organization_id");

CREATE TABLE "client_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "invoice_number" text NOT NULL,
  "client_company_id" uuid,
  "show_id" uuid,
  "episode_id" uuid,
  "status" "client_invoice_status" DEFAULT 'issued' NOT NULL,
  "invoice_date" date NOT NULL,
  "due_date" date NOT NULL,
  "currency" text NOT NULL,
  "subtotal_amount" numeric(14, 2) NOT NULL,
  "tax_name" text NOT NULL,
  "tax_rate_percent" numeric(7, 3) NOT NULL,
  "tax_amount" numeric(14, 2) NOT NULL,
  "total_amount" numeric(14, 2) NOT NULL,
  "issuer_name" text NOT NULL,
  "issuer_address" text,
  "issuer_email" text,
  "issuer_tax_registration_number" text,
  "client_name" text NOT NULL,
  "client_address" text,
  "client_email" text,
  "payment_instructions" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "client_invoices_client_company_id_crm_companies_id_fk" FOREIGN KEY ("client_company_id") REFERENCES "public"."crm_companies"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "client_invoices_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "client_invoices_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action
);
CREATE UNIQUE INDEX "client_invoices_org_sequence_idx" ON "client_invoices" USING btree ("organization_id", "sequence");
CREATE UNIQUE INDEX "client_invoices_org_number_idx" ON "client_invoices" USING btree ("organization_id", "invoice_number");
CREATE INDEX "client_invoices_org_episode_idx" ON "client_invoices" USING btree ("organization_id", "episode_id");
CREATE INDEX "client_invoices_org_client_idx" ON "client_invoices" USING btree ("organization_id", "client_company_id");

ALTER TABLE "billables" ADD COLUMN "client_invoice_id" uuid;
ALTER TABLE "billables" ADD CONSTRAINT "billables_client_invoice_id_client_invoices_id_fk" FOREIGN KEY ("client_invoice_id") REFERENCES "public"."client_invoices"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "billables_client_invoice_idx" ON "billables" USING btree ("client_invoice_id");

CREATE TABLE "client_invoice_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "client_invoice_id" uuid NOT NULL,
  "billable_id" uuid,
  "description" text NOT NULL,
  "reference" text,
  "quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
  "unit_amount" numeric(14, 2) NOT NULL,
  "amount" numeric(14, 2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_invoice_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "client_invoice_items_client_invoice_id_client_invoices_id_fk" FOREIGN KEY ("client_invoice_id") REFERENCES "public"."client_invoices"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "client_invoice_items_billable_id_billables_id_fk" FOREIGN KEY ("billable_id") REFERENCES "public"."billables"("id") ON DELETE set null ON UPDATE no action
);
CREATE INDEX "client_invoice_items_org_invoice_idx" ON "client_invoice_items" USING btree ("organization_id", "client_invoice_id");
CREATE UNIQUE INDEX "client_invoice_items_billable_idx" ON "client_invoice_items" USING btree ("billable_id");
