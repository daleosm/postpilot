"""Tenant-scoped CRM accounts for clients, networks, studios, and vendors.

CRM is an internal commercial workspace.  External client users do not receive
these account views: they use the narrowly scoped approvals and deliveries APIs
instead, which avoids exposing supplier procurement and facility commercial data.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import and_, delete, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentActor, DbSession
from app.api.schemas import (
    CrmCompanyCreateRequest,
    CrmCompanyUpdateRequest,
    CrmContactCreateRequest,
    CrmContactUpdateRequest,
    ShowContactCreateRequest,
    ShowContactUpdateRequest,
)
from app.auth import require_permission
from app.budget_logic import decimal_amount, json_safe, monetary
from app.client_purchase_order_logic import client_po_balances
from app.db.tables import (
    activity_log,
    billables,
    budget_lines,
    client_purchase_order_allocations,
    client_purchase_orders,
    crm_companies,
    crm_contacts,
    episodes,
    people,
    post_work_orders,
    purchase_order_allocations,
    purchase_orders,
    seasons,
    show_contacts,
    shows,
    vendor_invoices,
)
from app.purchase_order_logic import balance_snapshot

router = APIRouter(prefix="/crm", tags=["crm"])

_CLIENT_ACCOUNT_TYPES = {"client", "network", "studio", "production_company"}
_SHOW_CONTACT_TYPES = {
    "creative_approvals": {"general", "creative_approval", "client_review"},
    "delivery_qc": {"general", "technical_delivery", "client_review"},
    "finance_billing": {"general", "finance"},
    "legal_compliance": {"general", "legal"},
}


async def _require_crm_access(session: DbSession, actor: CurrentActor) -> None:
    """CRM data is internal; capability policies, not account titles, grant it."""
    await require_permission(session, actor, "manage_commercial")


async def _audit(
    session: DbSession,
    actor: CurrentActor,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    metadata: dict[str, object],
) -> None:
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            metadata=json_safe(metadata),
        )
    )


async def _company_or_404(session: DbSession, actor: CurrentActor, company_id: str, *, lock: bool = False) -> object:
    statement = select(crm_companies).where(
        and_(crm_companies.c.id == company_id, crm_companies.c.organization_id == actor.organization_id)
    )
    if lock:
        statement = statement.with_for_update()
    company = (await session.execute(statement.limit(1))).first()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CRM account not found.")
    return company


async def _contact_or_404(session: DbSession, actor: CurrentActor, contact_id: str, *, lock: bool = False) -> object:
    statement = (
        select(
            crm_contacts,
            crm_companies.c.name.label("company_name"),
            crm_companies.c.type.label("company_type"),
        )
        .select_from(crm_contacts)
        .join(
            crm_companies,
            and_(
                crm_companies.c.id == crm_contacts.c.company_id,
                crm_companies.c.organization_id == actor.organization_id,
            ),
        )
        .where(and_(crm_contacts.c.id == contact_id, crm_contacts.c.organization_id == actor.organization_id))
    )
    if lock:
        statement = statement.with_for_update()
    contact = (await session.execute(statement.limit(1))).first()
    if not contact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CRM contact not found.")
    return contact


async def _show_or_404(session: DbSession, actor: CurrentActor, show_id: str) -> object:
    show = (
        await session.execute(
            select(shows).where(and_(shows.c.id == show_id, shows.c.organization_id == actor.organization_id)).limit(1)
        )
    ).first()
    if not show:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Show not found.")
    return show


def _clean(value: str | None) -> str | None:
    return value.strip() if value and value.strip() else None


def _company_value(company: object) -> dict[str, object]:
    return {
        "id": str(company.id),
        "name": company.name,
        "type": company.type,
        "address": company.address,
        "service_category": company.service_category,
        "is_preferred_supplier": company.is_preferred_supplier,
        "payment_terms_days": company.payment_terms_days,
        "currency": company.currency,
        "finance_email": company.finance_email,
        "billing_email": company.billing_email,
        "account_status": company.account_status,
        "booking_clearance": company.booking_clearance,
        "account_owner_id": str(company.account_owner_id) if company.account_owner_id else None,
        "next_action": company.next_action,
        "next_action_due_at": company.next_action_due_at,
        "notes": company.notes,
        "created_at": company.created_at,
        "updated_at": company.updated_at,
    }


def _contact_value(contact: object) -> dict[str, object]:
    return {
        "id": str(contact.id),
        "company_id": str(contact.company_id),
        "company_name": getattr(contact, "company_name", None),
        "company_type": getattr(contact, "company_type", None),
        "name": contact.name,
        "title": contact.title,
        "email": contact.email,
        "phone": contact.phone,
        "contact_type": contact.contact_type,
        "is_primary": contact.is_primary,
        "notes": contact.notes,
        "created_at": contact.created_at,
        "updated_at": contact.updated_at,
    }


async def _validate_account_owner(session: DbSession, actor: CurrentActor, person_id: str | None) -> None:
    if not person_id:
        return
    person = (
        await session.execute(
            select(people.c.id).where(and_(people.c.id == person_id, people.c.organization_id == actor.organization_id))
        )
    ).first()
    if not person:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account owner not found.")


async def _validate_show_contact(
    session: DbSession,
    actor: CurrentActor,
    *,
    show: object,
    contact: object,
    responsibility: str,
) -> None:
    """Keep named show routes relevant to the show's actual client side."""
    if contact.company_type == "vendor":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Vendor contacts cannot be assigned as show contacts."
        )
    eligible_company = str(contact.company_id) in {
        str(company_id) for company_id in (show.client_company_id, show.production_company_id) if company_id
    }
    if not eligible_company and contact.company_type not in {"network", "studio"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Choose a contact from this show's client/production company, network, or studio.",
        )
    if contact.contact_type not in _SHOW_CONTACT_TYPES[responsibility]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This contact type is not suitable for the selected show responsibility.",
        )


