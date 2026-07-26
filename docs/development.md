# Development and testing guide

## Local setup

Follow the [Quick start](../README.md#quick-start) first. The normal local loop is:

~~~bash
# Terminal 1
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

# Terminal 2
pnpm dev -- --port 5000
~~~

Both processes read the root `.env.local`; set `POSTPILOT_API_ORIGIN` to the
local FastAPI URL so Next.js can forward `/v1` requests during development.
Use `POSTPILOT_DEBUG_DEMO=true` only for a local or controlled test database.
It exposes clearly labelled debug user and organisation switchers that operate
on persistent data.

## Database changes

FastAPI owns migrations and the live PostgreSQL contract. The historical SQL
files under `drizzle/` are an immutable bootstrap snapshot used only by the
first Alembic revision; no Node ORM or Node migration process is deployed.

~~~bash
cd backend
.venv/bin/alembic upgrade head
.venv/bin/python -m app.demo_seed
~~~

Do not edit a migration that has already been applied outside a disposable local database. Create a forward-only migration instead.

Create a forward-only Alembic revision for a schema change; do not edit a
released migration outside a disposable local database. Keep schema, Pydantic
validation, Zod form validation, tenant scoping, seed data, and tests aligned.
A new tenant-owned table must be included in the tenant-boundary review rather
than relying on UI filtering.

## Validation and test commands

~~~bash
# Static checks
pnpm exec tsc --noEmit
pnpm lint

# Authoritative backend checks
cd backend
.venv/bin/ruff format --check .
.venv/bin/ruff check .
.venv/bin/pytest

# Full browser suite, including credentials auth
pnpm test:e2e

# Focused suites
pnpm test:shows
pnpm test:bookings
pnpm test:approvals
pnpm test:deliveries
~~~

See [tests/README.md](../tests/README.md) for suite ownership, conventions, and coverage notes. FastAPI backend coverage is run with `pytest`; its focused tests live in `backend/tests/`.

## How to investigate a problem

Start at the boundary that is failing.

| Symptom | First places to inspect |
| --- | --- |
| Wrong tenant data, 403, or 404 | `backend/app/auth.py`, the relevant `backend/app/api/routes/` module, and its resource-scope query |
| User cannot see or change something | `backend/app/permissions.py`, the active-organisation role policy, and episode team assignment |
| Workflow does not advance | `backend/app/workflow_state.py`, named signers, operational gate checks, and approval activity |
| Booking looks wrong or conflicts | `backend/app/booking_logic.py`, bookings API route, and the custom Gantt component |
| Budget/rate total is unexpected | `backend/app/budget_logic.py`, `rate_card_logic.py`, actual-time submission, and linked budget/PO records |
| Manifest cannot dispatch/sign off | `backend/app/delivery_lifecycle.py`, delivery route, and the episode manifest item state |
| Sign-in or redirect behaves unexpectedly | `backend/app/auth.py`, `backend/app/security.py`, and the frontend `src/proxy.ts` session guard |

## Development conventions

- Keep database access and business rules out of React components. Use the typed
  FastAPI clients in `src/lib/postpilot-api-*.ts` and FastAPI route/domain code.
- Use React Hook Form and Zod for new forms and mutations.
- Make permission checks capability-based. Do not add workflow or operational behaviour that assumes a fixed job title.
- Do not accept an `organizationId` supplied by a browser as authority.
- Prefer external references to mandatory media uploads.
- Add activity/audit records for meaningful operational transitions.
- Run the smallest focused test suite that proves the change, then static checks appropriate to the risk.

## Demo data

The seed script is intended for development, isolated tenant checks, and product demonstrations. It creates fixed demo organisations and can reset their fixture data. Never run it against a facility database that contains real work.
