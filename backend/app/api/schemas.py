from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from math import isfinite
from typing import Annotated

from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator, model_validator


def _normalize_email(value: object) -> str:
    """Validate a syntactic email address while preserving demo accounts.

    The demo fixtures intentionally use the reserved ``.test`` domain. Pydantic
    ``EmailStr`` rejects that domain before the authentication or user-access
    code can run, which makes valid seeded demo users unable to sign in. We do
    not perform DNS deliverability checks here; production email verification
    belongs in a dedicated verification flow, not in credential parsing.
    """
    if not isinstance(value, str):
        raise ValueError("Enter a valid email address.")
    try:
        return validate_email(value.strip(), check_deliverability=False, test_environment=True).normalized
    except EmailNotValidError as error:
        raise ValueError("Enter a valid email address.") from error


PostPilotEmail = Annotated[str, BeforeValidator(_normalize_email)]


MONEY_QUANTUM = Decimal("0.01")


def _decimal_input(value: object) -> Decimal:
    """Parse JSON numeric input without ever performing binary float arithmetic.

    Browsers serialise form numbers as JSON numbers, which Python receives as
    ``float`` values. Converting through ``str`` retains the submitted decimal
    spelling (``0.1`` rather than the binary floating-point expansion) before
    money is validated or written to PostgreSQL.
    """
    if isinstance(value, bool):
        raise ValueError("Enter a numeric value.")
    if isinstance(value, Decimal):
        parsed = value
    elif isinstance(value, (str, int, float)):
        if isinstance(value, float) and not isfinite(value):
            raise ValueError("Enter a finite numeric value.")
        try:
            parsed = Decimal(str(value).strip())
        except (InvalidOperation, ValueError) as error:
            raise ValueError("Enter a numeric value.") from error
    else:
        raise ValueError("Enter a numeric value.")
    if not parsed.is_finite():
        raise ValueError("Enter a finite numeric value.")
    return parsed


def _money_input(value: object) -> Decimal:
    parsed = _decimal_input(value)
    if parsed.as_tuple().exponent < -2:
        raise ValueError("Enter money with no more than two decimal places.")
    return parsed


def _scaled_decimal_input(value: object, *, scale: int, label: str) -> Decimal:
    parsed = _decimal_input(value)
    if parsed.as_tuple().exponent < -scale:
        raise ValueError(f"Enter {label} with no more than {scale} decimal places.")
    return parsed


def _quantity_input(value: object) -> Decimal:
    return _scaled_decimal_input(value, scale=2, label="a quantity")


def _percent_input(value: object) -> Decimal:
    return _scaled_decimal_input(value, scale=3, label="a percentage")


def _markup_percent_input(value: object) -> Decimal:
    return _scaled_decimal_input(value, scale=2, label="a percentage")


Money = Annotated[Decimal, BeforeValidator(_money_input)]
Quantity = Annotated[Decimal, BeforeValidator(_quantity_input)]
Percentage = Annotated[Decimal, BeforeValidator(_percent_input)]
MarkupPercentage = Annotated[Decimal, BeforeValidator(_markup_percent_input)]


class LoginRequest(BaseModel):
    email: PostPilotEmail
    password: str = Field(min_length=1, max_length=1024)


class PasswordChangeRequest(BaseModel):
    """An authenticated user changes their own password without an email-code flow."""

    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(min_length=8, max_length=1024)


class PersonResponse(BaseModel):
    id: str
    name: str
    role: str


class OrganizationMembershipResponse(BaseModel):
    organization_id: str
    organization_name: str
    organization_slug: str
    currency: str
    role: str


class SessionResponse(BaseModel):
    authenticated_user_id: str
    user_id: str
    user_name: str | None
    active_organization_id: str | None
    memberships: list[OrganizationMembershipResponse]
    person: PersonResponse | None
    permissions: list[str]
    active_show: dict[str, str] | None
    debug_can_switch: bool
    # The API, not the browser, decides whether a tenant switch may retain a
    # nested record route. A client-provided pathname is only a requested
    # destination; it is never an authorization input.
    redirect_to: str | None = None


class ActiveOrganizationRequest(BaseModel):
    organization_id: str
    pathname: str | None = Field(default=None, max_length=2048)


class ActiveShowRequest(BaseModel):
    show_id: str | None = None


class DebugUserRequest(BaseModel):
    user_id: str | None = None
    pathname: str | None = Field(default=None, max_length=2048)


class DebugUserResponse(BaseModel):
    user_id: str
    name: str
    role: str
    label: str


class HealthResponse(BaseModel):
    status: str
    service: str
    timestamp: datetime


class ShowCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    code: str = Field(min_length=2, max_length=32)
    network: str | None = Field(default=None, max_length=120)
    production_company: str | None = Field(default=None, max_length=120)
    client_company_id: str | None = None
    production_company_id: str | None = None
    description: str | None = Field(default=None, max_length=4000)


class ShowUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    code: str | None = Field(default=None, min_length=2, max_length=32)
    network: str | None = Field(default=None, max_length=120)
    production_company: str | None = Field(default=None, max_length=120)
    client_company_id: str | None = None
    production_company_id: str | None = None
    description: str | None = Field(default=None, max_length=4000)


class EpisodeCreateRequest(BaseModel):
    season_id: str
    number: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=160)
    production_code: str | None = Field(default=None, max_length=40)
    synopsis: str | None = Field(default=None, max_length=4000)
    assigned_producer_id: str | None = None
    editor_id: str | None = None
    colorist_id: str | None = None
    sound_mixer_id: str | None = None
    air_date: date | None = None
    locked_cut_date: date | None = None
    delivery_deadline: datetime | None = None
    team_ids: list[str] = Field(default_factory=list)


class EpisodeUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    production_code: str | None = Field(default=None, max_length=40)
    synopsis: str | None = Field(default=None, max_length=4000)
    air_date: date | None = None
    locked_cut_date: date | None = None
    delivery_deadline: datetime | None = None


class BookingCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    room_id: str | None = None
    episode_id: str | None = None
    budget_line_id: str | None = None
    person_id: str | None = None
    guest_person_id: str | None = None
    starts_at: datetime
    ends_at: datetime
    setup_minutes: int = Field(default=0, ge=0, le=480)
    handover_minutes: int = Field(default=0, ge=0, le=480)
    status: str = Field(default="confirmed", pattern="^(tentative|confirmed|hold|cancelled)$")
    booking_type: str = Field(
        default="edit",
        pattern="^(edit|color|mix|qc|client_review|ingest|conform|leave|training|sick|unavailable)$",
    )
    is_option: bool = False
    notes: str | None = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def valid_window(self) -> BookingCreateRequest:
        if self.ends_at <= self.starts_at:
            raise ValueError("Booking end must be after its start.")
        if self.budget_line_id and not self.episode_id:
            raise ValueError("Choose an episode before assigning a budget item.")
        return self


class BookingConflictRequest(BookingCreateRequest):
    exclude_booking_id: str | None = None


class BookingTimeSubmissionRequest(BaseModel):
    """Actual time only; all rates and monetary values are server-derived."""

    model_config = ConfigDict(extra="forbid")

    actual_starts_at: datetime
    actual_ends_at: datetime
    overtime_minutes: int = Field(default=0, ge=0, le=720)
    note: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def valid_window(self) -> BookingTimeSubmissionRequest:
        if self.actual_ends_at <= self.actual_starts_at:
            raise ValueError("Actual end must be after actual start.")
        return self


class WorkOrderItemRequest(BaseModel):
    type: str = Field(pattern="^(service|material|expense)$")
    description: str = Field(min_length=2, max_length=240)
    quantity: Quantity = Field(gt=0)
    unit: str = Field(pattern="^(hour|day|unit|fixed)$")
    unit_rate: Money = Field(ge=0)
    discount_percent: Percentage = Field(default=Decimal("0"), ge=0, le=100)
    notes: str | None = Field(default=None, max_length=1000)


class WorkOrderCreateRequest(BaseModel):
    episode_id: str
    workflow_stage_id: str | None = None
    booking_id: str | None = None
    work_type: str = Field(default="internal", pattern="^(internal|external_vendor)$")
    vendor_company_id: str | None = None
    purchase_order_id: str | None = None
    budget_line_id: str | None = None
    client_purchase_order_id: str | None = None
    kind: str = Field(default="work_order", pattern="^(work_order|qc_exception|delivery_correction)$")
    title: str = Field(min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    department: str | None = Field(default=None, max_length=120)
    assignee_person_id: str | None = None
    assignee_role: str | None = Field(default=None, max_length=80)
    priority: str = Field(default="normal", pattern="^(blocker|high|normal|low)$")
    is_blocking: bool | None = None
    billing_scope: str = Field(default="included", pattern="^(included|billable_change|internal)$")
    estimated_amount: Money | None = Field(default=None, ge=0)
    client_quote_amount: Money | None = Field(default=None, ge=0)
    billing_notes: str | None = Field(default=None, max_length=2000)
    items: list[WorkOrderItemRequest] = Field(default_factory=list, max_length=50)
    external_url: str | None = Field(default=None, max_length=2000)
    due_at: datetime | None = None

    @field_validator("external_url")
    @classmethod
    def valid_external_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("https://", "http://")):
            raise ValueError("Enter a valid external link.")
        return value

    @model_validator(mode="after")
    def coherent_commercial_scope(self) -> WorkOrderCreateRequest:
        if self.is_blocking and not self.workflow_stage_id:
            raise ValueError("A blocking work order must be linked to a workflow stage.")
        if self.work_type == "external_vendor" and not self.vendor_company_id:
            raise ValueError("Choose a vendor for external work.")
        if self.work_type == "internal" and (
            self.vendor_company_id or self.purchase_order_id or self.budget_line_id or self.estimated_amount is not None
        ):
            raise ValueError("Internal work cannot include a vendor, PO, or vendor estimate.")
        if self.client_purchase_order_id and (self.work_type != "internal" or self.billing_scope != "billable_change"):
            raise ValueError("A client PO is only available for internal client-billable work.")
        if self.client_purchase_order_id and (self.client_quote_amount is None or self.client_quote_amount <= 0):
            raise ValueError("Enter a quoted client amount before selecting a client PO.")
        return self


class WorkOrderUpdateRequest(BaseModel):
    episode_id: str | None = None
    status: str | None = Field(
        default=None,
        pattern="^(open|awaiting_approval|in_progress|ready_for_review|complete|rejected|cancelled)$",
    )
    title: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    department: str | None = Field(default=None, max_length=120)
    assignee_person_id: str | None = None
    assignee_role: str | None = Field(default=None, max_length=80)
    work_type: str | None = Field(default=None, pattern="^(internal|external_vendor)$")
    vendor_company_id: str | None = None
    purchase_order_id: str | None = None
    budget_line_id: str | None = None
    client_purchase_order_id: str | None = None
    billing_scope: str | None = Field(default=None, pattern="^(included|billable_change|internal)$")
    estimated_amount: Money | None = Field(default=None, ge=0)
    client_quote_amount: Money | None = Field(default=None, ge=0)
    billing_notes: str | None = Field(default=None, max_length=2000)
    priority: str | None = Field(default=None, pattern="^(blocker|high|normal|low)$")
    is_blocking: bool | None = None
    external_url: str | None = Field(default=None, max_length=2000)
    due_at: datetime | None = None
    approval_note: str | None = Field(default=None, max_length=2000)
    overrun_reason: str | None = Field(default=None, min_length=8, max_length=2000)
    client_po_overrun_reason: str | None = Field(default=None, min_length=8, max_length=2000)

    @field_validator("external_url")
    @classmethod
    def valid_external_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("https://", "http://")):
            raise ValueError("Enter a valid external link.")
        return value

    @model_validator(mode="after")
    def at_least_one_change(self) -> WorkOrderUpdateRequest:
        if not self.model_fields_set:
            raise ValueError("Provide at least one work-order change.")
        if self.client_purchase_order_id and self.work_type == "external_vendor":
            raise ValueError("A client PO is only available for internal client-billable work.")
        if self.client_purchase_order_id and self.billing_scope and self.billing_scope != "billable_change":
            raise ValueError("A client PO is only available for internal client-billable work.")
        if self.client_purchase_order_id and self.client_quote_amount is not None and self.client_quote_amount <= 0:
            raise ValueError("Enter a quoted client amount before selecting a client PO.")
        return self


