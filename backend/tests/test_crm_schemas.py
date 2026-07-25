import pytest
from pydantic import ValidationError

from app.api.schemas import (
    CrmCompanyCreateRequest,
    CrmCompanyUpdateRequest,
    CrmContactCreateRequest,
    ShowContactCreateRequest,
)


def test_crm_company_validates_tenant_account_fields_without_a_browser_currency() -> None:
    account = CrmCompanyCreateRequest(
        name="Northstar Network",
        type="network",
        finance_email="finance@northstar.example",
        payment_terms_days=30,
    )
    assert account.type == "network"
    with pytest.raises(ValidationError):
        CrmCompanyCreateRequest(name="Not a real type", type="supplier")
    with pytest.raises(ValidationError):
        CrmCompanyCreateRequest(name="Not a supplier", type="client", is_preferred_supplier=True)
    with pytest.raises(ValidationError):
        CrmCompanyUpdateRequest()


def test_crm_contact_and_show_contact_use_operational_types() -> None:
    contact = CrmContactCreateRequest(
        company_id="company-1",
        name="Taylor Quinn",
        contact_type="technical_delivery",
        email="delivery@northstar.example",
    )
    assignment = ShowContactCreateRequest(
        contact_id="contact-1",
        responsibility="delivery_qc",
        relationship="Network delivery lead",
    )
    assert contact.contact_type == "technical_delivery"
    assert assignment.responsibility == "delivery_qc"
    with pytest.raises(ValidationError):
        ShowContactCreateRequest(contact_id="contact-1", responsibility="vendor_contact", relationship="Nope")
