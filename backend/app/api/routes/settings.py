# ruff: noqa: E501
"""Tenant settings, room inventory, people access, and workflow configuration.

These endpoints deliberately enforce capabilities.  A browser never supplies
an organization identifier; every row is derived from the API session actor.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, Body, HTTPException, status
from sqlalchemy import and_, delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentActor, DbSession
from app.api.schemas import (
    CateringSettingsUpdateRequest,
    CurrencySettingsUpdateRequest,
    InvoiceSettingsUpdateRequest,
    OrganizationUserCreateRequest,
    OrganizationUserUpdateRequest,
    RolePoliciesUpdateRequest,
    RoomCreateRequest,
    RoomUpdateRequest,
    SsoConnectionEnabledUpdateRequest,
    WorkOrderTimeSettingsUpdateRequest,
)
from app.auth import require_permission
from app.budget_logic import json_safe
from app.config import get_settings
from app.db.tables import (
    activity_log,
    billables,
    budget_lines,
    catering_requests,
    catering_settings,
    crm_companies,
    episode_workflow_approvals,
    episodes,
    external_identities,
    invoice_settings,
    organization_members,
    organization_role_policies,
    organizations,
    people,
    post_work_orders,
    post_workflows,
    rate_cards,
    rooms,
    service_rates,
    sso_connections,
    users,
    vendor_invoices,
    workflow_stage_approval_rules,
    workflow_stage_work_order_templates,
    workflow_stages,
)
from app.permissions import PERMISSIONS
from app.security import hash_node_scrypt_password

router = APIRouter(tags=["settings"])

CLIENT_ROLE = "client"
CLIENT_LABEL = "Client"
CLIENT_PERMISSIONS = ["sign_off_work", "request_catering"]


async def _audit(
    session: DbSession,
    actor: CurrentActor,
    action: str,
    entity_type: str,
    entity_id: str,
    metadata: dict[str, object] | None = None,
) -> None:
    await session.execute(
        insert(activity_log).values(
            organization_id=actor.organization_id,
            actor_user_id=actor.user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            metadata=json_safe(metadata or {}),
        )
    )


def _room(row: object) -> dict[str, object]:
    return {
        "id": str(row.id),
        "name": row.name,
        "type": row.type,
        "location": row.location,
        "capacity": row.capacity,
        "notes": row.notes,
    }


@router.get("/rooms")
async def list_rooms(actor: CurrentActor, session: DbSession) -> list[dict[str, object]]:
    await require_permission(session, actor, "view_all_operations")
    rows = (
        await session.execute(
            select(rooms).where(rooms.c.organization_id == actor.organization_id).order_by(rooms.c.name, rooms.c.id)
        )
    ).all()
    return [_room(row) for row in rows]


@router.post("/rooms", status_code=status.HTTP_201_CREATED)
async def create_room(payload: RoomCreateRequest, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_permission(session, actor, "manage_bookings")
    try:
        row = (
            await session.execute(
                insert(rooms)
                .values(organization_id=actor.organization_id, **payload.model_dump())
                .returning(rooms.c.id)
            )
        ).first()
        await _audit(session, actor, "room.created", "room", str(row.id), {"name": payload.name})
        await session.commit()
        return {"id": str(row.id)}
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A room with that name already exists."
        ) from error


@router.patch("/rooms/{room_id}")
async def update_room(
    room_id: str, payload: RoomUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_bookings")
    values = payload.model_dump(exclude_unset=True)
    values["updated_at"] = datetime.now(UTC)
    try:
        row = (
            await session.execute(
                update(rooms)
                .where(and_(rooms.c.id == room_id, rooms.c.organization_id == actor.organization_id))
                .values(**values)
                .returning(rooms.c.id)
            )
        ).first()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A room with that name already exists."
        ) from error
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")
    await _audit(session, actor, "room.updated", "room", room_id, {"fields": sorted(values)})
    await session.commit()
    return {"id": str(row.id)}


@router.get("/settings/bootstrap")
async def settings_bootstrap(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """Read configuration in one round trip for the settings pages.

    This is a read model only.  Mutation routes below remain narrowly scoped,
    which makes capability and tenant checks easy to audit.
    """
    await require_permission(session, actor, "manage_settings")
    org = actor.active_organization
    organization_row = (
        await session.execute(
            select(organizations.c.standard_day_hours, organizations.c.overtime_multiplier)
            .where(organizations.c.id == actor.organization_id)
            .limit(1)
        )
    ).first()
    room_rows = await session.execute(
        select(rooms).where(rooms.c.organization_id == actor.organization_id).order_by(rooms.c.name)
    )
    policies = await session.execute(
        select(organization_role_policies)
        .where(organization_role_policies.c.organization_id == actor.organization_id)
        .order_by(organization_role_policies.c.label, organization_role_policies.c.role)
    )
    members = await session.execute(
        select(
            users.c.id.label("user_id"),
            users.c.name.label("user_name"),
            users.c.email,
            organization_members.c.role.label("membership_role"),
            organization_members.c.joined_at,
            people.c.id.label("person_id"),
            people.c.name.label("person_name"),
            people.c.role.label("person_role"),
            people.c.is_active,
        )
        .select_from(organization_members)
        .join(users, users.c.id == organization_members.c.user_id)
        .outerjoin(
            people,
            and_(
                people.c.organization_id == organization_members.c.organization_id,
                people.c.user_id == organization_members.c.user_id,
            ),
        )
        .where(organization_members.c.organization_id == actor.organization_id)
        .order_by(people.c.name, users.c.name, users.c.email)
    )
    workflow = await session.execute(
        select(post_workflows)
        .where(and_(post_workflows.c.organization_id == actor.organization_id, post_workflows.c.is_default.is_(True)))
        .limit(1)
    )
    invoice = await session.execute(
        select(invoice_settings).where(invoice_settings.c.organization_id == actor.organization_id).limit(1)
    )
    catering = await session.execute(
        select(catering_settings).where(catering_settings.c.organization_id == actor.organization_id).limit(1)
    )
    workflow_row = workflow.first()
    invoice_row = invoice.first()
    catering_row = catering.first()
    stages: list[object] = []
    rules: list[object] = []
    templates: list[object] = []
    if workflow_row:
        stages_result = await session.execute(
            select(workflow_stages)
            .where(
                and_(
                    workflow_stages.c.organization_id == actor.organization_id,
                    workflow_stages.c.workflow_id == workflow_row.id,
                )
            )
            .order_by(workflow_stages.c.position)
        )
        rules_result = await session.execute(
            select(workflow_stage_approval_rules)
            .join(workflow_stages, workflow_stages.c.id == workflow_stage_approval_rules.c.workflow_stage_id)
            .where(
                and_(
                    workflow_stage_approval_rules.c.organization_id == actor.organization_id,
                    workflow_stages.c.workflow_id == workflow_row.id,
                )
            )
            .order_by(workflow_stage_approval_rules.c.approval_order)
        )
        templates_result = await session.execute(
            select(workflow_stage_work_order_templates)
            .join(workflow_stages, workflow_stages.c.id == workflow_stage_work_order_templates.c.workflow_stage_id)
            .where(
                and_(
                    workflow_stage_work_order_templates.c.organization_id == actor.organization_id,
                    workflow_stages.c.workflow_id == workflow_row.id,
                )
            )
            .order_by(workflow_stage_work_order_templates.c.position)
        )
        stages, rules, templates = stages_result.all(), rules_result.all(), templates_result.all()
    return {
        "organization": {
            "id": org.organization_id,
            "name": org.organization_name,
            "currency": org.currency,
            "standard_day_hours": organization_row.standard_day_hours if organization_row else 10,
            "overtime_multiplier": organization_row.overtime_multiplier if organization_row else 1.5,
        },
        "rooms": [_room(row) for row in room_rows.all()],
        "users": [
            {
                "user_id": row.user_id,
                "user_name": row.user_name,
                "email": row.email,
                "membership_role": row.membership_role,
                "joined_at": row.joined_at,
                "person_id": str(row.person_id) if row.person_id else None,
                "person_name": row.person_name,
                "person_role": row.person_role,
                "is_active": row.is_active,
            }
            for row in members.all()
        ],
        "policies": [
            {"id": str(row.id), "role": row.role, "label": row.label, "permissions": row.permissions}
            for row in policies.all()
        ]
        + [{"id": "client", "role": CLIENT_ROLE, "label": CLIENT_LABEL, "permissions": CLIENT_PERMISSIONS}],
        "workflow": None
        if not workflow_row
        else {
            "id": str(workflow_row.id),
            "name": workflow_row.name,
            "description": workflow_row.description,
            "stages": [
                {
                    "id": str(row.id),
                    "name": row.name,
                    "key": row.key,
                    "position": row.position,
                    "color": row.color,
                    "is_terminal": row.is_terminal,
                    "can_start_early": row.can_start_early,
                    "requires_qc_pass": row.requires_qc_pass,
                    "delivery_gate": row.delivery_gate,
                }
                for row in stages
            ],
            "rules": [
                {
                    "id": str(row.id),
                    "workflow_stage_id": str(row.workflow_stage_id),
                    "approver_role": row.approver_role,
                    "label": row.label,
                    "approval_order": row.approval_order,
                    "is_required": row.is_required,
                }
                for row in rules
            ],
            "work_order_templates": [
                {
                    "id": str(row.id),
                    "workflow_stage_id": str(row.workflow_stage_id),
                    "title": row.title,
                    "description": row.description,
                    "priority": row.priority,
                    "is_blocking": row.is_blocking,
                    "position": row.position,
                }
                for row in templates
            ],
        },
        "invoice": None
        if not invoice_row
        else {
            key: getattr(invoice_row, key)
            for key in (
                "legal_name",
                "legal_address",
                "billing_email",
                "tax_enabled",
                "tax_name",
                "tax_registration_number",
                "tax_rate_percent",
                "payment_terms_days",
                "payment_instructions",
            )
        },
        "catering": {"markup_percent": float(catering_row.markup_percent) if catering_row else 0},
    }


@router.get("/settings/sso")
async def get_sso_settings(actor: CurrentActor, session: DbSession) -> dict[str, object]:
    """Return the active tenant's safe Entra configuration and link status."""
    await require_permission(session, actor, "manage_settings")
    connection = (
        await session.execute(
            select(sso_connections)
            .where(
                and_(
                    sso_connections.c.organization_id == actor.organization_id,
                    sso_connections.c.provider == "microsoft_entra",
                )
            )
            .limit(1)
        )
    ).first()
    linked_user_count = (
        await session.execute(
            select(func.count(func.distinct(external_identities.c.user_id)))
            .select_from(
                organization_members.join(
                    external_identities,
                    and_(
                        external_identities.c.user_id == organization_members.c.user_id,
                        external_identities.c.provider == "microsoft_entra",
                    ),
                )
            )
            .where(organization_members.c.organization_id == actor.organization_id)
        )
    ).scalar_one()
    members = (
        await session.execute(
            select(
                users.c.id.label("user_id"),
                users.c.name.label("user_name"),
                users.c.email,
                organization_members.c.role.label("membership_role"),
                func.max(external_identities.c.linked_at).label("linked_at"),
            )
            .select_from(
                organization_members.join(users, users.c.id == organization_members.c.user_id).outerjoin(
                    external_identities,
                    and_(
                        external_identities.c.user_id == organization_members.c.user_id,
                        external_identities.c.provider == "microsoft_entra",
                    ),
                )
            )
            .where(organization_members.c.organization_id == actor.organization_id)
            .group_by(users.c.id, users.c.name, users.c.email, organization_members.c.role)
            .order_by(users.c.name, users.c.email, users.c.id)
        )
    ).all()
    return {
        "runtime_enabled": get_settings().microsoft_sso_enabled,
        "connection": None
        if not connection
        else {
            "enabled": connection.enabled,
            "entra_tenant_id": str(connection.entra_tenant_id),
            "allowed_email_domains": connection.allowed_email_domains or [],
            "updated_at": connection.updated_at,
        },
        "linked_user_count": linked_user_count,
        "users": [
            {
                "user_id": row.user_id,
                "user_name": row.user_name,
                "email": row.email,
                "membership_role": row.membership_role,
                "microsoft_linked": row.linked_at is not None,
                "microsoft_linked_at": row.linked_at,
            }
            for row in members
        ],
    }