class WorkOrderBookingRequest(BaseModel):
    room_id: str
    starts_at: datetime
    ends_at: datetime
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def valid_window(self) -> WorkOrderBookingRequest:
        if self.ends_at <= self.starts_at:
            raise ValueError("Booking end must be after its start.")
        return self


class PurchaseOrderCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vendor_company_id: str
    show_id: str | None = None
    episode_id: str | None = None
    po_number: str = Field(min_length=1, max_length=120)
    approved_amount: Money = Field(gt=0)
    issue_date: date | None = None
    expiry_date: date | None = None
    status: str = Field(default="draft", pattern="^(draft|approved|closed|cancelled)$")
    notes: str | None = Field(default=None, max_length=8000)
    external_document_url: str | None = Field(default=None, max_length=2000)

    @field_validator("external_document_url")
    @classmethod
    def valid_document_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("https://", "http://")):
            raise ValueError("Enter a valid document link.")
        return value

    @model_validator(mode="after")
    def valid_dates(self) -> PurchaseOrderCreateRequest:
        if self.issue_date and self.expiry_date and self.expiry_date < self.issue_date:
            raise ValueError("Expiry date cannot be before the issue date.")
        return self


class PurchaseOrderUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vendor_company_id: str | None = None
    show_id: str | None = None
    episode_id: str | None = None
    po_number: str | None = Field(default=None, min_length=1, max_length=120)
    approved_amount: Money | None = Field(default=None, gt=0)
    issue_date: date | None = None
    expiry_date: date | None = None
    status: str | None = Field(default=None, pattern="^(draft|approved|closed|cancelled)$")
    notes: str | None = Field(default=None, max_length=8000)
    external_document_url: str | None = Field(default=None, max_length=2000)

    @field_validator("external_document_url")
    @classmethod
    def valid_document_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("https://", "http://")):
            raise ValueError("Enter a valid document link.")
        return value

    @model_validator(mode="after")
    def meaningful_update(self) -> PurchaseOrderUpdateRequest:
        if not self.model_fields_set:
            raise ValueError("Provide at least one PO change.")
        if self.issue_date and self.expiry_date and self.expiry_date < self.issue_date:
            raise ValueError("Expiry date cannot be before the issue date.")
        return self


class PurchaseOrderAllocationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    allocation_type: str = Field(pattern="^(work_order|budget_line|vendor_invoice)$")
    work_order_id: str | None = None
    budget_line_id: str | None = None
    vendor_invoice_id: str | None = None
    amount: Money = Field(gt=0)
    allocation_date: date
    reference: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    overrun_reason: str | None = Field(default=None, min_length=8, max_length=2000)

    @model_validator(mode="after")
    def matching_source(self) -> PurchaseOrderAllocationRequest:
        sources = [value for value in (self.work_order_id, self.budget_line_id, self.vendor_invoice_id) if value]
        expected = {
            "work_order": self.work_order_id,
            "budget_line": self.budget_line_id,
            "vendor_invoice": self.vendor_invoice_id,
        }[self.allocation_type]
        if len(sources) != 1 or not expected:
            raise ValueError("An allocation must reference exactly one matching source.")
        return self


class PurchaseOrderActualCostRequest(BaseModel):
    episode_id: str | None = None
    budget_line_id: str
    invoice_number: str = Field(min_length=1, max_length=120)
    invoice_date: date
    amount: Money = Field(gt=0)
    description: str = Field(min_length=1, max_length=2000)
    external_document_url: str | None = Field(default=None, max_length=2000)
    overrun_reason: str | None = Field(default=None, min_length=8, max_length=2000)

    @field_validator("external_document_url")
    @classmethod
    def valid_document_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("https://", "http://")):
            raise ValueError("Enter a valid document link.")
        return value


class VendorInvoiceCreateRequest(BaseModel):
    """A supplier actual that may exist with or without a vendor PO."""

    model_config = ConfigDict(extra="forbid")

    vendor_company_id: str
    work_order_id: str | None = None
    budget_line_id: str | None = None
    episode_id: str
    invoice_number: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    amount: Money = Field(gt=0)
    status: str = Field(default="received", pattern="^(received|approved|paid|disputed|void)$")
    invoice_date: date | None = None
    due_date: date | None = None
    external_document_url: str | None = Field(default=None, max_length=2000)
    overrun_reason: str | None = Field(default=None, min_length=8, max_length=2000)

    @field_validator("external_document_url")
    @classmethod
    def valid_document_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("https://", "http://")):
            raise ValueError("Enter a valid document link.")
        return value