async def _validate_contact_assignments(
    session: DbSession, actor: CurrentActor, contact: object, *, contact_type: str
) -> None:
    """Prevent an edit from silently invalidating existing show contact routes."""
    assignments = (
        await session.execute(
            select(show_contacts.c.responsibility, shows)
            .select_from(show_contacts)
            .join(shows, and_(shows.c.id == show_contacts.c.show_id, shows.c.organization_id == actor.organization_id))
            .where(
                and_(
                    show_contacts.c.organization_id == actor.organization_id,
                    show_contacts.c.contact_id == contact.id,
                )
            )
        )
    ).all()
    shadow = SimpleNamespace(
        company_id=contact.company_id,
        company_type=contact.company_type,
        contact_type=contact_type,
    )
    for assignment in assignments:
        await _validate_show_contact(
            session,
            actor,
            show=assignment,
            contact=shadow,
            responsibility=assignment.responsibility,
        )


@router.get("/companies")
async def list_companies(
    actor: CurrentActor, session: DbSession, company_type: str | None = Query(default=None)
) -> dict[str, object]:
    await _require_crm_access(session, actor)
    if company_type and company_type not in _CLIENT_ACCOUNT_TYPES | {"vendor"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid CRM company type.")
    conditions = [crm_companies.c.organization_id == actor.organization_id]
    if company_type:
        conditions.append(crm_companies.c.type == company_type)
    companies = (
        await session.execute(
            select(crm_companies).where(and_(*conditions)).order_by(crm_companies.c.name, crm_companies.c.id)
        )
    ).all()
    return {"companies": [_company_value(company) for company in companies]}


@router.get("/workspace")
async def crm_workspace(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """Compact account-directory projection used by the CRM landing page."""
    await _require_crm_access(session, actor)
    company_rows = (
        await session.execute(
            select(crm_companies)
            .where(crm_companies.c.organization_id == actor.organization_id)
            .order_by(crm_companies.c.name, crm_companies.c.id)
        )
    ).all()
    contact_rows = (
        await session.execute(
            select(
                crm_contacts,
                crm_companies.c.name.label("company_name"),
                crm_companies.c.type.label("company_type"),
            )
            .join(
                crm_companies,
                and_(
                    crm_companies.c.id == crm_contacts.c.company_id,
                    crm_companies.c.organization_id == actor.organization_id,
                ),
            )
            .where(crm_contacts.c.organization_id == actor.organization_id)
            .order_by(crm_contacts.c.name, crm_contacts.c.id)
        )
    ).all()
    show_rows = (
        await session.execute(
            select(shows.c.id, shows.c.client_company_id, shows.c.production_company_id).where(
                shows.c.organization_id == actor.organization_id
            )
        )
    ).all()
    owner_rows = (
        await session.execute(
            select(people.c.id, people.c.name)
            .where(and_(people.c.organization_id == actor.organization_id, people.c.is_active.is_(True)))
            .order_by(people.c.name, people.c.id)
        )
    ).all()
    work_order_rows = (
        await session.execute(
            select(
                post_work_orders.c.id,
                post_work_orders.c.vendor_company_id,
                post_work_orders.c.title,
                post_work_orders.c.status,
                post_work_orders.c.due_at,
                episodes.c.title.label("episode_title"),
                episodes.c.number.label("episode_number"),
            )
            .join(
                episodes,
                and_(
                    episodes.c.id == post_work_orders.c.episode_id,
                    episodes.c.organization_id == actor.organization_id,
                ),
            )
            .where(post_work_orders.c.organization_id == actor.organization_id)
            .order_by(post_work_orders.c.due_at.asc().nulls_last(), post_work_orders.c.id)
        )
    ).all()
    return {
        "companies": [_company_value(row) for row in company_rows],
        "contacts": [_contact_value(row) for row in contact_rows],
        "show_links": [
            {
                "id": str(row.id),
                "client_company_id": str(row.client_company_id) if row.client_company_id else None,
                "production_company_id": str(row.production_company_id) if row.production_company_id else None,
            }
            for row in show_rows
        ],
        "owners": [{"id": str(row.id), "name": row.name} for row in owner_rows],
        "work_orders": [
            {
                "id": str(row.id),
                "vendor_company_id": str(row.vendor_company_id) if row.vendor_company_id else None,
                "title": row.title,
                "status": row.status,
                "due_at": row.due_at,
                "episode_title": row.episode_title,
                "episode_number": row.episode_number,
            }
            for row in work_order_rows
        ],
    }


@router.post("/companies", status_code=status.HTTP_201_CREATED)
async def create_company(
    payload: CrmCompanyCreateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await _require_crm_access(session, actor)
    await _validate_account_owner(session, actor, payload.account_owner_id)
    now = datetime.now(UTC)
    try:
        created = await session.execute(
            insert(crm_companies)
            .values(
                organization_id=actor.organization_id,
                name=payload.name.strip(),
                type=payload.type,
                address=_clean(payload.address),
                service_category=_clean(payload.service_category),
                is_preferred_supplier=payload.is_preferred_supplier if payload.type == "vendor" else False,
                payment_terms_days=payload.payment_terms_days,
                currency=actor.active_organization.currency,
                finance_email=str(payload.finance_email) if payload.finance_email else None,
                billing_email=str(payload.billing_email) if payload.billing_email else None,
                account_status=payload.account_status,
                booking_clearance=payload.booking_clearance,
                account_owner_id=payload.account_owner_id,
                next_action=_clean(payload.next_action),
                next_action_due_at=payload.next_action_due_at,
                notes=_clean(payload.notes),
                created_at=now,
                updated_at=now,
            )
            .returning(crm_companies)
        )
        company = created.one()
        await _audit(
            session,
            actor,
            action="crm_company.created",
            entity_type="crm_company",
            entity_id=str(company.id),
            metadata={"name": company.name, "type": company.type},
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this name already exists in this post house.",
        ) from error
    return _company_value(company)


@router.get("/companies/{company_id}")
async def get_company(company_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await _require_crm_access(session, actor)
    return _company_value(await _company_or_404(session, actor, company_id))


@router.patch("/companies/{company_id}")
async def update_company(
    company_id: str, payload: CrmCompanyUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await _require_crm_access(session, actor)
    company = await _company_or_404(session, actor, company_id, lock=True)
    if company.type != "vendor" and payload.is_preferred_supplier:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Preferred-supplier status is only available for vendor accounts.",
        )
    if "account_owner_id" in payload.model_fields_set:
        await _validate_account_owner(session, actor, payload.account_owner_id)
    values = payload.model_dump(exclude_unset=True)
    for name in ("address", "service_category", "next_action", "notes"):
        if name in values:
            values[name] = _clean(values[name])
    for name in ("finance_email", "billing_email"):
        if name in values and values[name] is not None:
            values[name] = str(values[name])
    values["updated_at"] = datetime.now(UTC)
    try:
        changed = await session.execute(
            update(crm_companies)
            .where(and_(crm_companies.c.id == company_id, crm_companies.c.organization_id == actor.organization_id))
            .values(**values)
            .returning(crm_companies)
        )
        updated = changed.one()
        await _audit(
            session,
            actor,
            action="crm_company.updated",
            entity_type="crm_company",
            entity_id=company_id,
            metadata={"fields": sorted(payload.model_fields_set), "name": company.name},
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this name already exists in this post house.",
        ) from error
    return _company_value(updated)


@router.get("/contacts")
async def list_contacts(
    actor: CurrentActor, session: DbSession, company_id: str | None = Query(default=None)
) -> dict[str, object]:
    await _require_crm_access(session, actor)
    if company_id:
        await _company_or_404(session, actor, company_id)
    conditions = [crm_contacts.c.organization_id == actor.organization_id]
    if company_id:
        conditions.append(crm_contacts.c.company_id == company_id)
    contacts = (
        await session.execute(
            select(
                crm_contacts,
                crm_companies.c.name.label("company_name"),
                crm_companies.c.type.label("company_type"),
            )
            .select_from(crm_contacts)
            .join(
                crm_companies,
                and_(
                    crm_companies.c.id == crm_contacts.c.company_id,
                    crm_companies.c.organization_id == actor.organization_id,
                ),
            )
            .where(and_(*conditions))
            .order_by(crm_companies.c.name, crm_contacts.c.contact_type, crm_contacts.c.name, crm_contacts.c.id)
        )
    ).all()
    return {"contacts": [_contact_value(contact) for contact in contacts]}


@router.post("/contacts", status_code=status.HTTP_201_CREATED)
async def create_contact(
    payload: CrmContactCreateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await _require_crm_access(session, actor)
    await _company_or_404(session, actor, payload.company_id)
    now = datetime.now(UTC)
    created = await session.execute(
        insert(crm_contacts)
        .values(
            organization_id=actor.organization_id,
            company_id=payload.company_id,
            name=payload.name.strip(),
            title=_clean(payload.title),
            email=str(payload.email) if payload.email else None,
            phone=_clean(payload.phone),
            contact_type=payload.contact_type,
            is_primary=payload.is_primary,
            notes=_clean(payload.notes),
            created_at=now,
            updated_at=now,
        )
        .returning(crm_contacts)
    )
    contact = created.one()
    await _audit(
        session,
        actor,
        action="crm_contact.created",
        entity_type="crm_contact",
        entity_id=str(contact.id),
        metadata={"companyId": payload.company_id, "contactType": contact.contact_type},
    )
    await session.commit()
    return _contact_value(contact)


@router.patch("/contacts/{contact_id}")
async def update_contact(
    contact_id: str, payload: CrmContactUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await _require_crm_access(session, actor)
    contact = await _contact_or_404(session, actor, contact_id, lock=True)
    next_type = payload.contact_type or contact.contact_type
    await _validate_contact_assignments(session, actor, contact, contact_type=next_type)
    values = payload.model_dump(exclude_unset=True)
    for name in ("title", "phone", "notes"):
        if name in values:
            values[name] = _clean(values[name])
    if "email" in values and values["email"] is not None:
        values["email"] = str(values["email"])
    values["updated_at"] = datetime.now(UTC)
    changed = await session.execute(
        update(crm_contacts)
        .where(and_(crm_contacts.c.id == contact_id, crm_contacts.c.organization_id == actor.organization_id))
        .values(**values)
        .returning(crm_contacts)
    )
    updated = changed.one()
    await _audit(
        session,
        actor,
        action="crm_contact.updated",
        entity_type="crm_contact",
        entity_id=contact_id,
        metadata={"companyId": str(contact.company_id), "fields": sorted(payload.model_fields_set)},
    )
    await session.commit()
    return _contact_value(updated)


@router.get("/shows/{show_id}/contacts")
async def list_show_contacts(show_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await _require_crm_access(session, actor)
    await _show_or_404(session, actor, show_id)
    rows = (
        await session.execute(
            select(
                show_contacts,
                crm_contacts.c.name.label("contact_name"),
                crm_contacts.c.title.label("contact_title"),
                crm_contacts.c.email.label("contact_email"),
                crm_contacts.c.contact_type,
                crm_companies.c.id.label("company_id"),
                crm_companies.c.name.label("company_name"),
                crm_companies.c.type.label("company_type"),
            )
            .select_from(show_contacts)
            .join(
                crm_contacts,
                and_(
                    crm_contacts.c.id == show_contacts.c.contact_id,
                    crm_contacts.c.organization_id == actor.organization_id,
                ),
            )
            .join(
                crm_companies,
                and_(
                    crm_companies.c.id == crm_contacts.c.company_id,
                    crm_companies.c.organization_id == actor.organization_id,
                ),
            )
            .where(and_(show_contacts.c.organization_id == actor.organization_id, show_contacts.c.show_id == show_id))
            .order_by(show_contacts.c.responsibility, crm_companies.c.name, crm_contacts.c.name)
        )
    ).all()
    return {
        "show_contacts": [
            {
                "id": str(row.id),
                "show_id": str(row.show_id),
                "contact_id": str(row.contact_id),
                "contact_name": row.contact_name,
                "contact_title": row.contact_title,
                "contact_email": row.contact_email,
                "contact_type": row.contact_type,
                "company_id": str(row.company_id),
                "company_name": row.company_name,
                "company_type": row.company_type,
                "responsibility": row.responsibility,
                "relationship": row.relationship,
                "is_approval_contact": row.is_approval_contact,
            }
            for row in rows
        ]
    }


@router.post("/shows/{show_id}/contacts", status_code=status.HTTP_201_CREATED)
async def assign_show_contact(
    show_id: str, payload: ShowContactCreateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await _require_crm_access(session, actor)
    show = await _show_or_404(session, actor, show_id)
    contact = await _contact_or_404(session, actor, payload.contact_id)
    await _validate_show_contact(session, actor, show=show, contact=contact, responsibility=payload.responsibility)
    now = datetime.now(UTC)
    try:
        created = await session.execute(
            insert(show_contacts)
            .values(
                organization_id=actor.organization_id,
                show_id=show_id,
                contact_id=payload.contact_id,
                responsibility=payload.responsibility,
                relationship=payload.relationship.strip(),
                is_approval_contact=payload.is_approval_contact,
                created_at=now,
                updated_at=now,
            )
            .returning(show_contacts)
        )
        assignment = created.one()
        await _audit(
            session,
            actor,
            action="show_contact.assigned",
            entity_type="show_contact",
            entity_id=str(assignment.id),
            metadata={"showId": show_id, "contactId": payload.contact_id, "responsibility": payload.responsibility},
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This contact or responsibility is already assigned to the show.",
        ) from error
    return {
        "id": str(assignment.id),
        "show_id": show_id,
        "contact_id": payload.contact_id,
        "responsibility": assignment.responsibility,
        "relationship": assignment.relationship,
        "is_approval_contact": assignment.is_approval_contact,
    }


@router.patch("/shows/{show_id}/contacts/{show_contact_id}")
async def update_show_contact(
    show_id: str,
    show_contact_id: str,
    payload: ShowContactUpdateRequest,
    actor: CurrentActor,
    session: DbSession,
) -> dict[str, object]:
    await _require_crm_access(session, actor)
    show = await _show_or_404(session, actor, show_id)
    assignment = (
        await session.execute(
            select(show_contacts)
            .where(
                and_(
                    show_contacts.c.id == show_contact_id,
                    show_contacts.c.show_id == show_id,
                    show_contacts.c.organization_id == actor.organization_id,
                )
            )
            .with_for_update()
            .limit(1)
        )
    ).first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Show contact not found.")
    contact = await _contact_or_404(session, actor, str(assignment.contact_id))
    responsibility = payload.responsibility or assignment.responsibility
    await _validate_show_contact(session, actor, show=show, contact=contact, responsibility=responsibility)
    values = payload.model_dump(exclude_unset=True)
    if "relationship" in values:
        values["relationship"] = values["relationship"].strip()
    values["updated_at"] = datetime.now(UTC)
    try:
        changed = await session.execute(
            update(show_contacts)
            .where(
                and_(show_contacts.c.id == show_contact_id, show_contacts.c.organization_id == actor.organization_id)
            )
            .values(**values)
            .returning(show_contacts)
        )
        updated = changed.one()
        await _audit(
            session,
            actor,
            action="show_contact.updated",
            entity_type="show_contact",
            entity_id=show_contact_id,
            metadata={"showId": show_id, "fields": sorted(payload.model_fields_set)},
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That responsibility is already assigned to another show contact.",
        ) from error
    return {
        "id": str(updated.id),
        "show_id": show_id,
        "contact_id": str(updated.contact_id),
        "responsibility": updated.responsibility,
        "relationship": updated.relationship,
        "is_approval_contact": updated.is_approval_contact,
    }


@router.delete("/shows/{show_id}/contacts/{show_contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_show_contact(show_id: str, show_contact_id: str, actor: CurrentActor, session: DbSession) -> None:
    await _require_crm_access(session, actor)
    await _show_or_404(session, actor, show_id)
    removed = await session.execute(
        delete(show_contacts)
        .where(
            and_(
                show_contacts.c.id == show_contact_id,
                show_contacts.c.show_id == show_id,
                show_contacts.c.organization_id == actor.organization_id,
            )
        )
        .returning(show_contacts.c.id)
    )
    if not removed.first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Show contact not found.")
    await _audit(
        session,
        actor,
        action="show_contact.removed",
        entity_type="show_contact",
        entity_id=show_contact_id,
        metadata={"showId": show_id},
    )
    await session.commit()


async def _related_shows(session: DbSession, actor: CurrentActor, company_id: str) -> list[object]:
    return (
        await session.execute(
            select(shows)
            .where(
                and_(
                    shows.c.organization_id == actor.organization_id,
                    or_(shows.c.client_company_id == company_id, shows.c.production_company_id == company_id),
                )
            )
            .order_by(shows.c.title, shows.c.id)
        )
    ).all()


async def _show_activity_counts(session: DbSession, actor: CurrentActor, show_ids: list[str]) -> dict[str, int]:
    if not show_ids:
        return {}
    rows = (
        await session.execute(
            select(seasons.c.show_id, func.count(episodes.c.id).label("active_episode_count"))
            .select_from(episodes)
            .join(
                seasons, and_(seasons.c.id == episodes.c.season_id, seasons.c.organization_id == actor.organization_id)
            )
            .where(
                and_(
                    episodes.c.organization_id == actor.organization_id,
                    seasons.c.show_id.in_(show_ids),
                    episodes.c.workflow_status != "complete",
                )
            )
            .group_by(seasons.c.show_id)
        )
    ).all()
    return {str(row.show_id): int(row.active_episode_count) for row in rows}


async def _client_po_snapshots(session: DbSession, actor: CurrentActor, company_id: str) -> list[dict[str, object]]:
    orders = (
        await session.execute(
            select(client_purchase_orders)
            .where(
                and_(
                    client_purchase_orders.c.organization_id == actor.organization_id,
                    client_purchase_orders.c.client_company_id == company_id,
                )
            )
            .order_by(client_purchase_orders.c.expiry_date, client_purchase_orders.c.po_number)
        )
    ).all()
    if not orders:
        return []
    allocations = (
        await session.execute(
            select(client_purchase_order_allocations).where(
                and_(
                    client_purchase_order_allocations.c.organization_id == actor.organization_id,
                    client_purchase_order_allocations.c.client_purchase_order_id.in_([order.id for order in orders]),
                )
            )
        )
    ).all()
    allocation_map: dict[str, list[object]] = defaultdict(list)
    for allocation in allocations:
        allocation_map[str(allocation.client_purchase_order_id)].append(allocation)
    snapshots = []
    for order in orders:
        rows = allocation_map[str(order.id)]
        committed = sum(
            (
                decimal_amount(row.amount)
                for row in rows
                if row.allocation_type in {"work_order", "billable", "change_order"}
            ),
            Decimal(0),
        )
        invoiced = sum(
            (decimal_amount(row.amount) for row in rows if row.allocation_type == "client_invoice"), Decimal(0)
        )
        balances = client_po_balances(decimal_amount(order.approved_amount), committed, invoiced)
        snapshots.append(
            {
                "id": str(order.id),
                "po_number": order.po_number,
                "status": order.status,
                "show_id": str(order.show_id) if order.show_id else None,
                "episode_id": str(order.episode_id) if order.episode_id else None,
                "expiry_date": order.expiry_date,
                **{name: monetary(value) for name, value in balances.items()},
            }
        )
    return snapshots


async def _client_account_view(session: DbSession, actor: CurrentActor, company: object) -> dict[str, object]:
    related_shows = await _related_shows(session, actor, str(company.id))
    show_ids = [str(show.id) for show in related_shows]
    active_counts = await _show_activity_counts(session, actor, show_ids)
    contacts = (
        await session.execute(
            select(crm_contacts)
            .where(
                and_(crm_contacts.c.organization_id == actor.organization_id, crm_contacts.c.company_id == company.id)
            )
            .order_by(crm_contacts.c.contact_type, crm_contacts.c.name, crm_contacts.c.id)
        )
    ).all()
    client_pos = await _client_po_snapshots(session, actor, str(company.id))
    billable_rows = []
    work_orders = []
    budget_totals = {"estimated_amount": Decimal(0), "actual_amount": Decimal(0)}
    if show_ids:
        billable_rows = (
            await session.execute(
                select(billables)
                .where(and_(billables.c.organization_id == actor.organization_id, billables.c.show_id.in_(show_ids)))
                .order_by(billables.c.created_at.desc(), billables.c.id)
            )
        ).all()
        work_orders = (
            await session.execute(
                select(
                    post_work_orders.c.id,
                    post_work_orders.c.title,
                    post_work_orders.c.status,
                    post_work_orders.c.due_at,
                )
                .select_from(post_work_orders)
                .join(
                    episodes,
                    and_(
                        episodes.c.id == post_work_orders.c.episode_id,
                        episodes.c.organization_id == actor.organization_id,
                    ),
                )
                .join(
                    seasons,
                    and_(seasons.c.id == episodes.c.season_id, seasons.c.organization_id == actor.organization_id),
                )
                .where(
                    and_(
                        post_work_orders.c.organization_id == actor.organization_id,
                        seasons.c.show_id.in_(show_ids),
                        post_work_orders.c.billing_scope == "billable_change",
                    )
                )
                .order_by(post_work_orders.c.due_at, post_work_orders.c.created_at.desc())
            )
        ).all()
        budget = (
            await session.execute(
                select(
                    func.coalesce(func.sum(budget_lines.c.budgeted_amount), 0).label("estimated_amount"),
                    func.coalesce(func.sum(budget_lines.c.actual_amount), 0).label("actual_amount"),
                ).where(
                    and_(budget_lines.c.organization_id == actor.organization_id, budget_lines.c.show_id.in_(show_ids))
                )
            )
        ).one()
        budget_totals = {
            "estimated_amount": decimal_amount(budget.estimated_amount),
            "actual_amount": decimal_amount(budget.actual_amount),
        }
    billable_total = sum((decimal_amount(row.amount) for row in billable_rows), Decimal(0))
    invoice_ready_total = sum(
        (decimal_amount(row.amount) for row in billable_rows if row.status == "approved" and not row.client_invoice_id),
        Decimal(0),
    )
    return {
        "account_kind": "client",
        "company": _company_value(company),
        "contacts": [_contact_value(contact) for contact in contacts],
        "shows": [
            {
                "id": str(show.id),
                "title": show.title,
                "code": show.code,
                "network": show.network,
                "active_episode_count": active_counts.get(str(show.id), 0),
            }
            for show in related_shows
        ],
        "client_purchase_orders": client_pos,
        "commercial_summary": {
            "billable_amount": monetary(billable_total),
            "invoice_ready_amount": monetary(invoice_ready_total),
            "budget_estimated_amount": monetary(budget_totals["estimated_amount"]),
            "budget_actual_amount": monetary(budget_totals["actual_amount"]),
            "open_billable_work_order_count": sum(
                1 for work_order in work_orders if work_order.status not in {"complete", "cancelled"}
            ),
        },
        "client_billable_work_orders": [
            {
                "id": str(work_order.id),
                "title": work_order.title,
                "status": work_order.status,
                "due_at": work_order.due_at,
            }
            for work_order in work_orders
        ],
        # Vendor POs, supplier invoices, and external-vendor work orders are
        # intentionally absent from this client-side account response.
    }


async def _vendor_account_view(session: DbSession, actor: CurrentActor, company: object) -> dict[str, object]:
    contacts = (
        await session.execute(
            select(crm_contacts)
            .where(
                and_(crm_contacts.c.organization_id == actor.organization_id, crm_contacts.c.company_id == company.id)
            )
            .order_by(crm_contacts.c.contact_type, crm_contacts.c.name, crm_contacts.c.id)
        )
    ).all()
    orders = (
        await session.execute(
            select(purchase_orders)
            .where(
                and_(
                    purchase_orders.c.organization_id == actor.organization_id,
                    purchase_orders.c.vendor_company_id == company.id,
                )
            )
            .order_by(purchase_orders.c.expiry_date, purchase_orders.c.po_number)
        )
    ).all()
    order_ids = [str(order.id) for order in orders]
    allocations = []
    if order_ids:
        allocations = (
            await session.execute(
                select(purchase_order_allocations).where(
                    and_(
                        purchase_order_allocations.c.organization_id == actor.organization_id,
                        purchase_order_allocations.c.purchase_order_id.in_(order_ids),
                    )
                )
            )
        ).all()
    allocations_by_order: dict[str, list[object]] = defaultdict(list)
    for allocation in allocations:
        allocations_by_order[str(allocation.purchase_order_id)].append(allocation)
    po_summaries = []
    for order in orders:
        rows = allocations_by_order[str(order.id)]
        committed = sum(
            (decimal_amount(row.amount) for row in rows if row.allocation_type in {"work_order", "budget_line"}),
            Decimal(0),
        )
        actual = sum(
            (decimal_amount(row.amount) for row in rows if row.allocation_type == "vendor_invoice"), Decimal(0)
        )
        balance = balance_snapshot(decimal_amount(order.approved_amount), committed, actual)
        po_summaries.append(
            {
                "id": str(order.id),
                "po_number": order.po_number,
                "status": order.status,
                "show_id": str(order.show_id) if order.show_id else None,
                "episode_id": str(order.episode_id) if order.episode_id else None,
                "expiry_date": order.expiry_date,
                **{name: monetary(value) for name, value in balance.items()},
            }
        )
    invoices = (
        await session.execute(
            select(vendor_invoices)
            .where(
                and_(
                    vendor_invoices.c.organization_id == actor.organization_id,
                    vendor_invoices.c.vendor_company_id == company.id,
                )
            )
            .order_by(vendor_invoices.c.invoice_date.desc(), vendor_invoices.c.created_at.desc())
        )
    ).all()
    work_orders = (
        await session.execute(
            select(
                post_work_orders.c.id,
                post_work_orders.c.title,
                post_work_orders.c.status,
                post_work_orders.c.due_at,
                post_work_orders.c.purchase_order_id,
                episodes.c.number.label("episode_number"),
                episodes.c.title.label("episode_title"),
            )
            .select_from(post_work_orders)
            .join(
                episodes,
                and_(
                    episodes.c.id == post_work_orders.c.episode_id, episodes.c.organization_id == actor.organization_id
                ),
            )
            .where(
                and_(
                    post_work_orders.c.organization_id == actor.organization_id,
                    post_work_orders.c.work_type == "external_vendor",
                    post_work_orders.c.vendor_company_id == company.id,
                )
            )
            .order_by(post_work_orders.c.due_at, post_work_orders.c.created_at.desc())
        )
    ).all()
    budget = (
        await session.execute(
            select(
                func.coalesce(func.sum(budget_lines.c.budgeted_amount), 0).label("estimated_amount"),
                func.coalesce(func.sum(budget_lines.c.actual_amount), 0).label("actual_amount"),
            ).where(
                and_(
                    budget_lines.c.organization_id == actor.organization_id,
                    budget_lines.c.purchase_order_id.in_(order_ids) if order_ids else False,
                )
            )
        )
    ).one()
    return {
        "account_kind": "vendor",
        "company": _company_value(company),
        "contacts": [_contact_value(contact) for contact in contacts],
        "purchase_orders": po_summaries,
        "active_work_orders": [
            {
                "id": str(work_order.id),
                "title": work_order.title,
                "status": work_order.status,
                "due_at": work_order.due_at,
                "purchase_order_id": str(work_order.purchase_order_id) if work_order.purchase_order_id else None,
                "episode_number": work_order.episode_number,
                "episode_title": work_order.episode_title,
            }
            for work_order in work_orders
            if work_order.status not in {"complete", "cancelled"}
        ],
        "vendor_invoices": [
            {
                "id": str(invoice.id),
                "invoice_number": invoice.invoice_number,
                "status": invoice.status,
                "invoice_date": invoice.invoice_date,
                "due_date": invoice.due_date,
                "amount": monetary(decimal_amount(invoice.amount)),
                "currency": invoice.currency,
            }
            for invoice in invoices
        ],
        "spend_summary": {
            "authorised_amount": monetary(sum((decimal_amount(order.approved_amount) for order in orders), Decimal(0))),
            "actual_invoiced_amount": monetary(
                sum((decimal_amount(invoice.amount) for invoice in invoices), Decimal(0))
            ),
            "budget_estimated_amount": monetary(decimal_amount(budget.estimated_amount)),
            "budget_actual_amount": monetary(decimal_amount(budget.actual_amount)),
        },
    }


@router.get("/accounts/{company_id}")
async def get_account_view(company_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await _require_crm_access(session, actor)
    company = await _company_or_404(session, actor, company_id)
    if company.type == "vendor":
        return await _vendor_account_view(session, actor, company)
    return await _client_account_view(session, actor, company)
