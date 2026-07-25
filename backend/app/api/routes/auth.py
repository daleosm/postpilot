from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.api.dependencies import CurrentActor, DbSession
from app.api.schemas import LoginRequest, SessionResponse
from app.auth import Actor, authenticate_password, can_switch_debug_user, create_session, get_actor_for_token
from app.config import get_settings
from app.db.tables import api_sessions

router = APIRouter(prefix="/auth", tags=["auth"])


def session_response(actor: Actor, *, redirect_to: str | None = None) -> SessionResponse:
    return SessionResponse(
        authenticated_user_id=actor.authenticated_user_id,
        user_id=actor.user_id,
        user_name=actor.user_name,
        active_organization_id=actor.active_organization.organization_id if actor.active_organization else None,
        memberships=[
            {
                "organization_id": item.organization_id,
                "organization_name": item.organization_name,
                "organization_slug": item.organization_slug,
                "currency": item.currency,
                "role": item.role,
            }
            for item in actor.memberships
        ],
        person=(
            {"id": actor.person_id, "name": actor.person_name, "role": actor.person_role}
            if actor.person_id and actor.person_name and actor.person_role
            else None
        ),
        permissions=sorted(actor.permissions),
        active_show=(
            {"id": actor.active_show_id, "title": actor.active_show_title}
            if actor.active_show_id and actor.active_show_title
            else None
        ),
        debug_can_switch=can_switch_debug_user(actor),
        redirect_to=redirect_to,
    )


@router.post("/sign-in", response_model=SessionResponse)
async def sign_in(payload: LoginRequest, response: Response, session: DbSession) -> SessionResponse:
    user_id, _ = await authenticate_password(session, str(payload.email), payload.password)
    token = await create_session(session, user_id)
    settings = get_settings()
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


@router.post("/sign-out", status_code=status.HTTP_204_NO_CONTENT)
async def sign_out(response: Response, session: DbSession, actor: CurrentActor) -> Response:
    from sqlalchemy import delete

    await session.execute(delete(api_sessions).where(api_sessions.c.token_hash == actor.session_token_hash))
    await session.commit()
    # Returning the injected Response bypasses FastAPI's decorator default.
    # Set the intended no-content status explicitly so every client observes a
    # real HTTP 204 rather than an invalid response without a status code.
    response.status_code = status.HTTP_204_NO_CONTENT
    response.delete_cookie(get_settings().cookie_name, path="/")
    return response


@router.get("/session", response_model=SessionResponse)
async def read_session(actor: CurrentActor) -> SessionResponse:
    return session_response(actor)
