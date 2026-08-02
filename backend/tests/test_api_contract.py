from __future__ import annotations

from app.api.routes.auth import session_response
from app.auth import Actor, Membership
from app.config import get_settings


def test_api_exposes_core_tenant_scoped_routes(monkeypatch) -> None:
    monkeypatch.setenv("POSTPILOT_DATABASE_URL", "postgresql://postpilot:postpilot@localhost:5432/postpilot")
    monkeypatch.setenv("POSTPILOT_SESSION_SECRET", "a-long-enough-test-session-secret-value")
    get_settings.cache_clear()
    # `app.main` intentionally creates the production ASGI application at
    # module import, so defer importing it until this test configures settings.
    from app.main import create_app

    paths = create_app().openapi()["paths"]

    assert "/v1/auth/sign-in" in paths
    assert "/v1/auth/microsoft/exchange" in paths
    assert "/v1/auth/microsoft/link" in paths
    assert "/v1/auth/change-password" in paths
    assert not any("otp" in path.lower() or "magic" in path.lower() for path in paths)
    assert "/v1/organizations/active" in paths
    assert "/v1/organizations/active-show" not in paths
    assert "/v1/dashboard" in paths
    assert "/v1/approvals" in paths
    assert "/v1/bookings" in paths
    assert "/v1/bookings/resources" in paths
    assert "/v1/bookings/conflicts" in paths
    assert "/v1/bookings/{booking_id}" in paths
    assert "/v1/bookings/{booking_id}/time-submissions" in paths
    assert "/v1/budget/lines" in paths
    assert "/v1/budget/options" in paths
    assert "/v1/budget/lines/{budget_line_id}" in paths
    assert "/v1/budget/episodes/{episode_id}/summary" in paths
    assert "/v1/budget/shows/{show_id}/summary" in paths
    assert "/v1/billing/episodes/{episode_id}/readiness" in paths
    assert "/v1/billing/work-order-charges" in paths
    assert "/v1/billing/work-orders/{work_order_id}/billables" in paths
    assert "/v1/billing/invoices" in paths
    assert "/v1/billing/invoices/{invoice_id}/export-readiness" in paths
    assert "/v1/billing/invoices/{invoice_id}/export" in paths
    assert "/v1/rate-cards/services" in paths
    assert "/v1/rate-cards/services/{service_rate_id}" in paths
    assert "/v1/rate-cards" in paths
    assert "/v1/rate-cards/overrides" in paths
    assert "/v1/rate-cards/items/{item_id}" in paths
    assert "/v1/rate-cards/effective" in paths
    assert "/v1/client-purchase-orders" in paths
    assert "/v1/client-purchase-orders/{client_purchase_order_id}" in paths
    assert "/v1/client-purchase-orders/{client_purchase_order_id}/allocations" in paths
    assert "/v1/crm/companies" in paths
    assert "/v1/crm/workspace" in paths
    assert "/v1/crm/companies/{company_id}" in paths
    assert "/v1/crm/contacts" in paths
    assert "/v1/crm/contacts/{contact_id}" in paths
    assert "/v1/crm/shows/{show_id}/contacts" in paths
    assert "/v1/crm/shows/{show_id}/contacts/{show_contact_id}" in paths
    assert "/v1/crm/accounts/{company_id}" in paths
    assert "/v1/work-orders" in paths
    assert "/v1/work-orders/inbox" in paths
    assert "/v1/work-orders/{work_order_id}" in paths
    assert "/v1/work-orders/{work_order_id}/booking" in paths
    assert "/v1/purchase-orders" in paths
    assert "/v1/purchase-orders/{purchase_order_id}" in paths
    assert "/v1/purchase-orders/{purchase_order_id}/allocations" in paths
    assert "/v1/purchase-orders/{purchase_order_id}/actual-costs" in paths
    assert "/v1/vendor-invoices" in paths
    assert "/v1/delivery-profiles" in paths
    assert "/v1/deliveries" in paths
    assert "/v1/delivery-profiles/{profile_id}" in paths
    assert "/v1/delivery-profiles/{profile_id}/items" in paths
    assert "/v1/delivery-profiles/{profile_id}/items/{item_id}" in paths
    assert "/v1/episodes/{episode_id}/delivery-manifest/apply" in paths
    assert "/v1/episodes/{episode_id}/delivery-acceptance-exception" in paths
    assert "/v1/episodes/{episode_id}/delivery-recipients" in paths
    assert "/v1/episodes/{episode_id}/delivery-items" in paths
    assert "/v1/episodes/{episode_id}/delivery-items/{item_id}" in paths
    assert "/v1/episodes/{episode_id}/delivery-items/{item_id}/transition" in paths
    assert "/v1/episodes/{episode_id}/delivery-manifest/shared" in paths
    assert "/v1/qc-reports" in paths
    assert "/v1/qc-issues" in paths
    assert "/v1/qc-issues/{issue_id}" in paths
    assert "/v1/shows" in paths
    assert "/v1/shows/options/form" in paths
    assert "/v1/shows/{show_id}/workspace" in paths
    assert "/v1/episodes" in paths
    assert "/v1/episodes/seasons/{season_id}/last-episode-team" in paths
    assert "/v1/episodes/{episode_id}/team" in paths
    assert "/v1/episodes/{episode_id}/workspace" in paths
    assert "/v1/episodes/{episode_id}/access" in paths
    assert "/v1/catering-requests" in paths
    assert "/v1/catering/resources" in paths
    assert "/v1/settings/bootstrap" in paths
    assert "/v1/settings/sso" in paths
    assert "/v1/settings/sso/connection" in paths

    get_settings.cache_clear()


def test_microsoft_exchange_is_disabled_by_default(monkeypatch) -> None:
    monkeypatch.setenv("POSTPILOT_DATABASE_URL", "postgresql://postpilot:postpilot@localhost:5432/postpilot")
    monkeypatch.setenv("POSTPILOT_SESSION_SECRET", "a-long-enough-test-session-secret-value")
    monkeypatch.delenv("POSTPILOT_MICROSOFT_SSO_ENABLED", raising=False)
    get_settings.cache_clear()
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app()) as client:
        response = client.post("/v1/auth/microsoft/exchange", headers={"Authorization": "Bearer untrusted"})

    assert response.status_code == 503
    assert response.json() == {"detail": "Microsoft SSO is not enabled."}
    get_settings.cache_clear()


def test_session_contract_contains_resolved_capabilities(monkeypatch) -> None:
    monkeypatch.setenv("POSTPILOT_DATABASE_URL", "postgresql://postpilot:postpilot@localhost:5432/postpilot")
    monkeypatch.setenv("POSTPILOT_SESSION_SECRET", "a-long-enough-test-session-secret-value")
    get_settings.cache_clear()
    membership = Membership(
        organization_id="00000000-0000-4000-8000-000000000001",
        organization_name="Copperline Post",
        organization_slug="copperline-post",
        currency="GBP",
        role="member",
    )
    response = session_response(
        Actor(
            session_token_hash="hash",
            authenticated_user_id="user_1",
            user_id="user_1",
            user_name="Maya Ortiz",
            memberships=[membership],
            active_organization=membership,
            person_id="00000000-0000-4000-8000-000000000101",
            person_name="Maya Ortiz",
            person_role="post_supervisor",
            permissions=frozenset({"manage_production", "sign_off_work"}),
        )
    )

    assert response.active_organization_id == membership.organization_id
    assert response.permissions == ["manage_production", "sign_off_work"]
    assert not response.debug_can_switch

    get_settings.cache_clear()
