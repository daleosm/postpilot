from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import and_, select

from app.api.dependencies import CurrentActor, DbSession
from app.api.routes.auth import session_response
from app.api.routes.organizations import tenant_redirect
from app.api.schemas import DebugUserRequest, DebugUserResponse, SessionResponse
from app.auth import (
    can_switch_debug_user,
    create_session,
    get_actor_for_token,
    revoke_session,
    switch_debug_user,
)
from app.config import get_settings
from app.db.tables import organization_members, people, users

router = APIRouter(prefix="/debug", tags=["debug"])


@router.get("/users", response_model=list[DebugUserResponse])
async def list_debug_users(session: DbSession, actor: CurrentActor) -> list[DebugUserResponse]:
    if not can_switch_debug_user(actor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Demo administrator sign-in required.")
    rows = (
        await session.execute(
            select(users.c.id, users.c.name, people.c.role, organization_members.c.role.label("membership_role"))
            .join(organization_members, organization_members.c.user_id == users.c.id)
            .outerjoin(
                people,
                and_(
                    people.c.user_id == users.c.id,
                    people.c.organization_id == organization_members.c.organization_id,
                ),
            )
            .order_by(users.c.name, users.c.id)
        )
    ).all()
    unique: dict[str, DebugUserResponse] = {}
    for row in rows:
        if row.id not in unique:
            role = row.role or row.membership_role
            unique[row.id] = DebugUserResponse(
                user_id=row.id,
                name=row.name or row.id,
                role=role,
                label=role.replace("_", " ").title(),
            )
    return list(unique.values())


@router.put("/user", response_model=SessionResponse)
async def set_debug_user(
    payload: DebugUserRequest, request: Request, session: DbSession, actor: CurrentActor
) -> SessionResponse:
    await switch_debug_user(session, actor, payload.user_id)
    token = request.cookies.get(get_settings().cookie_name)
    if not token:
        raise RuntimeError("Authenticated request lost its session cookie.")
    next_actor = await get_actor_for_token(session, token)
    redirect_to = await tenant_redirect(session, next_actor, payload.pathname)
    # A debug user is deliberately allowed to come from any demo post house.
    # If the current nested page is not available to that person, keep the
    # access boundary and take them to their actionable queue instead of the
    # generic dashboard root.
    if redirect_to == "/" and payload.pathname and payload.pathname != "/":
        redirect_to = "/review"
    return session_response(next_actor, redirect_to=redirect_to)


@router.delete("/user", status_code=status.HTTP_204_NO_CONTENT)
async def clear_debug_session(request: Request, response: Response, session: DbSession) -> Response:
    """End a demo session without leaving a stale FastAPI cookie behind."""
    settings = get_settings()
    if not settings.debug_demo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    await revoke_session(session, request.cookies.get(settings.cookie_name))
    response.delete_cookie(settings.cookie_name, path="/")
    return response


@router.post("/bootstrap", response_model=SessionResponse)
async def bootstrap_local_debug_session(response: Response, session: DbSession) -> SessionResponse:
    """Open the explicitly enabled, disposable demo workspace."""
    settings = get_settings()
    # The public demo intentionally runs with production HTTP settings. Its
    # bootstrap route is nevertheless safe to expose because this endpoint is
    # gated solely by the explicit debug-demo flag and creates a session for a
    # seeded disposable account; a real facility deployment leaves that flag
    # disabled.
    if not settings.debug_demo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    exists = (
        await session.execute(select(users.c.id).where(users.c.id == settings.demo_switcher_user_id).limit(1))
    ).first()
    if not exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Demo administrator not found.")
    token = await create_session(session, settings.demo_switcher_user_id)
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.session_ttl_days * 24 * 60 * 60,
        path="/",
    )
    return session_response(await get_actor_for_token(session, token))
