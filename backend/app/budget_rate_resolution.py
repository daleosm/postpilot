"""Server-side planned-budget rate resolution and immutable snapshots."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import and_, select

from app.api.dependencies import CurrentActor, DbSession
from app.api.routes.rate_cards import resolve_effective_rate
from app.budget_logic import decimal_amount, money_amount
from app.db.tables import people, rooms, service_rates

RATE_RESOURCE_TYPES = {"service", "room", "person"}
PLANNING_UNITS = {"hour", "day", "episode", "fixed", "unit"}


@dataclass(frozen=True)
class BudgetRateSnapshot:
    category: str
    unit: str
    quantity: Decimal
    rate: Decimal
    source: str
    currency: str
    resource_reference: str

    @property
    def estimate(self) -> Decimal:
        # A planned estimate is a saved monetary boundary. Keep higher
        # precision for quantities, but snapshot the resulting money once.
        return money_amount(self.quantity * self.rate)


async def resolve_budget_rate_snapshot(
    session: DbSession,
    actor: CurrentActor,
    *,
    episode_id: str,
    category: str,
    quantity: Decimal | int | str,
    unit: str | None,
    resource_type: str,
    resource_id: str,
    manual_rate_override: Decimal | int | str | None = None,
    manual_override_reason: str | None = None,
) -> BudgetRateSnapshot:
    """Resolve a selected resource to one inherited rate and snapshot it.

    The resource is tenant-scoped before its category/unit can participate in
    the hierarchy. A service supplies its own category and unit; a room or
    person is an operational reference and uses the selected cost category.
    """
    if resource_type not in RATE_RESOURCE_TYPES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Choose a valid budget resource.")
    resolved_category, resolved_unit, label = category.strip(), (unit or "").strip(), ""
    if resource_type == "service":
        service = (
            await session.execute(
                select(service_rates)
                .where(
                    and_(
                        service_rates.c.id == resource_id,
                        service_rates.c.organization_id == actor.organization_id,
                        service_rates.c.is_active.is_(True),
                    )
                )
                .limit(1)
            )
        ).first()
        if not service:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service rate not found.")
        resolved_category, resolved_unit, label = service.category, service.unit, service.name
    elif resource_type == "room":
        room = (
            await session.execute(
                select(rooms.c.name)
                .where(and_(rooms.c.id == resource_id, rooms.c.organization_id == actor.organization_id))
                .limit(1)
            )
        ).first()
        if not room:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")
        label = room.name
    else:
        person = (
            await session.execute(
                select(people.c.name)
                .where(and_(people.c.id == resource_id, people.c.organization_id == actor.organization_id))
                .limit(1)
            )
        ).first()
        if not person:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Person not found.")
        label = person.name
    if resolved_unit not in PLANNING_UNITS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Choose hour, day, episode, fixed, or unit for this planned item.",
        )
    resolved_quantity = decimal_amount(quantity)
    if resolved_quantity <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Planned quantity must be greater than zero.",
        )
    if manual_rate_override is not None:
        if not (manual_override_reason or "").strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Explain a manual rate override.",
            )
        rate = decimal_amount(manual_rate_override)
        source = "manual_override"
        currency = actor.active_organization.currency
    else:
        effective = await resolve_effective_rate(
            session,
            actor,
            episode_id=episode_id,
            category=resolved_category,
            unit=resolved_unit,
            target_type=resource_type if resource_type in {"room", "person"} else None,
            target_id=resource_id if resource_type in {"room", "person"} else None,
        )
        if effective["rate"] is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No active inherited rate matches this resource and unit. Add it to the rate card first.",
            )
        rate, source, currency = decimal_amount(effective["rate"]), str(effective["source"]), str(effective["currency"])
    return BudgetRateSnapshot(
        category=resolved_category,
        unit=resolved_unit,
        quantity=resolved_quantity,
        rate=rate,
        source=source,
        currency=currency,
        resource_reference=f"{resource_type}:{resource_id} · {label}",
    )
