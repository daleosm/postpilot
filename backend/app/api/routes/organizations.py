from fastapi import APIRouter, HTTPException, Request, status

from app.api.dependencies import CurrentActor, DbSession
from app.api.production import require_episode_access, require_show_access
from app.api.routes.auth import session_response
from app.api.schemas import ActiveOrganizationRequest, SessionResponse
from app.auth import get_actor_for_token, set_active_organization
from app.config import get_settings

router = APIRouter(prefix="/organizations", tags=["organizations"])


@router.post(
    "/active",
    response_model=SessionResponse,
    status_code=status.HTTP_200_OK,
)
async def switch_active_organization(
    payload: ActiveOrganizationRequest, request: Request, session: DbSession, actor: CurrentActor
) -> SessionResponse:
    await set_active_organization(session, actor, payload.organization_id)
    token = request.cookies.get(get_settings().cookie_name)
    if not token:
        raise RuntimeError("Authenticated request lost its session cookie.")
    next_actor = await get_actor_for_token(session, token)
    return session_response(next_actor, redirect_to=await tenant_redirect(session, next_actor, payload.pathname))


async def tenant_redirect(session: DbSession, actor: CurrentActor, pathname: str | None) -> str:
    """Keep a current nested route only when the new tenant owns its record.

    This is a navigation convenience only; the underlying show/episode endpoint still
    performs its own actor-aware tenant and assignment check.
    """
    if not pathname or not pathname.startswith("/") or pathname.startswith("//"):
        return "/"
    path = pathname.split("?", 1)[0]
    show_prefix = "/shows/"
    episode_prefix = "/episodes/"
    if path.startswith(show_prefix) and path.count("/") == 2:
        show_id = path.removeprefix(show_prefix)
        try:
            await require_show_access(session, actor, show_id)
        except HTTPException:  # detail is intentionally not exposed during a switch
            return "/"
        return path
    if path.startswith(episode_prefix) and path.count("/") == 2:
        episode_id = path.removeprefix(episode_prefix)
        try:
            await require_episode_access(session, actor, episode_id)
        except HTTPException:
            return "/"
        return path
    if path.startswith("/review/"):
        return "/"
    return path
