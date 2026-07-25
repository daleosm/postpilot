import pytest
from pydantic import ValidationError

from app.api.schemas import BudgetLineCreateRequest, BudgetLineUpdateRequest


def test_budget_line_schema_rejects_browser_calculated_totals_and_invalid_po_combinations() -> None:
    with pytest.raises(ValidationError):
        BudgetLineCreateRequest(
            episode_id="episode-1",
            category="Online suite",
            browser_total=999,
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
