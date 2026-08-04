"""Seed the one deliberately low-privilege account used by active DAST.

This module is intentionally separate from :mod:`app.demo_seed`: normal
development/demo data must not advertise a scanner account.  The weekly GitHub
Actions job invokes it only after recreating a disposable PostgreSQL database.
"""

from __future__ import annotations

import asyncio
import os

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db import tables as t
from app.db.session import get_engine
from app.demo_seed import TENANT_IDS
from app.security import hash_node_scrypt_password

DAST_USER_ID = "user_dast_active_scan"
DAST_PERSON_ID = "d45a0001-0000-4000-8000-000000000001"
DAST_EMAIL_ENV = "POSTPILOT_DAST_EMAIL"
DAST_PASSWORD_ENV = "POSTPILOT_DAST_PASSWORD"


def _required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} must be set for the active DAST seed.")
    return value


async def seed() -> None:
    """Create an idempotent, client-scoped scanner identity in one demo tenant."""

    email = _required_environment(DAST_EMAIL_ENV).lower()
    password = _required_environment(DAST_PASSWORD_ENV)
    password_hash = hash_node_scrypt_password(password)
    organization_id = TENANT_IDS[0]
    engine = get_engine()
    async with engine.begin() as connection:
        await connection.execute(
            pg_insert(t.users)
            .values(
                id=DAST_USER_ID,
                name="Active DAST scanner",
                email=email,
                password_hash=password_hash,
            )
            .on_conflict_do_update(
                index_elements=[t.users.c.id],
                set_={
                    "name": "Active DAST scanner",
                    "email": email,
                    "password_hash": password_hash,
                },
            )
        )
        # `client` is the product's least-privileged tenant membership.  It
        # cannot use debug switching, administer settings, or manage money.
        await connection.execute(
            pg_insert(t.organization_members)
            .values(organization_id=organization_id, user_id=DAST_USER_ID, role="client")
            .on_conflict_do_update(
                index_elements=[t.organization_members.c.organization_id, t.organization_members.c.user_id],
                set_={"role": "client"},
            )
        )
        await connection.execute(
            pg_insert(t.people)
            .values(
                id=DAST_PERSON_ID,
                organization_id=organization_id,
                user_id=DAST_USER_ID,
                name="Active DAST scanner",
                email=email,
                role="client",
                availability="available",
                is_freelancer=False,
            )
            .on_conflict_do_update(
                index_elements=[t.people.c.id],
                set_={"name": "Active DAST scanner", "email": email, "role": "client"},
            )
        )
    print(f"Seeded the isolated active DAST account for {email}.")


if __name__ == "__main__":
    asyncio.run(seed())