@router.patch("/settings/sso/connection")
async def set_sso_connection_enabled(
    payload: SsoConnectionEnabledUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    """Enable or disable only the active tenant's existing Entra connection."""
    await require_permission(session, actor, "manage_settings")
    if payload.enabled and not get_settings().microsoft_sso_enabled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Microsoft SSO is not enabled in this deployment.",
        )
    row = (
        await session.execute(
            update(sso_connections)
            .where(
                and_(
                    sso_connections.c.organization_id == actor.organization_id,
                    sso_connections.c.provider == "microsoft_entra",
                )
            )
            .values(enabled=payload.enabled, updated_at=datetime.now(UTC))
            .returning(sso_connections.c.id, sso_connections.c.enabled)
        )
    ).first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Microsoft SSO is not configured for this post house."
        )
    await _audit(
        session,
        actor,
        "sso.connection_enabled" if payload.enabled else "sso.connection_disabled",
        "sso_connection",
        str(row.id),
    )
    await session.commit()
    return {"enabled": row.enabled}


@router.patch("/settings/catering")
async def update_catering_settings(
    payload: CateringSettingsUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_budget")
    await session.execute(
        pg_insert(catering_settings)
        .values(organization_id=actor.organization_id, markup_percent=payload.markup_percent)
        .on_conflict_do_update(
            index_elements=[catering_settings.c.organization_id],
            set_={"markup_percent": payload.markup_percent, "updated_at": datetime.now(UTC)},
        )
    )
    await _audit(
        session,
        actor,
        "catering.settings_updated",
        "organization",
        actor.organization_id,
        {"markup_percent": payload.markup_percent},
    )
    await session.commit()
    return {"ok": True}


@router.patch("/settings/currency")
async def update_currency(
    payload: CurrencySettingsUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_budget")
    # PostPilot intentionally operates with one reporting currency per post
    # house. Keep every live commercial record aligned when it changes, rather
    # than leaving misleading mixed-currency totals in old jobs or rate cards.
    now = datetime.now(UTC)
    await session.execute(
        update(organizations).where(organizations.c.id == actor.organization_id).values(currency=payload.currency)
    )
    currency_tables = (
        crm_companies,
        post_work_orders,
        budget_lines,
        service_rates,
        rate_cards,
        billables,
        vendor_invoices,
        catering_requests,
    )
    for table in currency_tables:
        values: dict[str, object] = {"currency": payload.currency}
        if "updated_at" in table.c:
            values["updated_at"] = now
        if table is post_work_orders:
            values["client_quote_currency"] = payload.currency
        await session.execute(update(table).where(table.c.organization_id == actor.organization_id).values(**values))
    await _audit(
        session,
        actor,
        "organization.currency_updated",
        "organization",
        actor.organization_id,
        {"currency": payload.currency},
    )
    await session.commit()
    return {"ok": True, "currency": payload.currency}


@router.patch("/settings/work-order-time")
async def update_work_order_time_settings(
    payload: WorkOrderTimeSettingsUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    """Set the defaults that new work orders and confirmed bookings snapshot.

    Historical work orders and confirmed bookings retain their own snapshots,
    so changing this policy does not silently revise agreed client charges.
    """
    await require_permission(session, actor, "manage_settings")
    await session.execute(
        update(organizations)
        .where(organizations.c.id == actor.organization_id)
        .values(
            standard_day_hours=payload.standard_day_hours,
            overtime_multiplier=payload.overtime_multiplier,
        )
    )
    await _audit(
        session,
        actor,
        "organization.work_order_time_settings_updated",
        "organization",
        actor.organization_id,
        {
            "standard_day_hours": str(payload.standard_day_hours),
            "overtime_multiplier": str(payload.overtime_multiplier),
        },
    )
    await session.commit()
    return {
        "ok": True,
        "standard_day_hours": str(payload.standard_day_hours),
        "overtime_multiplier": str(payload.overtime_multiplier),
    }


@router.patch("/settings/invoicing")
async def update_invoice_settings(
    payload: InvoiceSettingsUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_budget")
    values = payload.model_dump()
    await session.execute(
        pg_insert(invoice_settings)
        .values(organization_id=actor.organization_id, **values)
        .on_conflict_do_update(
            index_elements=[invoice_settings.c.organization_id], set_={**values, "updated_at": datetime.now(UTC)}
        )
    )
    await _audit(session, actor, "invoice.settings_updated", "organization", actor.organization_id)
    await session.commit()
    return {"ok": True}


@router.patch("/settings/role-policies")
async def update_role_policies(
    payload: RolePoliciesUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_users")
    if len({policy.role for policy in payload.policies}) != len(payload.policies):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role settings contain a duplicate role.")
    submitted_client = next((policy for policy in payload.policies if policy.role == CLIENT_ROLE), None)
    if submitted_client and (
        submitted_client.label != CLIENT_LABEL or sorted(submitted_client.permissions) != CLIENT_PERMISSIONS
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Client is a fixed system role.")
    policies = [policy for policy in payload.policies if policy.role != CLIENT_ROLE]
    if any(not set(policy.permissions).issubset(PERMISSIONS) for policy in policies):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Role settings contain an unsupported permission."
        )
    assigned = (
        (await session.execute(select(people.c.role).where(people.c.organization_id == actor.organization_id)))
        .scalars()
        .all()
    )
    workflow_roles = (
        (
            await session.execute(
                select(workflow_stage_approval_rules.c.approver_role).where(
                    and_(
                        workflow_stage_approval_rules.c.organization_id == actor.organization_id,
                        workflow_stage_approval_rules.c.approver_role.is_not(None),
                    )
                )
            )
        )
        .scalars()
        .all()
    )
    allowed = {CLIENT_ROLE, *(policy.role for policy in policies)}
    missing = next((role for role in {*assigned, *workflow_roles} if role not in allowed), None)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Reassign people and workflow sign-offs using {missing.replace('_', ' ')} before removing it.",
        )
    await session.execute(
        delete(organization_role_policies).where(organization_role_policies.c.organization_id == actor.organization_id)
    )
    if policies:
        await session.execute(
            insert(organization_role_policies),
            [
                {
                    "organization_id": actor.organization_id,
                    "role": policy.role,
                    "label": policy.label,
                    "permissions": policy.permissions,
                }
                for policy in policies
            ],
        )
        # Workflow sign-off labels are derived display text, never a second
        # source of truth. Keep them in sync when a tenant renames a role.
        for policy in policies:
            await session.execute(
                update(workflow_stage_approval_rules)
                .where(
                    and_(
                        workflow_stage_approval_rules.c.organization_id == actor.organization_id,
                        workflow_stage_approval_rules.c.approver_role == policy.role,
                    )
                )
                .values(label=f"{policy.label} sign-off", updated_at=datetime.now(UTC))
            )
    await _audit(
        session,
        actor,
        "organization.role_policies_updated",
        "organization",
        actor.organization_id,
        {"role_count": len(policies)},
    )
    await session.commit()
    return {"ok": True}


async def _configured_role(session: DbSession, actor: CurrentActor, role: str) -> bool:
    if role == CLIENT_ROLE:
        return True
    return bool(
        (
            await session.execute(
                select(organization_role_policies.c.id)
                .where(
                    and_(
                        organization_role_policies.c.organization_id == actor.organization_id,
                        organization_role_policies.c.role == role,
                    )
                )
                .limit(1)
            )
        ).first()
    )


@router.post("/settings/users", status_code=status.HTTP_201_CREATED)
async def create_organization_user(
    payload: OrganizationUserCreateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_users")
    email = str(payload.email).lower().strip()
    person_role = CLIENT_ROLE if payload.membership_role == CLIENT_ROLE else payload.person_role
    if (payload.membership_role != CLIENT_ROLE and person_role == CLIENT_ROLE) or not await _configured_role(
        session, actor, person_role
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Select a role configured for this post house."
        )
    user = (await session.execute(select(users.c.id).where(users.c.email == email).limit(1))).first()
    user_id = user.id if user else str(uuid4())
    exists = (
        await session.execute(
            select(organization_members.c.user_id)
            .where(
                and_(
                    organization_members.c.organization_id == actor.organization_id,
                    organization_members.c.user_id == user_id,
                )
            )
            .limit(1)
        )
    ).first()
    if exists:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This person already has access to this post house."
        )
    existing_person = (
        await session.execute(
            select(people.c.id, people.c.user_id)
            .where(and_(people.c.organization_id == actor.organization_id, people.c.email == email))
            .limit(1)
        )
    ).first()
    if existing_person and existing_person.user_id and existing_person.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This work email is already linked to a different tenant account.",
        )
    if not user:
        # Passwords are set only while creating a global account. Adding an
        # existing account to this tenant must not allow a tenant admin to
        # overwrite that person's password or other tenant access.
        await session.execute(
            insert(users).values(
                id=user_id, name=payload.name, email=email, password_hash=hash_node_scrypt_password(payload.password)
            )
        )
    await session.execute(
        insert(organization_members).values(
            organization_id=actor.organization_id, user_id=user_id, role=payload.membership_role
        )
    )
    if existing_person:
        await session.execute(
            update(people)
            .where(and_(people.c.id == existing_person.id, people.c.organization_id == actor.organization_id))
            .values(user_id=user_id, name=payload.name, role=person_role, is_active=True, updated_at=datetime.now(UTC))
        )
    else:
        await session.execute(
            insert(people).values(
                organization_id=actor.organization_id, user_id=user_id, name=payload.name, email=email, role=person_role
            )
        )
    await _audit(
        session, actor, "organization.user_added", "user", user_id, {"email": email, "person_role": person_role}
    )
    await session.commit()
    return {"id": user_id}


@router.patch("/settings/users/{user_id}")
async def update_organization_user(
    user_id: str, payload: OrganizationUserUpdateRequest, actor: CurrentActor, session: DbSession
) -> dict[str, object]:
    await require_permission(session, actor, "manage_users")
    if user_id == actor.user_id and payload.membership_role != "admin":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="You cannot remove your own administrator access."
        )
    membership = (
        await session.execute(
            select(organization_members.c.role)
            .where(
                and_(
                    organization_members.c.organization_id == actor.organization_id,
                    organization_members.c.user_id == user_id,
                )
            )
            .limit(1)
        )
    ).first()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in this post house.")
    if membership.role == "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="The post-house owner access cannot be changed here."
        )
    person_role = CLIENT_ROLE if payload.membership_role == CLIENT_ROLE else payload.person_role
    if (payload.membership_role != CLIENT_ROLE and person_role == CLIENT_ROLE) or not await _configured_role(
        session, actor, person_role
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Select a role configured for this post house."
        )
    await session.execute(
        update(organization_members)
        .where(
            and_(
                organization_members.c.organization_id == actor.organization_id,
                organization_members.c.user_id == user_id,
            )
        )
        .values(role=payload.membership_role)
    )
    await session.execute(
        update(people)
        .where(and_(people.c.organization_id == actor.organization_id, people.c.user_id == user_id))
        .values(role=person_role, updated_at=datetime.now(UTC))
    )
    await _audit(
        session,
        actor,
        "organization.user_access_updated",
        "user",
        user_id,
        {"person_role": person_role, "membership_role": payload.membership_role},
    )
    await session.commit()
    return {"ok": True}


@router.delete("/settings/users/{user_id}")
async def delete_organization_user(user_id: str, actor: CurrentActor, session: DbSession) -> dict[str, object]:
    await require_permission(session, actor, "manage_users")
    if user_id == actor.user_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You cannot remove your own access.")
    membership = (
        await session.execute(
            select(organization_members.c.role)
            .where(
                and_(
                    organization_members.c.organization_id == actor.organization_id,
                    organization_members.c.user_id == user_id,
                )
            )
            .limit(1)
        )
    ).first()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in this post house.")
    if membership.role == "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="The post-house owner access cannot be removed here."
        )
    await session.execute(
        delete(organization_members).where(
            and_(
                organization_members.c.organization_id == actor.organization_id,
                organization_members.c.user_id == user_id,
            )
        )
    )
    await session.execute(
        update(people)
        .where(and_(people.c.organization_id == actor.organization_id, people.c.user_id == user_id))
        .values(user_id=None, is_active=False, updated_at=datetime.now(UTC))
    )
    await _audit(session, actor, "organization.user_access_removed", "user", user_id)
    await session.commit()
    return {"ok": True}


