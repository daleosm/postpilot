"""Shared pytest fixtures for FastAPI integration modules."""

# The production lab owns a fully tenant-isolated PostgreSQL fixture. Loading
# it as a plugin lets feature-specific test modules share that fixture without
# treating another test file as an application dependency.
pytest_plugins = ("test_production_api_integration",)