class VendorInvoiceUpdateRequest(BaseModel):
    """A controlled supplier-invoice correction against its live allocation."""

    model_config = ConfigDict(extra="forbid")

    invoice_number: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    amount: Money | None = Field(default=None, gt=0)
    status: str | None = Field(default=None, pattern="^(received|approved|paid|disputed|void)$")
    invoice_date: date | None = None
    due_date: date | None = None
    external_document_url: str | None = Field(default=None, max_length=2000)
    overrun_reason: str | None = Field(default=None, min_length=8, max_length=2000)

    @field_validator("external_document_url")
    @classmethod
    def valid_document_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("https://", "http://")):
            raise ValueError("Enter a valid document link.")
        return value

    @model_validator(mode="after")
    def meaningful_update(self) -> VendorInvoiceUpdateRequest:
        if not self.model_fields_set:
            raise ValueError("Provide at least one supplier-invoice change.")
        return self


class BudgetLineCreateRequest(BaseModel):
    """A planned episode estimate; actuals are allocation-backed server data."""

    model_config = ConfigDict(extra="forbid")

    episode_id: str
    category: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    code: str | None = Field(default=None, max_length=80)
    external_cost: bool = False
    cost_type: str = Field(default="internal", pattern="^(internal|billable)$")
    budgeted_amount: Money = Field(default=Decimal("0"), ge=0)
    planned_quantity: Quantity | None = Field(default=None, ge=0)
    planned_unit: str | None = Field(default=None, pattern="^(hour|day|episode|fixed|unit)$")
    rate_resource_type: str | None = Field(default=None, pattern="^(service|room|person)$")
    rate_resource_id: str | None = None
    manual_rate_override: Money | None = Field(default=None, ge=0)
    vendor_company_id: str | None = None
    estimate_status: str = Field(default="draft", pattern="^(legacy|draft|approved|revised)$")
    manual_override_reason: str | None = Field(default=None, min_length=4, max_length=2000)
    work_order_id: str | None = None
    purchase_order_id: str | None = None
    overrun_reason: str | None = Field(default=None, min_length=8, max_length=2000)

    @model_validator(mode="after")
    def coherent_links(self) -> BudgetLineCreateRequest:
        if self.purchase_order_id and not self.external_cost:
            raise ValueError("Only external-cost lines can use a vendor PO.")
        if (
            self.purchase_order_id
            and self.budgeted_amount <= 0
            and not (self.rate_resource_id or self.manual_rate_override is not None)
        ):
            raise ValueError("A PO-linked cost line needs a positive estimate.")
        if bool(self.rate_resource_type) != bool(self.rate_resource_id):
            raise ValueError("Choose both a budget resource type and resource.")
        if self.rate_resource_id and self.planned_quantity is None:
            raise ValueError("A rate-resolved budget item needs a planned quantity.")
        if self.manual_rate_override is not None and self.rate_resource_id and not self.manual_override_reason:
            raise ValueError("Explain a manual rate override.")
        return self


class BudgetLineUpdateRequest(BaseModel):
    """Partial update with explicit null support for optional commercial links."""

    model_config = ConfigDict(extra="forbid")

    category: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    code: str | None = Field(default=None, max_length=80)
    external_cost: bool | None = None
    cost_type: str | None = Field(default=None, pattern="^(internal|billable)$")
    budgeted_amount: Money | None = Field(default=None, ge=0)
    planned_quantity: Quantity | None = Field(default=None, ge=0)
    planned_unit: str | None = Field(default=None, pattern="^(hour|day|episode|fixed|unit)$")
    rate_resource_type: str | None = Field(default=None, pattern="^(service|room|person)$")
    rate_resource_id: str | None = None
    manual_rate_override: Money | None = Field(default=None, ge=0)
    vendor_company_id: str | None = None
    estimate_status: str | None = Field(default=None, pattern="^(legacy|draft|approved|revised)$")
    manual_override_reason: str | None = Field(default=None, min_length=4, max_length=2000)
    work_order_id: str | None = None
    purchase_order_id: str | None = None
    overrun_reason: str | None = Field(default=None, min_length=8, max_length=2000)

    @model_validator(mode="after")
    def meaningful_update(self) -> BudgetLineUpdateRequest:
        if not self.model_fields_set - {"overrun_reason"}:
            raise ValueError("Provide at least one budget-line change.")
        return self


class BudgetManualActualAdjustmentRequest(BaseModel):
    """An exceptional actual with an explicit reason; no browser totals on lines."""

    model_config = ConfigDict(extra="forbid")

    amount: Money = Field(ge=0)
    reason: str = Field(min_length=4, max_length=2000)
    reference: str | None = Field(default=None, max_length=240)
    allocation_date: date | None = None


class BudgetEstimateRevisionCreateRequest(BaseModel):
    """Start a named draft revision or approve the initial working estimate."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=160)
    reason: str = Field(min_length=4, max_length=2000)
    approve_immediately: bool = False


class BudgetEstimatePreviewRequest(BaseModel):
    """One planned estimate row resolved exclusively by the server."""

    model_config = ConfigDict(extra="forbid")

    episode_id: str
    category: str = Field(min_length=2, max_length=120)
    planned_quantity: Quantity = Field(gt=0)
    planned_unit: str = Field(pattern="^(hour|day|episode|fixed|unit)$")
    rate_resource_type: str | None = Field(default=None, pattern="^(service|room|person)$")
    rate_resource_id: str | None = None
    manual_rate_override: Money | None = Field(default=None, ge=0)
    manual_override_reason: str | None = Field(default=None, min_length=4, max_length=2000)
    vendor_company_id: str | None = None

    @model_validator(mode="after")
    def coherent_rate_input(self) -> BudgetEstimatePreviewRequest:
        if bool(self.rate_resource_type) != bool(self.rate_resource_id):
            raise ValueError("Choose both a budget resource type and resource.")
        if self.rate_resource_id and self.manual_rate_override is not None and not self.manual_override_reason:
            raise ValueError("Explain a manual rate override.")
        if not self.rate_resource_id and self.manual_rate_override is None:
            raise ValueError("A fixed or vendor estimate needs a manual rate.")
        return self


class ServiceRateCreateRequest(BaseModel):
    """Tenant service catalogue entries for rooms, artists, and services."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=160)
    category: str = Field(min_length=2, max_length=120)
    unit: str = Field(min_length=2, max_length=40)
    rate: Money = Field(ge=0)
    notes: str | None = Field(default=None, max_length=2000)
    is_active: bool = True


class ServiceRateUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=2, max_length=160)
    category: str | None = Field(default=None, min_length=2, max_length=120)
    unit: str | None = Field(default=None, min_length=2, max_length=40)
    rate: Money | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None

    @model_validator(mode="after")
    def meaningful_update(self) -> ServiceRateUpdateRequest:
        if not self.model_fields_set:
            raise ValueError("Provide at least one service-rate change.")
        return self


class RateCardOverrideRequest(BaseModel):
    """Set one manual override on a scoped card; derived totals stay server-side."""

    model_config = ConfigDict(extra="forbid")

    scope: str = Field(pattern="^(master|network|client|show|episode)$")
    network: str | None = Field(default=None, min_length=1, max_length=160)
    client_company_id: str | None = None
    show_id: str | None = None
    episode_id: str | None = None
    service_rate_id: str | None = None
    category: str | None = Field(default=None, min_length=2, max_length=120)
    unit: str | None = Field(default=None, min_length=2, max_length=40)
    rate: Money = Field(ge=0)

    @model_validator(mode="after")
    def valid_scope_and_service(self) -> RateCardOverrideRequest:
        targets = {
            "network": self.network,
            "client": self.client_company_id,
            "show": self.show_id,
            "episode": self.episode_id,
        }
        if self.scope == "master":
            if any(targets.values()):
                raise ValueError("A master rate card cannot have a scoped target.")
        elif not targets[self.scope]:
            raise ValueError(f"A {self.scope} rate card needs its matching target.")
        elif any(value for name, value in targets.items() if name != self.scope):
            raise ValueError("A rate-card override can have only one scope target.")
        if not self.service_rate_id and not (self.category and self.unit):
            raise ValueError("Choose a service rate or provide a category and unit.")
        return self


class ClientPurchaseOrderCreateRequest(BaseModel):
    """A client billing authorisation; its balances are allocation-derived."""

    model_config = ConfigDict(extra="forbid")

    client_company_id: str
    show_id: str | None = None
    episode_id: str | None = None
    po_number: str = Field(min_length=1, max_length=120)
    approved_amount: Money = Field(gt=0)
    issue_date: date | None = None
    expiry_date: date | None = None
    status: str = Field(default="draft", pattern="^(draft|active|closed|cancelled)$")
    notes: str | None = Field(default=None, max_length=8000)
    external_document_url: str | None = Field(default=None, max_length=2000)

    @field_validator("external_document_url")
    @classmethod
    def valid_document_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("https://", "http://")):
            raise ValueError("Enter a valid document link.")
        return value

    @model_validator(mode="after")
    def valid_dates(self) -> ClientPurchaseOrderCreateRequest:
        if self.issue_date and self.expiry_date and self.expiry_date < self.issue_date:
            raise ValueError("Expiry date cannot be before the issue date.")
        return self


class ClientPurchaseOrderUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_company_id: str | None = None
    show_id: str | None = None
    episode_id: str | None = None
    po_number: str | None = Field(default=None, min_length=1, max_length=120)
    approved_amount: Money | None = Field(default=None, gt=0)
    issue_date: date | None = None
    expiry_date: date | None = None
    status: str | None = Field(default=None, pattern="^(draft|active|closed|cancelled)$")
    notes: str | None = Field(default=None, max_length=8000)
    external_document_url: str | None = Field(default=None, max_length=2000)

    @field_validator("external_document_url")
    @classmethod
    def valid_document_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("https://", "http://")):
            raise ValueError("Enter a valid document link.")
        return value

    @model_validator(mode="after")
    def meaningful_update(self) -> ClientPurchaseOrderUpdateRequest:
        if not self.model_fields_set:
            raise ValueError("Provide at least one client PO change.")
        if self.issue_date and self.expiry_date and self.expiry_date < self.issue_date:
            raise ValueError("Expiry date cannot be before the issue date.")
        return self


class ClientPurchaseOrderAllocationRequest(BaseModel):
    """One auditable receivables commitment or invoice allocation."""

    model_config = ConfigDict(extra="forbid")

    allocation_type: str = Field(pattern="^(billable|client_invoice|change_order|work_order)$")
    billable_id: str | None = None
    client_invoice_id: str | None = None
    client_invoice_item_id: str | None = None
    work_order_id: str | None = None
    change_order_reference: str | None = Field(default=None, min_length=1, max_length=160)
    amount: Money = Field(gt=0)
    allocation_date: date
    reference: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    overrun_reason: str | None = Field(default=None, min_length=8, max_length=2000)

    @model_validator(mode="after")
    def one_matching_source(self) -> ClientPurchaseOrderAllocationRequest:
        sources = {
            "billable": self.billable_id,
            "client_invoice": self.client_invoice_id or self.client_invoice_item_id,
            "change_order": self.change_order_reference,
            "work_order": self.work_order_id,
        }
        supplied = [
            value
            for value in (
                self.billable_id,
                self.client_invoice_id,
                self.client_invoice_item_id,
                self.work_order_id,
                self.change_order_reference,
            )
            if value
        ]
        if len(supplied) != 1 or not sources[self.allocation_type]:
            raise ValueError("An allocation must reference exactly one record matching its allocation type.")
        return self


