# PostPilot API

FastAPI is the sole target backend for PostPilot. Next.js remains the React/
TypeScript frontend only; it must not contain business rules, database access,
authentication, or persistent API routes.

## Stack

- FastAPI + Pydantic v2 for HTTP and validation
- SQLAlchemy Core/async + `asyncpg` for PostgreSQL
- Alembic for schema ownership
- Opaque, hashed HTTP-only sessions owned by FastAPI
- Existing tenant memberships and tenant capability policies

## Local development

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
# From the repository root, copy and configure .env.example as .env.local.
# Settings loads ../.env.local when this command is run from backend/.
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

For the Next.js frontend, set `POSTPILOT_API_ORIGIN=http://127.0.0.1:8000` in
the root development environment. Next then proxies browser calls to `/v1/*`
to FastAPI. Server components use `POSTPILOT_API_INTERNAL_URL` when supplied;
in Kubernetes it is the private `http://postpilot-api.postpilot.svc.cluster.local`
service address. The public ALB routes `/v1/*` directly to FastAPI in
production.

The first Alembic revision bootstraps an empty PostgreSQL database from the
checked-in historical SQL snapshot. On an existing database it safely stamps
the baseline instead of replaying the schema. `app.demo_seed` then provides
the opt-in five-tenant local and CI fixture workspace.

## Authentication migration

The existing UI uses Node `crypto.scrypt` values shaped as
`scrypt$base64url-salt$base64url-key`. `app.security` verifies that format
directly, so existing user passwords continue to work without a reset.

FastAPI sessions are opaque random values stored only in an HTTP-only cookie.
Only their SHA-256 hash is stored in PostgreSQL. A session resolves the current
user, their real memberships, a valid active organisation, current person, and
tenant capability policy on every request.

## Backend contract

1. New backend schema changes are Alembic migrations.
2. Every endpoint must scope database access from the authenticated active
   tenant; client-provided tenant IDs are never authority.
3. FastAPI and its pytest suite are authoritative for server behaviour.
   Playwright remains TypeScript because it verifies the React interface.
