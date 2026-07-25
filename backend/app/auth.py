from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request, status
from sqlalchemy import and_, case, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db.tables import (
    api_sessions,
    auth_login_attempts,
    organization_members,
    organization_role_policies,
    organizations,
    people,
    shows,
    users,
)
from app.permissions import policy_grants
from app.security import hash_session_token, new_session_token, verify_node_scrypt_password

LOGIN_FAILURE_LIMIT = 5
LOGIN_FAILURE_WINDOW = timedelta(minutes=10)
LOGIN_LOCKOUT = timedelta(minutes=15)


@dataclass(frozen=True)
class Membership:
    organization_id: str
    organization_name: str
    organization_slug: str
    currency: str
    role: str


@dataclass(frozen=True)
class Actor:
    session_token_hash: str
    authenticated_user_id: str
    user_id: str
    user_name: str | None
    memberships: list[Membership]
    active_organization: Membership | None
    person_id: str | None
    person_name: str | None
    person_role: str | None
    permissions: frozenset[str]
    active_show_id: str | None
    active_show_title: str | None

    @property
    def organization_id(self) -> str:
        if not self.active_organization:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No active post-house membership.")
        return self.active_organization.organization_id


async def _memberships(session: AsyncSession, user_id: str) -> list[Membership]:
    rows = (
        await session.execute(
            select(
                organizations.c.id,
                organizations.c.name,
                organizations.c.slug,
                organizations.c.currency,
                organization_members.c.role,
            )
            .join(organization_members, organization_members.c.organization_id == organizations.c.id)
            .where(organization_members.c.user_id == user_id)
            .order_by(organizations.c.name, organizations.c.id)
        )
    ).all()
    return [Membership(row.id, row.name, row.slug, row.currency, row.role) for row in rows]


async def _actor_permissions(
    session: AsyncSession, membership: Membership | None, person_role: str | None
) -> frozenset[str]:
    if not membership:
        return frozenset()
    if membership.role in {"owner", "admin"}:
        return frozenset(
            {
                "manage_settings",
                "manage_production",
                "do_assigned_work",
                "sign_off_work",
                "manage_qc_delivery",
                "manage_commercial",
                "manage_catering",
                "view_all_operations",
            }
        )
    if membership.role == "client":
        return frozenset({"sign_off_work"})
    if not person_role:
        return frozenset()
    policy = (
        await session.execute(
            select(organization_role_policies.c.permissions).where(
                and_(
                    organization_role_policies.c.organization_id == membership.organization_id,
                    organization_role_policies.c.role == person_role,
                )
            )
        )
    ).first()
    from app.permissions import normalize_permission

    return frozenset(
        permission
        for permission in (normalize_permission(value) for value in (policy.permissions if policy else []))
        if permission
    )


async def _record_failed_login(session: AsyncSession, email: str, now: datetime) -> None:
    reset_before = now - LOGIN_FAILURE_WINDOW
    lock_until = now + LOGIN_LOCKOUT
    statement = insert(auth_login_attempts).values(
        email=email,
        failed_attempts=1,
        window_started_at=now,
        last_attempt_at=now,
        locked_until=None,
    )
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[auth_login_attempts.c.email],
            set_={
                "failed_attempts": case(
                    (auth_login_attempts.c.window_started_at <= reset_before, 1),
                    else_=auth_login_attempts.c.failed_attempts + 1,
                ),
                "window_started_at": case(
                    (auth_login_attempts.c.window_started_at <= reset_before, now),
                    else_=auth_login_attempts.c.window_started_at,
                ),
                "last_attempt_at": now,
                "locked_until": case(
                    (
                        and_(
                            auth_login_attempts.c.window_started_at > reset_before,
                            auth_login_attempts.c.failed_attempts + 1 >= LOGIN_FAILURE_LIMIT,
                        ),
                        lock_until,
                    ),
                    else_=None,
                ),
            },
        )
    )
    await session.commit()


async def authenticate_password(session: AsyncSession, email: str, password: str) -> tuple[str, str | None]:
    now = datetime.now(UTC)
    normalized_email = email.lower().strip()
    attempt = (
        await session.execute(
            select(auth_login_attempts.c.locked_until).where(auth_login_attempts.c.email == normalized_email)
        )
    ).first()
    if attempt and attempt.locked_until and attempt.locked_until > now:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email or password is incorrect.")

    user = (
        await session.execute(
            select(users.c.id, users.c.name, users.c.password_hash)
            .where(func.lower(users.c.email) == normalized_email)
            .limit(1)
        )
    ).first()
    if not user or not verify_node_scrypt_password(password, user.password_hash):
        await _record_failed_login(session, normalized_email, now)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email or password is incorrect.")

    await session.execute(delete(auth_login_attempts).where(auth_login_attempts.c.email == normalized_email))
    await session.commit()
    return user.id, user.name


