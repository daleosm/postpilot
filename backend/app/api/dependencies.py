from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import Actor, get_actor
from app.db.session import get_db_session

DbSession = Annotated[AsyncSession, Depends(get_db_session)]


async def current_actor(request: Request, session: DbSession) -> Actor:
    return await get_actor(request, session)


CurrentActor = Annotated[Actor, Depends(current_actor)]
