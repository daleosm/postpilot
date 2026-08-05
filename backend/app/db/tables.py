# ruff: noqa: E501
"""SQLAlchemy Core definitions for the live PostPilot database contract.

The existing 54-table PostgreSQL schema remains unchanged during the cutover.
These foundational tables are explicit because every FastAPI request needs to
authenticate, resolve its active tenant, and enforce capability policies before
loading operational records. Feature modules add their own narrow table maps.
"""

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    Numeric,
    String,
    Table,
    Text,
    TypeDecorator,
    UniqueConstraint,
    cast,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, ENUM, UUID
from sqlalchemy.sql import func

metadata = MetaData()


class ExistingPostgresEnum(TypeDecorator):
    """Bind strings as an existing PostgreSQL enum without owning its DDL.

    The schema is migrated by Alembic from the historical SQL snapshot.  Core
    table maps must still declare native enum columns so asyncpg casts bound
    values correctly rather than sending them as unconstrained VARCHAR values.
    Results deliberately stay plain strings: tenant-customizable policies mean
    the Python map must not impose a stale in-process enum member list.
    """

    impl = Text
    cache_ok = True

    def __init__(self, name: str) -> None:
        self.enum_name = name
        super().__init__()

    def bind_expression(self, bindvalue):
        return cast(bindvalue, ENUM(name=self.enum_name, create_type=False))


def existing_postgres_enum(name: str) -> ExistingPostgresEnum:
    return ExistingPostgresEnum(name)


users = Table(
    "users",
    metadata,
    Column("id", Text, primary_key=True),
    Column("name", Text),
    Column("email", Text, nullable=False),
    Column("password_hash", Text),
    Column("email_verified", DateTime(timezone=True)),
)

auth_login_attempts = Table(
    "auth_login_attempts",
    metadata,
    Column("email", Text, primary_key=True),
    Column("failed_attempts", Integer, nullable=False),
    Column("window_started_at", DateTime(timezone=True), nullable=False),
    Column("last_attempt_at", DateTime(timezone=True), nullable=False),
    Column("locked_until", DateTime(timezone=True)),
)

organizations = Table(
    "organizations",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("name", Text, nullable=False),
    Column("slug", Text, nullable=False),
    Column("currency", Text, nullable=False),
    # A tenant operational default, used only when a work order snapshots a
    # time-block basis for client overtime.  Existing bookings retain their
    # real start/end times and are not silently rescaled.
    Column("standard_day_hours", Numeric(5, 2), nullable=False),
    # The default client and internal overtime uplift.  It is copied to a
    # confirmed booking/work-order snapshot so later policy changes cannot
    # revise agreed or invoiced history.
    Column("overtime_multiplier", Numeric(6, 3), nullable=False, server_default="1.500"),
)

# SSO connections are configured per post house.  They deliberately do not
# participate in session resolution yet: the Microsoft token-verification and
# account-linking steps will use this contract without changing local users,
# passwords, or organization memberships.
sso_connections = Table(
    "sso_connections",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("provider", Text, nullable=False, server_default="microsoft_entra"),
    Column("entra_tenant_id", UUID(as_uuid=False), nullable=False),
    Column("enabled", Boolean, nullable=False, server_default="false"),
    Column("allowed_email_domains", ARRAY(Text)),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    CheckConstraint("provider = 'microsoft_entra'", name="sso_connections_provider_check"),
    UniqueConstraint("organization_id", "provider", name="sso_connections_organization_provider_unique"),
)

