"""Fast checks for the Python-owned fixture contract without a database."""

from pathlib import Path

from app.demo_seed import (
    DEMO_BOOKINGS_PER_TENANT,
    DEMO_MANIFESTS_PER_TENANT,
    DEMO_WORK_ORDERS_PER_TENANT,
    STAGES,
    SUPPLEMENTAL_PEOPLE,
    TENANT_IDS,
    TENANTS,
    uid,
)


def test_demo_seed_preserves_the_documented_multi_tenant_fixture_shape() -> None:
    assert len(TENANT_IDS) == len(TENANTS) == 5
    assert sum(len(tenant["shows"]) for tenant in TENANTS) == 21
    assert sum(len(show[3]) for tenant in TENANTS for show in tenant["shows"]) == 84
    assert len(STAGES) == 22
    assert DEMO_BOOKINGS_PER_TENANT == 12
    assert DEMO_WORK_ORDERS_PER_TENANT == 8
    assert DEMO_MANIFESTS_PER_TENANT == 6


def test_demo_seed_keeps_stable_ids_used_by_browser_and_tenant_boundary_tests() -> None:
    assert uid(5, "25", 1) == "25500000-0000-4000-8000-000000000001"
    assert uid(5, "27", 1) == "27500000-0000-4000-8000-000000000001"


def test_demo_seed_uses_short_human_names_for_supplemental_debug_users() -> None:
    assert len(SUPPLEMENTAL_PEOPLE) == len(TENANTS)
    names = [name for roster in SUPPLEMENTAL_PEOPLE for name in roster.values()]
    assert all("Post" not in name and "Finish" not in name and "Editorial" not in name for name in names)


def test_demo_seed_marks_named_workflow_roles_as_episode_signers() -> None:
    """Seeded approvals must be actionable by their named episode-team person."""
    source = (Path(__file__).resolve().parents[1] / "app/demo_seed.py").read_text()

    assert "workflow_signer_roles = {stage[3] for stage in STAGES}" in source
    assert '"is_lead": role in workflow_signer_roles' in source
    assert "on_conflict_do_update" in source


def test_demo_seed_documents_transparent_cost_plans_and_linked_actual_sources() -> None:
    source = (Path(__file__).resolve().parents[1] / "app/demo_seed.py").read_text()

    for phrase in (
        "budget_specs = (",
        '"Edit suite"',
        '"Editorial artists"',
        '"VFX"',
        '"Colour"',
        '"Sound"',
        '"QC"',
        '"Delivery"',
        '"External vendors"',
        '"source_type": "booking"',
        '"source_type": "work_order"',
        'source_type="vendor_invoice"',
        "episode_budget_estimates",
        "episode_budget_estimate_items",
    ):
        assert phrase in source
