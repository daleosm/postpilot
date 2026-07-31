"""Shared pytest fixtures and test-layer classification."""

from __future__ import annotations

from pathlib import Path

import pytest

# The production lab owns a fully tenant-isolated PostgreSQL fixture. Loading
# it as a plugin lets feature-specific test modules share that fixture without
# treating another test file as an application dependency.
pytest_plugins = ("test_production_api_integration",)


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Keep test selection explicit without moving the established suite.

    Existing focused tests stay where they are, while CI can consistently use
    ``-m unit``, ``-m api_integration`` or ``-m golden_ledger``. Golden tests
    are API integration tests too, but retain their own fast-fail selector.
    """
    for item in items:
        path = Path(str(item.fspath))
        if "golden" in path.parts:
            item.add_marker(pytest.mark.golden_ledger)
            item.add_marker(pytest.mark.api_integration)
        elif path.name.endswith("_api_integration.py") or path.name in {
            "test_db_smoke.py",
            "test_seeded_api_integration.py",
        }:
            item.add_marker(pytest.mark.api_integration)
        else:
            item.add_marker(pytest.mark.unit)