# A linked external identity belongs to one global PostPilot user, rather than
# to a tenant.  That lets the same verified Microsoft identity sign into more
# than one organization through its normal organization memberships.
external_identities = Table(
    "external_identities",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()),
    Column("user_id", Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("provider", Text, nullable=False, server_default="microsoft_entra"),
    Column("issuer", Text, nullable=False),
    Column("entra_tenant_id", UUID(as_uuid=False), nullable=False),
    Column("entra_object_id", UUID(as_uuid=False), nullable=False),
    Column("subject", Text, nullable=False),
    Column("verified_email", Text),
    Column("linked_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("last_used_at", DateTime(timezone=True)),
    CheckConstraint("provider = 'microsoft_entra'", name="external_identities_provider_check"),
    UniqueConstraint("provider", "issuer", "subject", name="external_identities_provider_issuer_subject_unique"),
    UniqueConstraint(
        "provider",
        "entra_tenant_id",
        "entra_object_id",
        name="external_identities_provider_entra_object_unique",
    ),
)

organization_members = Table(
    "organization_members",
    metadata,
    Column(
        "organization_id",
        UUID(as_uuid=False),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("user_id", Text, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role", existing_postgres_enum("organization_role"), nullable=False),
    Column("joined_at", DateTime(timezone=True)),
)

people = Table(
    "people",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("name", Text, nullable=False),
    Column("email", Text),
    Column("role", Text, nullable=False),
    Column("company", Text),
    Column("is_active", Boolean, nullable=False, server_default="true"),
    Column("is_freelancer", Boolean, nullable=False, server_default="false"),
    Column("availability", existing_postgres_enum("availability_status"), nullable=False, server_default="available"),
    Column("hourly_rate", Numeric(14, 2)),
    Column("day_rate", Numeric(14, 2)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
    CheckConstraint(
        "(hourly_rate IS NULL OR hourly_rate >= 0) AND (day_rate IS NULL OR day_rate >= 0)",
        name="people_rates_non_negative_check",
    ),
)

organization_role_policies = Table(
    "organization_role_policies",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("role", Text, nullable=False),
    Column("label", Text, nullable=False),
    Column("permissions", JSON, nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

# Core production records map the existing PostgreSQL contract. FastAPI owns
# every live read and mutation; these are table maps, not a second schema.
shows = Table(
    "shows",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("title", Text, nullable=False),
    Column("code", Text, nullable=False),
    Column("network", Text),
    Column("production_company", Text),
    Column("client_company_id", UUID(as_uuid=False)),
    Column("production_company_id", UUID(as_uuid=False)),
    Column("delivery_profile_id", UUID(as_uuid=False)),
    Column("description", Text),
    Column("time_zone", Text, nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

seasons = Table(
    "seasons",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("show_id", UUID(as_uuid=False), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False),
    Column("number", Integer, nullable=False),
    Column("title", Text),
    Column("start_date", Date),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

post_workflows = Table(
    "post_workflows",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("show_id", UUID(as_uuid=False)),
    Column("name", Text, nullable=False),
    Column("description", Text),
    Column("is_default", Boolean, nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

workflow_stages = Table(
    "workflow_stages",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("workflow_id", UUID(as_uuid=False), ForeignKey("post_workflows.id", ondelete="CASCADE"), nullable=False),
    Column("name", Text, nullable=False),
    Column("key", Text, nullable=False),
    Column("position", Integer, nullable=False),
    Column("color", Text, nullable=False),
    Column("is_terminal", Boolean, nullable=False),
    Column("can_start_early", Boolean, nullable=False),
    Column("requires_qc_pass", Boolean, nullable=False),
    Column("delivery_gate", existing_postgres_enum("delivery_workflow_gate"), nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

workflow_stage_approval_rules = Table(
    "workflow_stage_approval_rules",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column(
        "workflow_stage_id", UUID(as_uuid=False), ForeignKey("workflow_stages.id", ondelete="CASCADE"), nullable=False
    ),
    Column("approver_role", Text),
    Column("label", Text, nullable=False),
    Column("approval_order", Integer, nullable=False),
    Column("is_required", Boolean, nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

workflow_stage_work_order_templates = Table(
    "workflow_stage_work_order_templates",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column(
        "workflow_stage_id", UUID(as_uuid=False), ForeignKey("workflow_stages.id", ondelete="CASCADE"), nullable=False
    ),
    Column("title", Text, nullable=False),
    Column("description", Text),
    Column("department", Text),
    Column("assignee_role", Text),
    Column("priority", existing_postgres_enum("work_order_priority"), nullable=False),
    Column("is_blocking", Boolean, nullable=False),
    Column("position", Integer, nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

episodes = Table(
    "episodes",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("season_id", UUID(as_uuid=False), ForeignKey("seasons.id", ondelete="CASCADE"), nullable=False),
    Column("workflow_stage_id", UUID(as_uuid=False), ForeignKey("workflow_stages.id", ondelete="SET NULL")),
    Column("workflow_status", existing_postgres_enum("episode_workflow_status"), nullable=False),
    Column("assigned_producer_id", UUID(as_uuid=False)),
    Column("editor_id", UUID(as_uuid=False)),
    Column("colorist_id", UUID(as_uuid=False)),
    Column("sound_mixer_id", UUID(as_uuid=False)),
    Column("number", Integer, nullable=False),
    Column("production_code", Text),
    Column("title", Text, nullable=False),
    Column("synopsis", Text),
    # Retained only as the legacy compatibility value. The current workflow
    # stage and workflow_status are the operational source of truth.
    Column("status", existing_postgres_enum("episode_status"), nullable=False),
    Column("qc_status", existing_postgres_enum("qc_status"), nullable=False),
    Column("air_date", Date),
    Column("locked_cut_date", Date),
    Column("delivery_deadline", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

episode_team_assignments = Table(
    "episode_team_assignments",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("episode_id", UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
    Column("person_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="CASCADE"), nullable=False),
    Column("is_lead", Boolean, nullable=False),
    Column("starts_on", Date),
    Column("ends_on", Date),
)

episode_workflow_approvals = Table(
    "episode_workflow_approvals",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("episode_id", UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
    Column(
        "workflow_stage_id", UUID(as_uuid=False), ForeignKey("workflow_stages.id", ondelete="CASCADE"), nullable=False
    ),
    Column(
        "approval_rule_id",
        UUID(as_uuid=False),
        ForeignKey("workflow_stage_approval_rules.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("approver_role", Text),
    Column("required_person_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="SET NULL")),
    Column("approver_person_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="SET NULL")),
    Column("status", existing_postgres_enum("approval_status"), nullable=False),
    Column("comment", Text),
    Column("submitted_at", DateTime(timezone=True)),
    Column("responded_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

episode_workflow_signers = Table(
    "episode_workflow_signers",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("episode_id", UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
    Column(
        "workflow_stage_approval_rule_id",
        UUID(as_uuid=False),
        ForeignKey("workflow_stage_approval_rules.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("person_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="RESTRICT"), nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

episode_workflow_exceptions = Table(
    "episode_workflow_exceptions",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("episode_id", UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
    Column(
        "workflow_stage_id", UUID(as_uuid=False), ForeignKey("workflow_stages.id", ondelete="CASCADE"), nullable=False
    ),
    Column("type", existing_postgres_enum("workflow_exception_type"), nullable=False),
    Column("reason", Text, nullable=False),
    Column("authorized_by_user_id", Text, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
    Column("created_at", DateTime(timezone=True)),
)

activity_log = Table(
    "activity_log",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("actor_user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("action", Text, nullable=False),
    Column("entity_type", Text, nullable=False),
    Column("entity_id", Text, nullable=False),
    Column("metadata", JSON, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

crm_companies = Table(
    "crm_companies",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("name", Text, nullable=False),
    Column("type", existing_postgres_enum("crm_company_type"), nullable=False),
    Column("address", Text),
    Column("service_category", Text),
    Column("is_preferred_supplier", Boolean, nullable=False),
    Column("payment_terms_days", Integer),
    Column("currency", Text, nullable=False),
    Column("finance_email", Text),
    Column("billing_email", Text),
    Column("account_status", existing_postgres_enum("crm_account_status"), nullable=False),
    Column("booking_clearance", existing_postgres_enum("crm_booking_clearance"), nullable=False),
    Column("account_owner_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="SET NULL")),
    Column("next_action", Text),
    Column("next_action_due_at", Date),
    Column("notes", Text),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

# Invoice configuration belongs to the tenant's legal entity.  Invoices copy
# the values at issue time, so later settings edits cannot alter a document
# that has already been issued.
invoice_settings = Table(
    "invoice_settings",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("legal_name", Text),
    Column("legal_address", Text),
    Column("billing_email", Text),
    Column("tax_enabled", Boolean, nullable=False),
    Column("tax_name", Text, nullable=False),
    Column("tax_registration_number", Text),
    Column("tax_rate_percent", Numeric(7, 3), nullable=False),
    Column("payment_terms_days", Integer, nullable=False),
    Column("payment_instructions", Text),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

crm_contacts = Table(
    "crm_contacts",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("company_id", UUID(as_uuid=False), ForeignKey("crm_companies.id", ondelete="CASCADE"), nullable=False),
    Column("name", Text, nullable=False),
    Column("title", Text),
    Column("email", Text),
    Column("phone", Text),
    Column("contact_type", existing_postgres_enum("crm_contact_type")),
    Column("is_primary", Boolean, nullable=False),
    Column("notes", Text),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

show_contacts = Table(
    "show_contacts",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("show_id", UUID(as_uuid=False), ForeignKey("shows.id", ondelete="CASCADE"), nullable=False),
    Column("contact_id", UUID(as_uuid=False), ForeignKey("crm_contacts.id", ondelete="CASCADE"), nullable=False),
    Column("responsibility", existing_postgres_enum("show_contact_responsibility"), nullable=False),
    Column("relationship", Text, nullable=False),
    Column("is_approval_contact", Boolean, nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

# Read-only mapping used by the production overview.  FastAPI derives show
# budget health from the live ledger rather than accepting a browser-calculated
# percentage.  Commercial figures are only returned to actors with the
# corresponding capability.
budget_lines = Table(
    "budget_lines",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("show_id", UUID(as_uuid=False), ForeignKey("shows.id", ondelete="SET NULL")),
    Column("season_id", UUID(as_uuid=False)),
    Column("episode_id", UUID(as_uuid=False)),
    Column("work_order_id", UUID(as_uuid=False)),
    Column("vendor_invoice_id", UUID(as_uuid=False)),
    Column("purchase_order_id", UUID(as_uuid=False)),
    Column("external_cost", Boolean, nullable=False),
    Column("code", Text),
    Column("category", Text, nullable=False),
    Column("description", Text),
    Column("budgeted_amount", Numeric(14, 2), nullable=False),
    # Planned estimate inputs are retained alongside the monetary snapshot so
    # an episode budget can explain where every estimate came from.
    Column("planned_quantity", Numeric(12, 2)),
    Column("planned_unit", Text),
    Column("rate_snapshot", Numeric(14, 2)),
    Column("rate_source", Text),
    Column("resource_reference", Text),
    Column("estimate_status", Text, nullable=False, server_default=text("'legacy'")),
    Column("manual_override_reason", Text),
    # Compatibility cache maintained exclusively by the allocation trigger.
    # API clients never write it directly.
    Column("actual_amount", Numeric(14, 2), nullable=False),
    Column("currency", Text, nullable=False),
    Column("cost_type", existing_postgres_enum("cost_type"), nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
    CheckConstraint(
        "budgeted_amount >= 0 AND actual_amount >= 0 AND (planned_quantity IS NULL OR planned_quantity >= 0) AND (rate_snapshot IS NULL OR rate_snapshot >= 0)",
        name="budget_lines_non_negative_money_check",
    ),
)

budget_actual_allocations = Table(
    "budget_actual_allocations",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("budget_line_id", UUID(as_uuid=False), ForeignKey("budget_lines.id", ondelete="CASCADE"), nullable=False),
    Column("source_type", Text, nullable=False),
    # A confirmed time submission belongs to its booking in the current model.
    Column("booking_id", UUID(as_uuid=False), ForeignKey("bookings.id", ondelete="SET NULL")),
    Column("work_order_id", UUID(as_uuid=False), ForeignKey("post_work_orders.id", ondelete="SET NULL")),
    Column("vendor_invoice_id", UUID(as_uuid=False), ForeignKey("vendor_invoices.id", ondelete="SET NULL")),
    Column("manual_adjustment_reason", Text),
    Column("source_reference", Text),
    Column("amount", Numeric(14, 2), nullable=False),
    Column("currency", Text, nullable=False),
    Column("allocation_date", Date, nullable=False),
    Column("created_by_user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

# An approved episode estimate is an immutable snapshot of the plan at that
# point in time. Current budget_lines remain the editable working ledger only
# while an estimate revision is open.
episode_budget_estimates = Table(
    "episode_budget_estimates",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("episode_id", UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
    Column("revision_number", Integer, nullable=False),
    Column("name", Text, nullable=False),
    Column("reason", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("approved_amount", Numeric(14, 2)),
    Column("created_by_user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("approved_by_user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("approved_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

episode_budget_estimate_items = Table(
    "episode_budget_estimate_items",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column(
        "estimate_id",
        UUID(as_uuid=False),
        ForeignKey("episode_budget_estimates.id", ondelete="CASCADE"),
        nullable=False,
    ),
    # Deliberately not an FK: a later revision can remove a working budget
    # line without making an approved historical estimate disappear.
    Column("source_budget_line_id", UUID(as_uuid=False)),
    Column("category", Text, nullable=False),
    Column("description", Text),
    Column("external_cost", Boolean, nullable=False),
    Column("planned_amount", Numeric(14, 2), nullable=False),
    Column("currency", Text, nullable=False),
    Column("created_at", DateTime(timezone=True)),
)

rooms = Table(
    "rooms",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("name", Text, nullable=False),
    Column("type", Text, nullable=False),
    Column("location", Text),
    Column("capacity", Integer),
    Column("notes", Text),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

catering_settings = Table(
    "catering_settings",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("markup_percent", Numeric(7, 2), nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

catering_requests = Table(
    "catering_requests",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("booking_id", UUID(as_uuid=False), ForeignKey("bookings.id", ondelete="SET NULL")),
    Column("work_order_id", UUID(as_uuid=False), ForeignKey("post_work_orders.id", ondelete="SET NULL")),
    Column("room_id", UUID(as_uuid=False), ForeignKey("rooms.id", ondelete="SET NULL")),
    Column("requested_by_person_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="SET NULL")),
    Column("fulfilled_by_person_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="SET NULL")),
    Column("request_type", existing_postgres_enum("catering_request_type"), nullable=False),
    Column("item", Text, nullable=False),
    Column("quantity", Integer, nullable=False),
    Column("notes", Text),
    Column("requested_for", DateTime(timezone=True)),
    Column("status", existing_postgres_enum("catering_request_status"), nullable=False),
    Column("fulfilled_at", DateTime(timezone=True)),
    Column("actual_cost", Numeric(14, 2)),
    Column("billed_amount", Numeric(14, 2)),
    Column("markup_percent", Numeric(7, 2)),
    Column("currency", Text, nullable=False),
    Column("receipt_reference", Text),
    Column("billable_id", UUID(as_uuid=False)),
    Column("budget_line_id", UUID(as_uuid=False)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
    CheckConstraint(
        "quantity > 0 AND (actual_cost IS NULL OR actual_cost >= 0) AND (billed_amount IS NULL OR billed_amount >= 0) AND (markup_percent IS NULL OR markup_percent >= 0)",
        name="catering_requests_financial_non_negative_check",
    ),
)

# Rate cards are the facility's live commercial price source. A card item can
# target a generic service, one room, or one named person. The target is
# explicit so a named artist is never silently added to every rate card.
service_rates = Table(
    "service_rates",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("name", Text, nullable=False),
    Column("category", Text, nullable=False),
    # When set, this generic rate is the default commercial price for every
    # active person with the matching tenant-configured operational role.
    Column("artist_role", Text),
    Column("unit", Text, nullable=False),
    Column("rate", Numeric(14, 2), nullable=False),
    Column("currency", Text, nullable=False),
    Column("notes", Text),
    Column("is_active", Boolean, nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
    CheckConstraint("rate >= 0", name="service_rates_rate_non_negative_check"),
)

rate_cards = Table(
    "rate_cards",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("client_company_id", UUID(as_uuid=False)),
    Column("network", Text),
    Column("show_id", UUID(as_uuid=False)),
    Column("episode_id", UUID(as_uuid=False)),
    Column("name", Text, nullable=False),
    Column("currency", Text, nullable=False),
    Column("effective_from", Date),
    Column("effective_to", Date),
    Column("is_active", Boolean, nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

rate_card_items = Table(
    "rate_card_items",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("rate_card_id", UUID(as_uuid=False), ForeignKey("rate_cards.id", ondelete="CASCADE"), nullable=False),
    Column("service_rate_id", UUID(as_uuid=False)),
    Column("target_type", String(16), nullable=False, server_default="service"),
    Column("room_id", UUID(as_uuid=False), ForeignKey("rooms.id", ondelete="CASCADE")),
    Column("person_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="CASCADE")),
    Column("category", Text, nullable=False),
    # Copied from the linked catalogue service so a scoped card can resolve an
    # artist-role default without depending on mutable presentation labels.
    Column("artist_role", Text),
    Column("unit", Text, nullable=False),
    Column("rate", Numeric(14, 2), nullable=False),
    Column("internal_cost_rate", Numeric(14, 2)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
    CheckConstraint("rate >= 0", name="rate_card_items_rate_non_negative_check"),
    CheckConstraint(
        "internal_cost_rate IS NULL OR internal_cost_rate >= 0",
        name="rate_card_items_internal_cost_rate_non_negative_check",
    ),
    CheckConstraint(
        "(target_type = 'service' AND room_id IS NULL AND person_id IS NULL) "
        "OR (target_type = 'room' AND room_id IS NOT NULL AND person_id IS NULL AND service_rate_id IS NULL) "
        "OR (target_type = 'person' AND person_id IS NOT NULL AND room_id IS NULL AND service_rate_id IS NULL)",
        name="rate_card_items_target_check",
    ),
)

bookings = Table(
    "bookings",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("room_id", UUID(as_uuid=False), ForeignKey("rooms.id", ondelete="SET NULL")),
    Column("episode_id", UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="SET NULL")),
    Column("budget_line_id", UUID(as_uuid=False), ForeignKey("budget_lines.id", ondelete="SET NULL")),
    Column("person_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="SET NULL")),
    Column("guest_person_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="SET NULL")),
    Column("title", Text, nullable=False),
    Column("starts_at", DateTime(timezone=True), nullable=False),
    Column("ends_at", DateTime(timezone=True), nullable=False),
    Column("setup_minutes", Integer, nullable=False),
    Column("handover_minutes", Integer, nullable=False),
    Column("actual_starts_at", DateTime(timezone=True)),
    Column("actual_ends_at", DateTime(timezone=True)),
    Column("approved_overtime_minutes", Integer, nullable=False),
    # A migration-owned attention flag. It is set only when a historical
    # confirmed booking has no complete saved room/person commercial snapshot;
    # it never invents a rate from a current catalogue or person record.
    Column("commercial_review_required", Boolean, nullable=False),
    Column("commercial_review_reason", Text),
    Column("commercial_review_marked_at", DateTime(timezone=True)),
    Column("is_option", Boolean, nullable=False),
    Column("option_rank", Integer),
    Column("status", existing_postgres_enum("booking_status"), nullable=False),
    Column("booking_type", existing_postgres_enum("booking_type"), nullable=False),
    Column("notes", Text),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

# A confirmed reservation has an agreed commercial snapshot for each resource
# it uses.  This stays separate from a budget estimate: scheduling must remain
# possible before an episode estimate has been built.
booking_charge_components = Table(
    "booking_charge_components",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("booking_id", UUID(as_uuid=False), ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False),
    Column("component_type", Text, nullable=False),
    Column("room_id", UUID(as_uuid=False), ForeignKey("rooms.id", ondelete="SET NULL")),
    Column("person_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="SET NULL")),
    Column("resource_name", Text, nullable=False),
    Column("category", Text, nullable=False),
    Column("billing_unit", Text, nullable=False),
    Column("client_rate", Numeric(14, 2), nullable=False),
    Column("internal_cost_rate", Numeric(14, 2)),
    Column("currency", Text, nullable=False),
    Column("rate_source", Text, nullable=False),
    Column("rate_card_scope", Text, nullable=False),
    Column("rate_card_id", UUID(as_uuid=False), ForeignKey("rate_cards.id", ondelete="SET NULL")),
    Column("rate_card_item_id", UUID(as_uuid=False), ForeignKey("rate_card_items.id", ondelete="SET NULL")),
    Column("is_negotiated_override", Boolean, nullable=False),
    Column("override_reason", Text),
    Column("overridden_by_user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("overridden_at", DateTime(timezone=True)),
    Column("estimated_quantity", Numeric(14, 2), nullable=False),
    Column("estimated_amount", Numeric(14, 2), nullable=False),
    # These are derived only when approved actual time is submitted. They are
    # retained beside the immutable agreed rate snapshot so a later rate-card
    # change cannot rewrite a historical charge.
    Column("actual_quantity", Numeric(14, 6)),
    Column("actual_overtime_quantity", Numeric(14, 6), nullable=False),
    Column("actual_client_amount", Numeric(14, 2)),
    Column("actual_internal_amount", Numeric(14, 2)),
    Column("overtime_multiplier", Numeric(6, 3), nullable=False),
    Column("actual_submitted_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
    CheckConstraint("component_type IN ('room', 'person')", name="booking_charge_components_type_check"),
    CheckConstraint("client_rate >= 0", name="booking_charge_components_client_rate_non_negative_check"),
    CheckConstraint(
        "internal_cost_rate IS NULL OR internal_cost_rate >= 0",
        name="booking_charge_components_internal_rate_non_negative_check",
    ),
    CheckConstraint("estimated_quantity >= 0", name="booking_charge_components_quantity_non_negative_check"),
    CheckConstraint("estimated_amount >= 0", name="booking_charge_components_amount_non_negative_check"),
    CheckConstraint("actual_quantity IS NULL OR actual_quantity >= 0", name="booking_charge_components_actual_quantity_non_negative_check"),
    CheckConstraint("actual_overtime_quantity >= 0", name="booking_charge_components_actual_overtime_non_negative_check"),
    CheckConstraint("actual_client_amount IS NULL OR actual_client_amount >= 0", name="booking_charge_components_actual_client_non_negative_check"),
    CheckConstraint("actual_internal_amount IS NULL OR actual_internal_amount >= 0", name="booking_charge_components_actual_internal_non_negative_check"),
    CheckConstraint("overtime_multiplier >= 1", name="booking_charge_components_overtime_multiplier_check"),
    CheckConstraint(
        "(is_negotiated_override IS FALSE AND override_reason IS NULL) "
        "OR (is_negotiated_override IS TRUE AND override_reason IS NOT NULL)",
        name="booking_charge_components_override_reason_check",
    ),
    CheckConstraint(
        "(component_type = 'room' AND room_id IS NOT NULL AND person_id IS NULL) "
        "OR (component_type = 'person' AND person_id IS NOT NULL AND room_id IS NULL)",
        name="booking_charge_components_resource_check",
    ),
    UniqueConstraint("booking_id", "component_type", name="booking_charge_components_booking_type_unique"),
)

# An explicit commercial decision is required before a booking component can
# enter an invoice. This is deliberately not inferred from scheduling status.
booking_component_invoice_selections = Table(
    "booking_component_invoice_selections",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column(
        "booking_charge_component_id",
        UUID(as_uuid=False),
        ForeignKey("booking_charge_components.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("include_in_invoice", Boolean, nullable=False),
    Column("reason", Text),
    Column("selected_by_user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("selected_at", DateTime(timezone=True), nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
    CheckConstraint(
        "include_in_invoice IS TRUE OR reason IS NOT NULL",
        name="booking_component_invoice_selection_reason_check",
    ),
    UniqueConstraint(
        "booking_charge_component_id",
        name="booking_component_invoice_selections_component_unique",
    ),
)

delivery_profiles = Table(
    "delivery_profiles",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("client_company_id", UUID(as_uuid=False)),
    Column("network", Text),
    Column("show_id", UUID(as_uuid=False)),
    Column("name", Text, nullable=False),
    Column("specification_url", Text),
    Column("is_active", Boolean, nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

delivery_profile_items = Table(
    "delivery_profile_items",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column(
        "delivery_profile_id",
        UUID(as_uuid=False),
        ForeignKey("delivery_profiles.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("component_type", Text, nullable=False),
    Column("label", Text, nullable=False),
    Column("required", Boolean, nullable=False),
    Column("format_specification", Text),
    Column("version", Text),
    Column("territory", Text),
    Column("language", Text),
    Column("recipient_contact_id", UUID(as_uuid=False)),
    Column("requires_external_recipient", Boolean, nullable=False),
    Column("qc_required", Boolean, nullable=False),
    Column("default_deadline_offset_days", Integer),
    Column("position", Integer, nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

episode_delivery_manifests = Table(
    "episode_delivery_manifests",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("episode_id", UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
    Column("delivery_profile_id", UUID(as_uuid=False)),
    Column("profile_name", Text, nullable=False),
    Column("specification_url", Text),
    Column("applied_by_user_id", Text),
    Column("applied_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

episode_delivery_manifest_shares = Table(
    "episode_delivery_manifest_shares",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column(
        "episode_delivery_manifest_id",
        UUID(as_uuid=False),
        ForeignKey("episode_delivery_manifests.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("person_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="CASCADE"), nullable=False),
    Column("shared_by_user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

episode_delivery_items = Table(
    "episode_delivery_items",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column(
        "episode_delivery_manifest_id",
        UUID(as_uuid=False),
        ForeignKey("episode_delivery_manifests.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("episode_id", UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
    Column("delivery_profile_item_id", UUID(as_uuid=False)),
    Column("component_type", Text, nullable=False),
    Column("label", Text, nullable=False),
    Column("required", Boolean, nullable=False),
    Column("format_specification", Text),
    Column("version", Text),
    Column("territory", Text),
    Column("language", Text),
    Column("recipient_contact_id", UUID(as_uuid=False)),
    Column("recipient_name", Text),
    Column("recipient_email", Text),
    Column("requires_external_recipient", Boolean, nullable=False),
    Column("qc_required", Boolean, nullable=False),
    Column("status", existing_postgres_enum("delivery_item_status"), nullable=False),
    Column("due_date", Date),
    Column("external_url", Text),
    Column("external_reference", Text),
    Column("is_externally_shared", Boolean, nullable=False),
    Column("submission_method", Text),
    Column("submitted_by_person_id", UUID(as_uuid=False)),
    Column("submitted_at", DateTime(timezone=True)),
    Column("qc_result", existing_postgres_enum("delivery_qc_result"), nullable=False),
    Column("recipient_snapshot_at", DateTime(timezone=True)),
    Column("receipt_confirmed_at", DateTime(timezone=True)),
    Column("receipt_confirmed_by", Text),
    Column("rejection_reason", Text),
    Column("waiver_reason", Text),
    Column("position", Integer, nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

# A controlled local substitute for recipient confirmation.  This remains a
# separate tenant-owned audit record rather than a mutable flag on an episode
# or workflow stage.
episode_delivery_acceptance_exceptions = Table(
    "episode_delivery_acceptance_exceptions",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("episode_id", UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
    Column(
        "workflow_stage_id", UUID(as_uuid=False), ForeignKey("workflow_stages.id", ondelete="CASCADE"), nullable=False
    ),
    Column("reason", Text, nullable=False),
    Column("authorised_by_user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("authorised_at", DateTime(timezone=True), nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

post_work_orders = Table(
    "post_work_orders",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("episode_id", UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
    Column("workflow_stage_id", UUID(as_uuid=False)),
    Column("booking_id", UUID(as_uuid=False)),
    Column("work_type", existing_postgres_enum("work_order_work_type"), nullable=False),
    Column("vendor_company_id", UUID(as_uuid=False)),
    Column("purchase_order_id", UUID(as_uuid=False)),
    Column("budget_line_id", UUID(as_uuid=False), ForeignKey("budget_lines.id", ondelete="SET NULL")),
    Column("client_purchase_order_id", UUID(as_uuid=False)),
    Column("qc_issue_id", UUID(as_uuid=False)),
    Column("delivery_item_id", UUID(as_uuid=False), ForeignKey("episode_delivery_items.id", ondelete="SET NULL")),
    Column("kind", existing_postgres_enum("work_order_kind"), nullable=False),
    Column("title", Text, nullable=False),
    Column("description", Text),
    Column("department", Text),
    Column("assignee_person_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="SET NULL")),
    Column("assignee_role", Text),
    Column("priority", existing_postgres_enum("work_order_priority"), nullable=False),
    Column("is_blocking", Boolean, nullable=False),
    Column("status", existing_postgres_enum("work_order_status"), nullable=False),
    Column("billing_scope", existing_postgres_enum("work_order_billing_scope"), nullable=False),
    Column("billing_status", existing_postgres_enum("work_order_billing_status"), nullable=False),
    # Planned occupancy is operational context; it is intentionally separate
    # from the client's agreed price.
    Column("planned_duration_quantity", Numeric(12, 2)),
    Column("planned_duration_unit", Text),
    Column("standard_day_hours_snapshot", Numeric(5, 2)),
    Column("allow_overtime_billing", Boolean, nullable=False),
    Column("overtime_multiplier", Numeric(7, 3)),
    Column("overtime_hourly_base_rate", Numeric(14, 4)),
    Column("estimated_amount", Numeric(14, 2)),
    Column("client_quote_amount", Numeric(14, 2)),
    Column("actual_amount", Numeric(14, 2)),
    Column("currency", Text, nullable=False),
    Column("client_quote_currency", Text),
    Column("billing_notes", Text),
    Column("external_url", Text),
    Column("due_at", DateTime(timezone=True)),
    Column("created_by_user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("approved_by_person_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="SET NULL")),
    Column("approved_at", DateTime(timezone=True)),
    Column("approval_note", Text),
    Column("completed_by_person_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="SET NULL")),
    Column("completed_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
    CheckConstraint(
        "(estimated_amount IS NULL OR estimated_amount >= 0) AND (client_quote_amount IS NULL OR client_quote_amount >= 0) AND (actual_amount IS NULL OR actual_amount >= 0)",
        name="post_work_orders_non_negative_money_check",
    ),
)

post_work_order_items = Table(
    "post_work_order_items",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("work_order_id", UUID(as_uuid=False), ForeignKey("post_work_orders.id", ondelete="CASCADE"), nullable=False),
    Column("type", existing_postgres_enum("work_order_item_type"), nullable=False),
    Column("description", Text, nullable=False),
    Column("quantity", Numeric(12, 2), nullable=False),
    Column("unit", Text, nullable=False),
    Column("unit_rate", Numeric(14, 2), nullable=False),
    Column("discount_percent", Numeric(7, 3), nullable=False),
    Column("notes", Text),
    Column("position", Integer, nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
    CheckConstraint(
        "quantity >= 0 AND unit_rate >= 0 AND discount_percent >= 0 AND discount_percent <= 100",
        name="post_work_order_items_non_negative_money_check",
    ),
)

# Work orders only need the narrow PO shape required to validate a reference
# during the transition. Balance calculation remains in the commercial module.
purchase_orders = Table(
    "purchase_orders",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("vendor_company_id", UUID(as_uuid=False), nullable=False),
    Column("show_id", UUID(as_uuid=False)),
    Column("episode_id", UUID(as_uuid=False)),
    Column("po_number", Text, nullable=False),
    Column("currency", Text, nullable=False),
    Column("approved_amount", Numeric(14, 2), nullable=False),
    Column("issue_date", Date),
    Column("expiry_date", Date),
    Column("status", existing_postgres_enum("purchase_order_status"), nullable=False),
    Column("notes", Text),
    Column("external_document_url", Text),
    Column("created_by_user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

client_purchase_orders = Table(
    "client_purchase_orders",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column(
        "client_company_id", UUID(as_uuid=False), ForeignKey("crm_companies.id", ondelete="RESTRICT"), nullable=False
    ),
    Column("show_id", UUID(as_uuid=False), ForeignKey("shows.id", ondelete="SET NULL")),
    Column("episode_id", UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="SET NULL")),
    Column("po_number", Text, nullable=False),
    Column("currency", Text, nullable=False),
    Column("approved_amount", Numeric(14, 2), nullable=False),
    Column("issue_date", Date),
    Column("expiry_date", Date),
    Column("status", existing_postgres_enum("client_purchase_order_status"), nullable=False),
    Column("notes", Text),
    Column("external_document_url", Text),
    Column("created_by_user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

client_purchase_order_allocations = Table(
    "client_purchase_order_allocations",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column(
        "client_purchase_order_id",
        UUID(as_uuid=False),
        ForeignKey("client_purchase_orders.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("allocation_type", existing_postgres_enum("client_purchase_order_allocation_type"), nullable=False),
    Column("billable_id", UUID(as_uuid=False)),
    Column("client_invoice_id", UUID(as_uuid=False)),
    Column("client_invoice_item_id", UUID(as_uuid=False)),
    Column("work_order_id", UUID(as_uuid=False), ForeignKey("post_work_orders.id", ondelete="CASCADE")),
    Column("change_order_reference", Text),
    Column("amount", Numeric(14, 2), nullable=False),
    Column("overrun_authorised", Boolean, nullable=False),
    Column("allocation_date", Date, nullable=False),
    Column("reference", Text),
    Column("description", Text),
    Column("created_by_user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

# Client billables and invoices are separate from the vendor procurement
# ledger and are owned by the same FastAPI/PostgreSQL contract.
client_invoices = Table(
    "client_invoices",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("sequence", Integer, nullable=False),
    Column("invoice_number", Text, nullable=False),
    Column("client_company_id", UUID(as_uuid=False), ForeignKey("crm_companies.id", ondelete="SET NULL")),
    Column("show_id", UUID(as_uuid=False), ForeignKey("shows.id", ondelete="SET NULL")),
    Column("episode_id", UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="SET NULL")),
    Column("status", existing_postgres_enum("client_invoice_status"), nullable=False),
    Column("invoice_date", Date, nullable=False),
    Column("due_date", Date, nullable=False),
    Column("currency", Text, nullable=False),
    Column("subtotal_amount", Numeric(14, 2), nullable=False),
    Column("tax_enabled", Boolean, nullable=False),
    Column("tax_name", Text, nullable=False),
    Column("tax_rate_percent", Numeric(7, 3), nullable=False),
    Column("tax_amount", Numeric(14, 2), nullable=False),
    Column("total_amount", Numeric(14, 2), nullable=False),
    Column("issuer_name", Text, nullable=False),
    Column("issuer_address", Text),
    Column("issuer_email", Text),
    Column("issuer_tax_registration_number", Text),
    Column("client_name", Text, nullable=False),
    Column("client_address", Text),
    Column("client_email", Text),
    Column("payment_instructions", Text),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
    CheckConstraint(
        "sequence > 0 AND subtotal_amount >= 0 AND tax_rate_percent >= 0 AND tax_amount >= 0 AND total_amount >= 0 AND total_amount = subtotal_amount + tax_amount",
        name="client_invoices_financial_totals_check",
    ),
)

billables = Table(
    "billables",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("show_id", UUID(as_uuid=False), ForeignKey("shows.id", ondelete="SET NULL")),
    Column("episode_id", UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="SET NULL")),
    Column("client_invoice_id", UUID(as_uuid=False), ForeignKey("client_invoices.id", ondelete="SET NULL")),
    Column(
        "client_purchase_order_id", UUID(as_uuid=False), ForeignKey("client_purchase_orders.id", ondelete="SET NULL")
    ),
    Column("vendor", Text, nullable=False),
    Column("reference", Text),
    Column("description", Text),
    Column("amount", Numeric(14, 2), nullable=False),
    Column("currency", Text, nullable=False),
    Column("status", existing_postgres_enum("billable_status"), nullable=False),
    Column("invoice_date", Date),
    Column("due_date", Date),
    Column("rate_source", Text),
    Column("rate_snapshot", JSON),
    Column("source_work_order_id", UUID(as_uuid=False), ForeignKey("post_work_orders.id", ondelete="RESTRICT")),
    Column("override_reason", Text),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
    CheckConstraint("amount >= 0", name="billables_amount_non_negative_check"),
)

client_invoice_items = Table(
    "client_invoice_items",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column(
        "client_invoice_id", UUID(as_uuid=False), ForeignKey("client_invoices.id", ondelete="CASCADE"), nullable=False
    ),
    Column("billable_id", UUID(as_uuid=False), ForeignKey("billables.id", ondelete="SET NULL")),
    Column(
        "client_purchase_order_id", UUID(as_uuid=False), ForeignKey("client_purchase_orders.id", ondelete="SET NULL")
    ),
    Column("description", Text, nullable=False),
    Column("reference", Text),
    Column("quantity", Numeric(14, 6), nullable=False),
    # Rates can carry fractions of a penny after an overtime multiplier. Keep
    # sufficient precision to prove quantity × unit rate equals the rounded
    # invoice-line amount; only the line amount itself is a penny value.
    Column("unit_amount", Numeric(14, 6), nullable=False),
    Column("amount", Numeric(14, 2), nullable=False),
    Column(
        "booking_charge_component_id",
        UUID(as_uuid=False),
        ForeignKey("booking_charge_components.id", ondelete="RESTRICT"),
    ),
    Column("booking_component_charge_kind", Text),
    # Booking-derived items retain these snapshots so a later scheduling or
    # rate-card edit cannot rewrite an issued commercial document.
    Column("source_booking_id", UUID(as_uuid=False), ForeignKey("bookings.id", ondelete="RESTRICT")),
    Column("booking_date", Date),
    Column("episode_code", Text),
    Column("episode_title", Text),
    Column("resource_type", Text),
    Column("resource_name", Text),
    Column("saved_rate", Numeric(14, 2)),
    Column("overtime_multiplier", Numeric(7, 3)),
    Column("voided_at", DateTime(timezone=True)),
    Column("voided_by_user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
    CheckConstraint(
        "quantity > 0 AND unit_amount >= 0 AND amount >= 0 AND amount = round(quantity * unit_amount, 2)",
        name="client_invoice_items_financial_amounts_check",
    ),
    CheckConstraint(
        "(booking_charge_component_id IS NULL AND booking_component_charge_kind IS NULL) "
        "OR (booking_charge_component_id IS NOT NULL AND booking_component_charge_kind IN ('base', 'overtime'))",
        name="client_invoice_items_booking_component_kind_check",
    ),
)

# Reversals copy the already-issued numbers.  They never recompute an amount
# from the current booking, rate card, or source component.
client_invoice_line_reversals = Table(
    "client_invoice_line_reversals",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("client_invoice_id", UUID(as_uuid=False), ForeignKey("client_invoices.id", ondelete="CASCADE"), nullable=False),
    Column("client_invoice_item_id", UUID(as_uuid=False), ForeignKey("client_invoice_items.id", ondelete="RESTRICT"), nullable=False),
    Column("reversal_type", Text, nullable=False),
    Column("quantity", Numeric(14, 6), nullable=False),
    Column("unit_amount", Numeric(14, 6), nullable=False),
    Column("amount", Numeric(14, 2), nullable=False),
    Column("reason", Text, nullable=False),
    Column("created_by_user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("created_at", DateTime(timezone=True), nullable=False),
    CheckConstraint("reversal_type IN ('void', 'credit')", name="client_invoice_line_reversals_type_check"),
    CheckConstraint("quantity > 0 AND unit_amount >= 0 AND amount < 0", name="client_invoice_line_reversals_amount_check"),
    UniqueConstraint("client_invoice_item_id", name="client_invoice_line_reversals_item_unique"),
)

purchase_order_allocations = Table(
    "purchase_order_allocations",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column(
        "purchase_order_id", UUID(as_uuid=False), ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=False
    ),
    Column("allocation_type", existing_postgres_enum("purchase_order_allocation_type"), nullable=False),
    Column("work_order_id", UUID(as_uuid=False)),
    Column("budget_line_id", UUID(as_uuid=False)),
    Column("vendor_invoice_id", UUID(as_uuid=False)),
    Column("amount", Numeric(14, 2), nullable=False),
    Column("allocation_date", Date, nullable=False),
    Column("reference", Text),
    Column("description", Text),
    Column("created_by_user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

vendor_invoices = Table(
    "vendor_invoices",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("vendor_company_id", UUID(as_uuid=False), nullable=False),
    Column("work_order_id", UUID(as_uuid=False)),
    Column("show_id", UUID(as_uuid=False)),
    Column("episode_id", UUID(as_uuid=False)),
    Column("budget_line_id", UUID(as_uuid=False), ForeignKey("budget_lines.id", ondelete="RESTRICT")),
    Column("invoice_number", Text, nullable=False),
    Column("description", Text),
    Column("amount", Numeric(14, 2), nullable=False),
    Column("currency", Text, nullable=False),
    Column("status", existing_postgres_enum("vendor_invoice_status"), nullable=False),
    Column("invoice_date", Date),
    Column("due_date", Date),
    Column("external_document_url", Text),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
    CheckConstraint("amount >= 0", name="vendor_invoices_amount_non_negative_check"),
)

qc_reports = Table(
    "qc_reports",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("episode_id", UUID(as_uuid=False), ForeignKey("episodes.id", ondelete="CASCADE"), nullable=False),
    Column("status", existing_postgres_enum("qc_report_status"), nullable=False),
    Column("report_url", Text),
    Column("checksum", Text),
    Column("summary", Text),
    Column("waiver_reason", Text),
    Column("waived_by_person_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="SET NULL")),
    Column("completed_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

qc_issues = Table(
    "qc_issues",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("qc_report_id", UUID(as_uuid=False), ForeignKey("qc_reports.id", ondelete="CASCADE"), nullable=False),
    Column("code", Text),
    Column("severity", Text, nullable=False),
    Column("description", Text, nullable=False),
    Column("timecode_seconds", Numeric(12, 3)),
    Column("status", existing_postgres_enum("qc_issue_status"), nullable=False),
    Column("resolution", Text),
    Column("resolved_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

notifications = Table(
    "notifications",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("person_id", UUID(as_uuid=False), ForeignKey("people.id", ondelete="CASCADE")),
    Column("crm_contact_id", UUID(as_uuid=False), ForeignKey("crm_contacts.id", ondelete="SET NULL")),
    Column("recipient_email", Text),
    Column("activity_id", UUID(as_uuid=False), ForeignKey("activity_log.id", ondelete="CASCADE")),
    Column("title", Text, nullable=False),
    Column("body", Text, nullable=False),
    Column("read_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

# FastAPI owns these opaque, revocable sessions. Hashing tokens means a database
# export cannot be replayed as an authenticated browser session.
api_sessions = Table(
    "api_sessions",
    metadata,
    Column("token_hash", String(64), primary_key=True),
    Column("user_id", Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("impersonated_user_id", Text, ForeignKey("users.id", ondelete="SET NULL")),
    Column("active_organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="SET NULL")),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("last_seen_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

# Persisted replay records for financial POSTs.  They are intentionally
# tenant- and actor-scoped: a request key is never a capability, merely a safe
# retry token for a single commercial operation.
financial_idempotency_keys = Table(
    "financial_idempotency_keys",
    metadata,
    Column("id", UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()),
    Column("organization_id", UUID(as_uuid=False), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    Column("actor_user_id", Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("operation", Text, nullable=False),
    Column("idempotency_key", Text, nullable=False),
    Column("request_hash", String(64), nullable=False),
    Column("response_status", Integer),
    Column("response_body", JSON),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("completed_at", DateTime(timezone=True)),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    CheckConstraint("length(trim(operation)) > 0", name="financial_idempotency_operation_check"),
    CheckConstraint("length(trim(idempotency_key)) BETWEEN 1 AND 255", name="financial_idempotency_key_check"),
    CheckConstraint(
        "(response_status IS NULL AND response_body IS NULL) OR (response_status BETWEEN 100 AND 599 AND response_body IS NOT NULL)",
        name="financial_idempotency_response_check",
    ),
    UniqueConstraint(
        "organization_id",
        "actor_user_id",
        "operation",
        "idempotency_key",
        name="financial_idempotency_actor_operation_key_unique",
    ),
)
