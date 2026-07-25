"""Bootstrap the historical PostPilot schema with the Python migration runner.

Revision ID: 20260724_00
Revises:
Create Date: 2026-07-24

PostPilot's first 113 schema revisions were authored before the FastAPI
cutover.  The SQL itself is database migration history rather than application
code, so this revision executes that immutable history when bootstrapping an
empty PostgreSQL database. Existing databases are safely stamped: if the core
``organizations`` table already exists, the legacy history is not replayed.

Keeping this in Alembic means Python owns schema application in CI and in the
Kubernetes migration Job; Node/Drizzle is no longer required to deploy the
application.
"""

import re
from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa

from alembic import op

revision: str = "20260724_00"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _legacy_sql_directory() -> Path:
    """Resolve the checked-in legacy SQL both locally and in the API image."""

    local_root = Path(__file__).resolve().parents[3] / "drizzle"
    image_root = Path("/app/drizzle")
    for candidate in (local_root, image_root):
        if candidate.is_dir():
            return candidate
    raise RuntimeError("PostPilot legacy SQL migrations are not present in this image.")


_DOLLAR_QUOTE = re.compile(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$")


def _iter_sql_statements(source: str) -> list[str]:
    """Split historical PostgreSQL SQL without breaking quoted function bodies.

    Drizzle normally emits ``--> statement-breakpoint`` comments, but a few
    historical files contain several ordinary statements within one breakpoint.
    asyncpg prepares each call and deliberately rejects multi-statement strings,
    so Alembic must execute those statements individually.  A plain
    ``str.split(';')`` is unsafe for trigger functions and other dollar-quoted
    PostgreSQL bodies, hence this intentionally small SQL-aware splitter.
    """

    statements: list[str] = []
    buffer: list[str] = []
    index = 0
    quote: str | None = None
    dollar_quote: str | None = None
    line_comment = False
    block_comment = False

    while index < len(source):
        character = source[index]
        next_character = source[index + 1] if index + 1 < len(source) else ""

        if line_comment:
            buffer.append(character)
            if character == "\n":
                line_comment = False
            index += 1
            continue

        if block_comment:
            buffer.append(character)
            if character == "*" and next_character == "/":
                buffer.append(next_character)
                index += 2
                block_comment = False
            else:
                index += 1
            continue

        if dollar_quote:
            if source.startswith(dollar_quote, index):
                buffer.append(dollar_quote)
                index += len(dollar_quote)
                dollar_quote = None
            else:
                buffer.append(character)
                index += 1
            continue

        if quote:
            buffer.append(character)
            if character == quote:
                if next_character == quote:
                    buffer.append(next_character)
                    index += 2
                    continue
                quote = None
            index += 1
            continue

        if character == "-" and next_character == "-":
            buffer.extend((character, next_character))
            index += 2
            line_comment = True
            continue
        if character == "/" and next_character == "*":
            buffer.extend((character, next_character))
            index += 2
            block_comment = True
            continue
        if character in ("'", '"'):
            buffer.append(character)
            quote = character
            index += 1
            continue
        if character == "$":
            match = _DOLLAR_QUOTE.match(source, index)
            if match:
                dollar_quote = match.group(0)
                buffer.append(dollar_quote)
                index += len(dollar_quote)
                continue
        if character == ";":
            buffer.append(character)
            statement = "".join(buffer).strip()
            if statement:
                statements.append(statement)
            buffer.clear()
            index += 1
            continue

        buffer.append(character)
        index += 1

    statement = "".join(buffer).strip()
    if statement:
        statements.append(statement)
    return statements


def upgrade() -> None:
    connection = op.get_bind()
    already_bootstrapped = connection.execute(sa.text("SELECT to_regclass('public.organizations')")).scalar_one()
    if already_bootstrapped:
        return

    for migration in sorted(_legacy_sql_directory().glob("*.sql")):
        # The historical files were individual Drizzle migrations. Preserve
        # that boundary because PostgreSQL cannot safely use a newly added enum
        # value in a constraint until the ALTER TYPE transaction is committed.
        # Alembic's autocommit block is its supported escape hatch for exactly
        # that PostgreSQL DDL rule.
        with op.get_context().autocommit_block():
            for sql in _iter_sql_statements(migration.read_text(encoding="utf-8")):
                connection.exec_driver_sql(sql)


def downgrade() -> None:
    pass