class CrmCompanyCreateRequest(BaseModel):
    """One tenant-owned client, network, studio, production-company, or vendor account."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=160)
    type: str = Field(pattern="^(client|vendor|network|studio|production_company)$")
    address: str | None = Field(default=None, max_length=1000)
    service_category: str | None = Field(default=None, max_length=160)
    is_preferred_supplier: bool = False
    payment_terms_days: int | None = Field(default=None, ge=0, le=365)
    finance_email: PostPilotEmail | None = None
    billing_email: PostPilotEmail | None = None
    account_status: str = Field(default="active", pattern="^(active|on_hold|inactive)$")
    booking_clearance: str = Field(default="clear", pattern="^(clear|authorisation_required|finance_approval|on_hold)$")
    account_owner_id: str | None = None
    next_action: str | None = Field(default=None, max_length=500)
    next_action_due_at: date | None = None
    notes: str | None = Field(default=None, max_length=8000)

    @model_validator(mode="after")
    def vendor_fields_match_company_type(self) -> CrmCompanyCreateRequest:
        if self.type != "vendor" and self.is_preferred_supplier:
            raise ValueError("Preferred-supplier status is only available for vendor accounts.")
        return self


class CrmCompanyUpdateRequest(BaseModel):
    """Account type is immutable after creation because PO semantics depend on it."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=2, max_length=160)
    address: str | None = Field(default=None, max_length=1000)
    service_category: str | None = Field(default=None, max_length=160)
    is_preferred_supplier: bool | None = None
    payment_terms_days: int | None = Field(default=None, ge=0, le=365)
    finance_email: PostPilotEmail | None = None
    billing_email: PostPilotEmail | None = None
    account_status: str | None = Field(default=None, pattern="^(active|on_hold|inactive)$")
    booking_clearance: str | None = Field(
        default=None, pattern="^(clear|authorisation_required|finance_approval|on_hold)$"
    )
    account_owner_id: str | None = None
    next_action: str | None = Field(default=None, max_length=500)
    next_action_due_at: date | None = None
    notes: str | None = Field(default=None, max_length=8000)

    @model_validator(mode="after")
    def meaningful_update(self) -> CrmCompanyUpdateRequest:
        if not self.model_fields_set:
            raise ValueError("Provide at least one account change.")
        return self


class CrmContactCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    company_id: str
    name: str = Field(min_length=2, max_length=120)
    title: str | None = Field(default=None, max_length=160)
    email: PostPilotEmail | None = None
    phone: str | None = Field(default=None, max_length=80)
    contact_type: str = Field(pattern="^(general|creative_approval|technical_delivery|finance|legal|client_review)$")
    is_primary: bool = False
    notes: str | None = Field(default=None, max_length=4000)


class CrmContactUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=2, max_length=120)
    title: str | None = Field(default=None, max_length=160)
    email: PostPilotEmail | None = None
    phone: str | None = Field(default=None, max_length=80)
    contact_type: str | None = Field(
        default=None, pattern="^(general|creative_approval|technical_delivery|finance|legal|client_review)$"
    )
    is_primary: bool | None = None
    notes: str | None = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def meaningful_update(self) -> CrmContactUpdateRequest:
        if not self.model_fields_set:
            raise ValueError("Provide at least one contact change.")
        return self


class ShowContactCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contact_id: str
    responsibility: str = Field(pattern="^(creative_approvals|delivery_qc|finance_billing|legal_compliance)$")
    relationship: str = Field(min_length=2, max_length=240)
    is_approval_contact: bool = False


class ShowContactUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    responsibility: str | None = Field(
        default=None, pattern="^(creative_approvals|delivery_qc|finance_billing|legal_compliance)$"
    )
    relationship: str | None = Field(default=None, min_length=2, max_length=240)
    is_approval_contact: bool | None = None

    @model_validator(mode="after")
    def meaningful_update(self) -> ShowContactUpdateRequest:
        if not self.model_fields_set:
            raise ValueError("Provide at least one show-contact change.")
        return self


class BillableFromWorkOrderRequest(BaseModel):
    """Post the approved commercial value of one completed client change.

    The price is deliberately not accepted here: the server posts the already
    approved client_quote_amount stored on the work order.  This prevents a
    browser from altering a charge while it is turned into a billable.
    """

    model_config = ConfigDict(extra="forbid")

    reference: str | None = Field(default=None, max_length=160)


class BillableVoidRequest(BaseModel):
    """Release a not-yet-invoiced client charge with an auditable reason."""

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=4, max_length=2000)


class ClientPoOverrunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_purchase_order_id: str
    reason: str = Field(min_length=8, max_length=2000)


class ClientInvoiceIssueRequest(BaseModel):
    """Issue one immutable invoice from all ready episode billables."""

    model_config = ConfigDict(extra="forbid")

    episode_id: str
    client_po_overruns: list[ClientPoOverrunRequest] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def unique_client_po_overruns(self) -> ClientInvoiceIssueRequest:
        ids = [item.client_purchase_order_id for item in self.client_po_overruns]
        if len(ids) != len(set(ids)):
            raise ValueError("Provide at most one overrun reason for each client PO.")
        return self


class DeliveryProfileCreateRequest(BaseModel):
    client_company_id: str | None = None
    network: str | None = Field(default=None, max_length=120)
    show_id: str | None = None
    name: str = Field(min_length=2, max_length=160)
    specification_url: str | None = Field(default=None, max_length=2000)
    is_active: bool = True

    @field_validator("specification_url")
    @classmethod
    def valid_specification_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("https://", "http://")):
            raise ValueError("Enter a valid specification link.")
        return value