async def create_session(session: AsyncSession, user_id: str, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    token = new_session_token()
    now = datetime.now(UTC)
    await session.execute(
        insert(api_sessions).values(
            token_hash=hash_session_token(token, settings.session_secret),
            user_id=user_id,
            expires_at=now + timedelta(days=settings.session_ttl_days),
            created_at=now,
            last_seen_at=now,
        )
    )
    await session.commit()
    return token


async def revoke_session(session: AsyncSession, token: str | None) -> None:
    if not token:
        return
    await session.execute(
        delete(api_sessions).where(
            api_sessions.c.token_hash == hash_session_token(token, get_settings().session_secret)
        )
    )
    await session.commit()


async def get_actor_for_token(session: AsyncSession, token: str) -> Actor:
    """Resolve an opaque API session and persist safe context fallbacks."""
    settings = get_settings()
    now = datetime.now(UTC)
    token_hash = hash_session_token(token, settings.session_secret)
    row = (
        await session.execute(
            select(
                api_sessions.c.user_id,
                api_sessions.c.impersonated_user_id,
                api_sessions.c.active_organization_id,
                api_sessions.c.active_show_id,
            )
            .where(and_(api_sessions.c.token_hash == token_hash, api_sessions.c.expires_at > now))
            .limit(1)
        )
    ).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired. Please sign in again.")

    effective_user_id = row.impersonated_user_id or row.user_id
    memberships = await _memberships(session, effective_user_id)
    active_organization = next(
        (membership for membership in memberships if membership.organization_id == row.active_organization_id),
        memberships[0] if memberships else None,
    )
    person = None
    user = (await session.execute(select(users.c.name).where(users.c.id == effective_user_id).limit(1))).first()
    if active_organization:
        person = (
            await session.execute(
                select(people.c.id, people.c.name, people.c.role).where(
                    and_(
                        people.c.organization_id == active_organization.organization_id,
                        people.c.user_id == effective_user_id,
                    )
                )
            )
        ).first()

    active_show = None
    if active_organization and row.active_show_id:
        active_show = (
            await session.execute(
                select(shows.c.id, shows.c.title).where(
                    and_(
                        shows.c.id == row.active_show_id,
                        shows.c.organization_id == active_organization.organization_id,
                    )
                )
            )
        ).first()

    # Membership removal and deleted shows must not leave a stale selection in
    # the session. Repair it as part of resolving the signed-in actor.
    await session.execute(
        update(api_sessions)
        .where(api_sessions.c.token_hash == token_hash)
        .values(
            last_seen_at=now,
            active_organization_id=active_organization.organization_id if active_organization else None,
            active_show_id=active_show.id if active_show else None,
        )
    )
    await session.commit()
    return Actor(
        session_token_hash=token_hash,
        authenticated_user_id=row.user_id,
        user_id=effective_user_id,
        user_name=user.name if user else None,
        memberships=memberships,
        active_organization=active_organization,
        person_id=person.id if person else None,
        person_name=person.name if person else None,
        person_role=person.role if person else None,
        permissions=await _actor_permissions(session, active_organization, person.role if person else None),
        active_show_id=active_show.id if active_show else None,
        active_show_title=active_show.title if active_show else None,
    )


async def get_actor(request: Request, session: AsyncSession) -> Actor:
    token = request.cookies.get(get_settings().cookie_name)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign-in required.")
    return await get_actor_for_token(session, token)


async def set_active_organization(session: AsyncSession, actor: Actor, organization_id: str) -> None:
    if not any(membership.organization_id == organization_id for membership in actor.memberships):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not a member of that post house.")
    await session.execute(
        update(api_sessions)
        .where(api_sessions.c.token_hash == actor.session_token_hash)
        .values(active_organization_id=organization_id, active_show_id=None)
    )
    await session.commit()


async def set_active_show(session: AsyncSession, actor: Actor, show_id: str | None) -> None:
    if show_id is not None:
        record = (
            await session.execute(
                select(shows.c.id).where(and_(shows.c.id == show_id, shows.c.organization_id == actor.organization_id))
            )
        ).first()
        if not record:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Show not found.")
    await session.execute(
        update(api_sessions).where(api_sessions.c.token_hash == actor.session_token_hash).values(active_show_id=show_id)
    )
    await session.commit()


async def require_permission(session: AsyncSession, actor: Actor, permission: str) -> None:
    if not await has_permission(session, actor, permission):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied.")


async def has_permission(session: AsyncSession, actor: Actor, permission: str) -> bool:
    organization = actor.active_organization
    if not organization:
        return False
    return policy_grants(permission, organization.role, list(actor.permissions))


async def require_any_permission(session: AsyncSession, actor: Actor, *permissions: str) -> None:
    if not any([await has_permission(session, actor, permission) for permission in permissions]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied.")


async def switch_debug_user(session: AsyncSession, actor: Actor, user_id: str | None) -> None:
    settings = get_settings()
    if not settings.debug_demo or actor.authenticated_user_id != settings.demo_switcher_user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Demo administrator sign-in required.")
    if user_id is not None:
        exists = (await session.execute(select(users.c.id).where(users.c.id == user_id).limit(1))).first()
        if not exists:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Debug user not found.")
        membership = (
            await session.execute(
                select(organization_members.c.user_id).where(organization_members.c.user_id == user_id).limit(1)
            )
        ).first()
        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Debug user has no post-house membership."
            )
    await session.execute(
        update(api_sessions)
        .where(api_sessions.c.token_hash == actor.session_token_hash)
        .values(impersonated_user_id=user_id, active_organization_id=None, active_show_id=None)
    )
    await session.commit()


def can_switch_debug_user(actor: Actor) -> bool:
    settings = get_settings()
    return settings.debug_demo and actor.authenticated_user_id == settings.demo_switcher_user_id