@router.patch("/workflows/{workflow_id}")
async def update_workflow(
    workflow_id: str, actor: CurrentActor, session: DbSession, payload: Annotated[dict[str, Any], Body()]
) -> dict[str, object]:
    """Save the tenant's ordered workflow and its tenant-defined sign-off roles.

    The browser sends a drag-ordered stage list. Existing episode sign-offs are
    protected: a stage carrying live episode history cannot be deleted.
    """
    await require_permission(session, actor, "manage_workflow_configuration")
    workflow = (
        await session.execute(
            select(post_workflows.c.id)
            .where(and_(post_workflows.c.id == workflow_id, post_workflows.c.organization_id == actor.organization_id))
            .limit(1)
        )
    ).first()
    if not workflow:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found.")
    stages_input = payload.get("stages")
    rules_input = payload.get("rules", [])
    templates_input = payload.get("work_order_templates", [])
    if not isinstance(stages_input, list) or not stages_input:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A workflow needs at least one stage.")
    if not all(
        isinstance(item, dict) and str(item.get("name", "")).strip() and str(item.get("key", "")).strip()
        for item in stages_input
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Every workflow stage needs a name and key."
        )
    if len({str(item["key"]).strip() for item in stages_input}) != len(stages_input):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Workflow stage keys must be unique.")
    if sum(bool(item.get("is_terminal")) for item in stages_input) != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="A workflow needs exactly one terminal stage."
        )
    valid_delivery_gates = {"none", "facility_dispatch", "client_acceptance"}
    if any(str(item.get("delivery_gate") or "none") not in valid_delivery_gates for item in stages_input):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Workflow contains an invalid delivery gate."
        )
    existing = (
        await session.execute(
            select(workflow_stages).where(
                and_(
                    workflow_stages.c.organization_id == actor.organization_id,
                    workflow_stages.c.workflow_id == workflow_id,
                )
            )
        )
    ).all()
    existing_ids = {str(stage.id) for stage in existing}
    submitted_ids = {str(item.get("id", "")) for item in stages_input}
    removed = [stage for stage in existing if str(stage.id) not in submitted_ids]
    if any(stage.requires_qc_pass for stage in existing) and not any(
        bool(item.get("requires_qc_pass")) for item in stages_input
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This workflow must retain its QC decision stage."
        )
    for stage in removed:
        referenced = (
            await session.execute(
                select(episodes.c.id)
                .where(
                    and_(episodes.c.organization_id == actor.organization_id, episodes.c.workflow_stage_id == stage.id)
                )
                .limit(1)
            )
        ).first() or (
            await session.execute(
                select(episode_workflow_approvals.c.id)
                .where(
                    and_(
                        episode_workflow_approvals.c.organization_id == actor.organization_id,
                        episode_workflow_approvals.c.workflow_stage_id == stage.id,
                    )
                )
                .limit(1)
            )
        ).first()
        if referenced:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="A stage with episode workflow history cannot be deleted."
            )
    if any(
        not isinstance(item, dict) or str(item.get("workflow_stage_id", "")) not in submitted_ids
        for item in rules_input
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Workflow contains an invalid sign-off slot."
        )
    configured_roles = {
        row.role: row.label
        for row in (
            await session.execute(
                select(organization_role_policies.c.role, organization_role_policies.c.label).where(
                    organization_role_policies.c.organization_id == actor.organization_id
                )
            )
        ).all()
    }
    configured_roles[CLIENT_ROLE] = CLIENT_LABEL
    invalid_rule = next(
        (
            item
            for item in rules_input
            if not str(item.get("approver_role") or "").strip()
            or str(item.get("approver_role")).strip() not in configured_roles
        ),
        None,
    )
    if invalid_rule:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Every workflow sign-off must use a role configured for this post house.",
        )
    if any(
        not isinstance(item, dict) or str(item.get("workflow_stage_id", "")) not in submitted_ids
        for item in templates_input
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Workflow contains an invalid work-order template."
        )
    existing_rules = (
        (
            await session.execute(
                select(workflow_stage_approval_rules).where(
                    and_(
                        workflow_stage_approval_rules.c.organization_id == actor.organization_id,
                        workflow_stage_approval_rules.c.workflow_stage_id.in_([stage.id for stage in existing]),
                    )
                )
            )
        ).all()
        if existing
        else []
    )
    existing_rule_ids = {str(rule.id) for rule in existing_rules}
    submitted_rule_ids = {str(item.get("id", "")) for item in rules_input}
    removed_rule_ids = [rule.id for rule in existing_rules if str(rule.id) not in submitted_rule_ids]
    await session.execute(
        update(post_workflows)
        .where(and_(post_workflows.c.id == workflow_id, post_workflows.c.organization_id == actor.organization_id))
        .values(updated_at=datetime.now(UTC))
    )
    if existing:
        await session.execute(
            update(workflow_stages)
            .where(
                and_(
                    workflow_stages.c.organization_id == actor.organization_id,
                    workflow_stages.c.workflow_id == workflow_id,
                )
            )
            .values(position=workflow_stages.c.position + 1000, updated_at=datetime.now(UTC))
        )
    if removed:
        await session.execute(
            delete(workflow_stages).where(
                and_(
                    workflow_stages.c.organization_id == actor.organization_id,
                    workflow_stages.c.id.in_([stage.id for stage in removed]),
                )
            )
        )
    for position, stage in enumerate(stages_input, start=1):
        values = {
            "name": str(stage["name"]).strip(),
            "key": str(stage["key"]).strip(),
            "position": position,
            "color": str(stage.get("color") or "#687a78"),
            "is_terminal": bool(stage.get("is_terminal")),
            "can_start_early": bool(stage.get("can_start_early")),
            "requires_qc_pass": bool(stage.get("requires_qc_pass")),
            "delivery_gate": str(stage.get("delivery_gate") or "none"),
            "updated_at": datetime.now(UTC),
        }
        stage_id = str(stage.get("id", ""))
        if stage_id in existing_ids:
            await session.execute(
                update(workflow_stages)
                .where(
                    and_(workflow_stages.c.id == stage_id, workflow_stages.c.organization_id == actor.organization_id)
                )
                .values(**values)
            )
        else:
            await session.execute(
                insert(workflow_stages).values(
                    id=stage_id or str(uuid4()),
                    organization_id=actor.organization_id,
                    workflow_id=workflow_id,
                    **values,
                )
            )
    if removed_rule_ids:
        await session.execute(
            delete(workflow_stage_approval_rules).where(
                and_(
                    workflow_stage_approval_rules.c.organization_id == actor.organization_id,
                    workflow_stage_approval_rules.c.id.in_(removed_rule_ids),
                )
            )
        )
    for item in rules_input:
        approver_role = str(item["approver_role"]).strip()
        values = {
            "workflow_stage_id": str(item["workflow_stage_id"]),
            # The visible label is derived from the tenant-custom role so it
            # cannot drift away from the role used for signer enforcement.
            "label": f"{configured_roles[approver_role]} sign-off",
            "approval_order": int(item.get("approval_order") or 1),
            "is_required": bool(item.get("is_required", True)),
            "approver_role": approver_role,
            "updated_at": datetime.now(UTC),
        }
        rule_id = str(item.get("id", ""))
        if rule_id in existing_rule_ids:
            await session.execute(
                update(workflow_stage_approval_rules)
                .where(
                    and_(
                        workflow_stage_approval_rules.c.id == rule_id,
                        workflow_stage_approval_rules.c.organization_id == actor.organization_id,
                    )
                )
                .values(**values)
            )
        else:
            await session.execute(
                insert(workflow_stage_approval_rules).values(
                    id=rule_id or str(uuid4()), organization_id=actor.organization_id, **values
                )
            )
    if existing:
        await session.execute(
            delete(workflow_stage_work_order_templates).where(
                and_(
                    workflow_stage_work_order_templates.c.organization_id == actor.organization_id,
                    workflow_stage_work_order_templates.c.workflow_stage_id.in_([stage.id for stage in existing]),
                )
            )
        )
    if templates_input:
        await session.execute(
            insert(workflow_stage_work_order_templates),
            [
                {
                    "id": str(item.get("id") or uuid4()),
                    "organization_id": actor.organization_id,
                    "workflow_stage_id": str(item["workflow_stage_id"]),
                    "title": str(item.get("title") or "Work order").strip(),
                    "description": item.get("description"),
                    "priority": str(item.get("priority") or "normal"),
                    "is_blocking": bool(item.get("is_blocking", True)),
                    "position": int(item.get("position") or index + 1),
                }
                for index, item in enumerate(templates_input)
            ],
        )
    await _audit(
        session,
        actor,
        "workflow.template_updated",
        "workflow",
        workflow_id,
        {"stage_count": len(stages_input), "rule_count": len(rules_input)},
    )
    await session.commit()
    return {"ok": True}
