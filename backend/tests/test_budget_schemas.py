import pytest
from pydantic import ValidationError

from app.api.schemas import BudgetLineCreateRequest, BudgetLineUpdateRequest


def test_budget_line_schema_rejects_browser_actual_totals_and_invalid_po_combinations() -> None:
    with pytest.raises(ValidationError):
        BudgetLineCreateRequest(
            episode_id="episode-1",
            category="Online suite",
            actual_amount=999,
        )
    with pytest.raises(ValidationError, match="Only external-cost"):
        BudgetLineCreateRequest(
            episode_id="episode-1",
            category="Internal work",
            purchase_order_id="po-1",
            budgeted_amount=100,
        )
    with pytest.raises(ValidationError, match="positive estimate"):
        BudgetLineCreateRequest(
            episode_id="episode-1",
            category="Vendor work",
            external_cost=True,
            purchase_order_id="po-1",
            budgeted_amount=0,
        )


def test_budget_line_update_requires_a_real_change() -> None:
    with pytest.raises(ValidationError, match="Provide at least one"):
        BudgetLineUpdateRequest()
    with pytest.raises(ValidationError, match="Provide at least one"):
        BudgetLineUpdateRequest(overrun_reason="This is not a change by itself.")


def test_budget_line_schema_accepts_server_resolved_planned_estimate_inputs() -> None:
    line = BudgetLineCreateRequest(
        episode_id="episode-1",
        category="Sound",
        planned_quantity=2,
        planned_unit="day",
        rate_resource_type="service",
        rate_resource_id="service-1",
        estimate_status="approved",
    )
    assert line.planned_quantity == 2
    assert line.rate_resource_type == "service"

    with pytest.raises(ValidationError, match="planned quantity"):
        BudgetLineCreateRequest(
            episode_id="episode-1",
            category="Sound",
            rate_resource_type="service",
            rate_resource_id="service-1",
        )
