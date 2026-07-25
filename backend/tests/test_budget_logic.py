from decimal import Decimal
from types import SimpleNamespace

from app.budget_logic import can_commit_po, cost_totals


def test_budget_cost_rollup_keeps_po_commitments_out_of_actual_spend() -> None:
    totals = cost_totals(
        [
            SimpleNamespace(budgeted_amount=Decimal("120"), actual_amount=Decimal("90"), external_cost=False),
            SimpleNamespace(budgeted_amount=Decimal("300"), actual_amount=Decimal("0"), external_cost=True),
            SimpleNamespace(budgeted_amount=Decimal("0"), actual_amount=Decimal("280"), external_cost=True),
        ]
    )

    assert totals == {
        "estimated_amount": Decimal("420"),
        "actual_amount": Decimal("370"),
        "internal_estimated_amount": Decimal("120"),
        "internal_actual_amount": Decimal("90"),
        "external_estimated_amount": Decimal("300"),
        "external_actual_amount": Decimal("280"),
        "variance_amount": Decimal("-50"),
    }


def test_po_commitment_replacement_checks_only_the_net_change() -> None:
    assert can_commit_po(
        approved_amount=Decimal("1000"),
        existing_committed=Decimal("1050"),
        replacing_amount=Decimal("200"),
        next_amount=Decimal("120"),
    ) == Decimal("0")
    assert can_commit_po(
        approved_amount=Decimal("1000"),
        existing_committed=Decimal("900"),
        replacing_amount=Decimal("200"),
        next_amount=Decimal("450"),
    ) == Decimal("150")
