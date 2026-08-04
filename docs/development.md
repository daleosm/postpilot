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

# Financial test layers (from the repository root)
pnpm test:backend:unit
pnpm test:backend:api
pnpm test:backend:golden

# Full browser suite, including credentials auth
pnpm test:e2e

# Focused suites
pnpm test:shows
pnpm test:bookings
pnpm test:approvals
pnpm test:deliveries
~~~

See [tests/README.md](../tests/README.md) for browser-suite ownership and
[backend/tests/README.md](../backend/tests/README.md) for the backend financial
test layers. FastAPI backend coverage is run with `pytest`; its focused tests
live in `backend/tests/`.

## CI security checks

GitHub Actions runs the quick security gate before the full app test suite:

- Trivy scans dependencies and tracked secrets, then scans production images.
- Checkov validates the two EKS Terraform configurations.
- CodeQL scans the TypeScript and Python source with the `security-extended`
  query suite; findings are published to GitHub code scanning.
- Pushes to `main` also run two OWASP ZAP **passive** checks against an
  ephemeral production-mode Next.js/FastAPI runtime: a public sign-in-page
  baseline and a safe scan of FastAPI's OpenAPI document. Their HTML and JSON
  reports are CI artifacts. Both scans are unauthenticated and do not send
  active attack payloads. The reviewed
  [ZAP alert policy](../.github/zap/alert-policy.json) is the real gate while
  ZAP's `-I` remains temporarily enabled: it blocks High/Critical, reports
  Medium/Low/Informational, and requires any false-positive exception to have
  a narrow plugin/URL match, reason, review date, and expiry date. Medium is
  explicitly review-only until the recorded policy review promotes it.

The frontend applies a nonce-based Content Security Policy, clickjacking
protection, MIME sniffing protection, referrer and browser-feature policies,
and removes the `X-Powered-By` framework header. The opener policy deliberately
uses `same-origin-allow-popups` so Microsoft Entra sign-in remains functional.
COEP is intentionally not enabled: an overly strict cross-origin embedder
policy can prevent MSAL's silent-authentication iframe from using the existing
Entra browser session.

The separate **PostPilot active DAST** workflow is manual or weekly (Monday
02:37 UTC), never triggered by a pull request or deployment. It starts a fresh
PostgreSQL service on a GitHub-hosted runner, migrates and seeds it, then adds
one client-scoped scanner account used only in that ephemeral database. ZAP
uses the real browser email/password sign-in form and verifies its authenticated
session before scanning. Its tracked Automation Framework context imports the
FastAPI OpenAPI document but only allows the frontend sign-in surface and the
low-privilege dashboard/shows/episodes/bookings/approvals API areas. It excludes
health/metrics/schema paths, sign-out and password/SSO flows, debug controls,
tenant switching, commercial endpoints, settings, delivery/QC, catering, and
other high-side-effect operations. The same reviewed policy blocks unaccepted
High/Critical alerts and uploads the JSON/HTML report as a 30-day artifact.

Active DAST is deliberately **not** the authorisation test suite. Its one
logged-in account is useful for common web/API weaknesses such as injection,
headers, cookies, sessions, and input handling. FastAPI PostgreSQL integration
tests remain authoritative for tenant isolation, capability policy, and record
ownership; Playwright remains authoritative for the corresponding browser
journeys (for example, that one user cannot edit another user’s record).

Never point active DAST at a real facility deployment.

An external passive ZAP baseline is intentionally not configured yet. Add it
only once there is a dedicated HTTPS staging URL and a protected GitHub
environment for it; it can then validate the real TLS, reverse-proxy headers,
redirects, cookie flags, and ingress behaviour. It must never target the public
demo or a customer system.

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