class DeliveryProfileUpdateRequest(BaseModel):
    client_company_id: str | None = None
    network: str | None = Field(default=None, max_length=120)
    show_id: str | None = None
    name: str | None = Field(default=None, min_length=2, max_length=160)
    specification_url: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None

    @field_validator("specification_url")
    @classmethod
    def valid_specification_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("https://", "http://")):
            raise ValueError("Enter a valid specification link.")
        return value

    @model_validator(mode="after")
    def at_least_one_change(self) -> DeliveryProfileUpdateRequest:
        if not self.model_fields_set:
            raise ValueError("Provide at least one delivery profile change.")
        return self


class DeliveryProfileItemCreateRequest(BaseModel):
    component_type: str = Field(min_length=2, max_length=80)
    label: str = Field(min_length=2, max_length=240)
    required: bool = True
    format_specification: str | None = Field(default=None, max_length=4000)
    version: str | None = Field(default=None, max_length=120)
    territory: str | None = Field(default=None, max_length=120)
    language: str | None = Field(default=None, max_length=120)
    recipient_contact_id: str | None = None
    requires_external_recipient: bool = False
    qc_required: bool = False
    default_deadline_offset_days: int | None = Field(default=None, ge=-365, le=3650)
    position: int = Field(default=1, ge=1)


class DeliveryProfileItemUpdateRequest(BaseModel):
    component_type: str | None = Field(default=None, min_length=2, max_length=80)
    label: str | None = Field(default=None, min_length=2, max_length=240)
    required: bool | None = None
    format_specification: str | None = Field(default=None, max_length=4000)
    version: str | None = Field(default=None, max_length=120)
    territory: str | None = Field(default=None, max_length=120)
    language: str | None = Field(default=None, max_length=120)
    recipient_contact_id: str | None = None
    requires_external_recipient: bool | None = None
    qc_required: bool | None = None
    default_deadline_offset_days: int | None = Field(default=None, ge=-365, le=3650)
    position: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def at_least_one_change(self) -> DeliveryProfileItemUpdateRequest:
        if not self.model_fields_set:
            raise ValueError("Provide at least one delivery profile item change.")
        return self


class ApplyDeliveryProfileRequest(BaseModel):
    delivery_profile_id: str
    reason: str = Field(min_length=3, max_length=2000)


class DeliveryItemTransitionRequest(BaseModel):
    status: str = Field(
        pattern="^(not_started|preparing|ready_for_qc|qc_failed|qc_passed|dispatched|receipt_confirmed|rejected|waived)$"
    )
    reason: str = Field(min_length=3, max_length=4000)
    external_url: str | None = Field(default=None, max_length=2000)
    external_reference: str | None = Field(default=None, max_length=500)
    submission_method: str | None = Field(default=None, max_length=120)
    receipt_confirmed_by: str | None = Field(default=None, max_length=240)

    @field_validator("external_url")
    @classmethod
    def valid_external_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("https://", "http://")):
            raise ValueError("Enter a valid external link.")
        return value


class DeliveryManifestShareRequest(BaseModel):
    person_id: str


class DeliveryAcceptanceExceptionRequest(BaseModel):
    workflow_stage_id: str
    reason: str = Field(min_length=3, max_length=4000)


class EpisodeDeliveryItemCreateRequest(BaseModel):
    component_type: str = Field(min_length=2, max_length=80)
    label: str = Field(min_length=2, max_length=240)
    required: bool = True
    format_specification: str | None = Field(default=None, max_length=4000)
    version: str | None = Field(default=None, max_length=120)
    territory: str | None = Field(default=None, max_length=120)
    language: str | None = Field(default=None, max_length=120)
    recipient_contact_id: str | None = None
    requires_external_recipient: bool = False
    qc_required: bool = False
    due_date: date | None = None
    external_url: str | None = Field(default=None, max_length=2000)
    external_reference: str | None = Field(default=None, max_length=500)
    is_externally_shared: bool = False
    submission_method: str | None = Field(default=None, max_length=120)
    reason: str = Field(min_length=3, max_length=2000)

    @field_validator("external_url")
    @classmethod
    def valid_external_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("https://", "http://")):
            raise ValueError("Enter a valid external link.")
        return value


class EpisodeDeliveryItemUpdateRequest(BaseModel):
    component_type: str | None = Field(default=None, min_length=2, max_length=80)
    label: str | None = Field(default=None, min_length=2, max_length=240)
    required: bool | None = None
    format_specification: str | None = Field(default=None, max_length=4000)
    version: str | None = Field(default=None, max_length=120)
    territory: str | None = Field(default=None, max_length=120)
    language: str | None = Field(default=None, max_length=120)
    recipient_contact_id: str | None = None
    requires_external_recipient: bool | None = None
    qc_required: bool | None = None
    due_date: date | None = None
    external_url: str | None = Field(default=None, max_length=2000)
    external_reference: str | None = Field(default=None, max_length=500)
    is_externally_shared: bool | None = None
    submission_method: str | None = Field(default=None, max_length=120)
    position: int | None = Field(default=None, ge=1)
    reason: str = Field(min_length=3, max_length=2000)

    @field_validator("external_url")
    @classmethod
    def valid_external_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("https://", "http://")):
            raise ValueError("Enter a valid external link.")
        return value

    @model_validator(mode="after")
    def at_least_one_change(self) -> EpisodeDeliveryItemUpdateRequest:
        if self.model_fields_set <= {"reason"}:
            raise ValueError("Provide at least one delivery item change.")
        return self


class EpisodeDeliveryItemRemoveRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


