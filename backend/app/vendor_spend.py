"""Shared validation for external vendor spend against episode budget items."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import and_, select

from app.db.tables import budget_lines


async def external_budget_line_for_episode(
    session,
    *,
    organization_id: str,
    episode_id: str,
    budget_line_id: str | None,
    purchase_order_id: str | None = None,
) -> object:
    """Return a usable external estimate item without trusting client scope.

    The line is the actual-cost destination. A vendor PO is an optional
    authorisation/commitment record and, when both are selected, must describe
    the same supplier authority (or the line must have no PO restriction).
    """
    if not budget_line_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Select an external budget item before recording vendor spend.",
        )
    line = (
        await session.execute(
            select(budget_lines).where(
                and_(
                    budget_lines.c.id == budget_line_id,
                    budget_lines.c.organization_id == organization_id,
                    budget_lines.c.episode_id == episode_id,
                    budget_lines.c.external_cost.is_(True),
                )
            ).limit(1)
        )
    ).first()
    if not line:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="External budget item not found for this episode.",
        )
    if purchase_order_id and line.purchase_order_id and str(line.purchase_order_id) != str(purchase_order_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The selected external budget item is linked to a different vendor PO.",
        )
    return line
