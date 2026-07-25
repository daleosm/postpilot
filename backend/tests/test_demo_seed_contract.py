"""Fast checks for the Python-owned fixture contract without a database."""

from app.demo_seed import STAGES, TENANT_IDS, TENANTS, uid


def test_demo_seed_preserves_the_documented_multi_tenant_fixture_shape() -> None:
    assert len(TENANT_IDS) == len(TENANTS) == 5
    assert sum(len(tenant["shows"]) for tenant in TENANTS) == 21
    assert sum(len(show[3]) for tenant in TENANTS for show in tenant["shows"]) == 84
    assert len(STAGES) == 22


def test_demo_seed_keeps_stable_ids_used_by_browser_and_tenant_boundary_tests() -> None:
    assert uid(5, "25", 1) == "25500000-0000-4000-8000-000000000001"
    assert uid(5, "27", 1) == "27500000-0000-4000-8000-000000000001"