class QcReportCreateRequest(BaseModel):
    episode_id: str
    status: str = Field(pattern="^(draft|in_progress|passed|failed|waived)$")
    report_url: str | None = Field(default=None, max_length=2000)
    checksum: str | None = Field(default=None, max_length=500)
    summary: str | None = Field(default=None, max_length=4000)
    waiver_reason: str | None = Field(default=None, max_length=4000)

    @field_validator("report_url")
    @classmethod
    def valid_report_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("https://", "http://")):
            raise ValueError("Enter a valid report link.")
        return value

    @model_validator(mode="after")
    def valid_waiver(self) -> QcReportCreateRequest:
        if self.status == "waived" and not self.waiver_reason:
            raise ValueError("A QC waiver reason is required.")
        return self


class QcIssueCreateRequest(BaseModel):
    qc_report_id: str
    code: str | None = Field(default=None, max_length=120)
    severity: str = Field(pattern="^(minor|major|critical)$")
    description: str = Field(min_length=3, max_length=4000)
    timecode_seconds: float | None = Field(default=None, ge=0)


class QcIssueUpdateRequest(BaseModel):
    status: str = Field(pattern="^(open|resolved|waived)$")
    resolution: str | None = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def resolution_for_closed_issue(self) -> QcIssueUpdateRequest:
        if self.status in {"resolved", "waived"} and not self.resolution:
            raise ValueError("A resolution is required when closing a QC issue.")
        return self


class RoomCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    type: str = Field(min_length=1, max_length=80)
    location: str | None = Field(default=None, max_length=240)
    capacity: int | None = Field(default=None, ge=1, le=10000)
    notes: str | None = Field(default=None, max_length=4000)


class RoomUpdateRequest(RoomCreateRequest):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    type: str | None = Field(default=None, min_length=1, max_length=80)

    @model_validator(mode="after")
    def at_least_one_change(self) -> RoomUpdateRequest:
        if not self.model_fields_set:
            raise ValueError("Provide at least one room change.")
        return self


class CateringRequestCreateRequest(BaseModel):
    booking_id: str | None = None
    work_order_id: str | None = None
    room_id: str
    request_type: str = Field(pattern="^(lunch|tea_coffee|snack)$")
    item: str = Field(min_length=1, max_length=240)
    quantity: int = Field(default=1, ge=1, le=100)
    requested_for: datetime | None = None
    notes: str | None = Field(default=None, max_length=2000)


class CateringRequestUpdateRequest(BaseModel):
    status: str = Field(pattern="^(requested|acknowledged|preparing|delivered|cancelled)$")
    actual_cost: Money | None = Field(default=None, ge=0)
    receipt_reference: str | None = Field(default=None, max_length=500)


class CateringSettingsUpdateRequest(BaseModel):
    markup_percent: MarkupPercentage = Field(ge=0, le=100)


class CurrencySettingsUpdateRequest(BaseModel):
    currency: str = Field(pattern="^(GBP|USD|EUR|CAD|AUD)$")


class InvoiceSettingsUpdateRequest(BaseModel):
    legal_name: str = Field(min_length=1, max_length=180)
    legal_address: str | None = Field(default=None, max_length=2000)
    billing_email: PostPilotEmail | None = None
    tax_enabled: bool = False
    tax_name: str = Field(min_length=1, max_length=40)
    tax_registration_number: str | None = Field(default=None, max_length=120)
    tax_rate_percent: Percentage = Field(ge=0, le=100)
    payment_terms_days: int = Field(ge=0, le=365)
    payment_instructions: str | None = Field(default=None, max_length=2000)


class SsoConnectionEnabledUpdateRequest(BaseModel):
    """Only toggles a tenant's preconfigured Entra connection.

    Directory identifiers and immutable user identity links are deliberately
    outside this settings form to prevent an administrator from remapping a
    user's Microsoft account.
    """

    model_config = ConfigDict(extra="forbid")

    enabled: bool


class RolePolicyRequest(BaseModel):
    role: str = Field(pattern="^[a-z0-9_]+$")
    label: str = Field(min_length=1, max_length=120)
    permissions: list[str] = Field(default_factory=list, max_length=20)


class RolePoliciesUpdateRequest(BaseModel):
    policies: list[RolePolicyRequest] = Field(min_length=1, max_length=100)


class OrganizationUserCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    email: PostPilotEmail
    password: str = Field(min_length=8, max_length=1024)
    person_role: str = Field(pattern="^[a-z0-9_]+$")
    membership_role: str = Field(pattern="^(owner|admin|member|client)$")


class OrganizationUserUpdateRequest(BaseModel):
    person_role: str = Field(pattern="^[a-z0-9_]+$")
    membership_role: str = Field(pattern="^(owner|admin|member|client)$")


class EpisodeTeamAddRequest(BaseModel):
    person_id: str


class EpisodeTeamSignerRequest(BaseModel):
    """Toggle the episode-team member nominated to sign off their own role."""

    assignment_id: str
    is_signer: bool


class WorkflowActionRequest(BaseModel):
    workflow_stage_id: str
    action: str = Field(pattern="^(start|start_early|submit|sign_off|block|resume)$")
    approval_rule_id: str | None = None
    comment: str | None = Field(default=None, max_length=2000)
    reason: str | None = Field(default=None, min_length=3, max_length=2000)


class BookingGuestAccountRequest(BaseModel):
    episode_id: str
    name: str = Field(min_length=1, max_length=160)
    email: PostPilotEmail
    password: str = Field(min_length=8, max_length=1024)


class CopyEpisodeBookingsRequest(BaseModel):
    source_episode_id: str
    target_episode_id: str
    starts_on: datetime

    @model_validator(mode="after")
    def source_and_target_differ(self) -> CopyEpisodeBookingsRequest:
        if self.source_episode_id == self.target_episode_id:
            raise ValueError("Choose a different target episode.")
        return self


class BookingConflictFlagRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)
