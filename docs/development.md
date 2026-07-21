# Development and testing guide

## Local setup

Follow the [Quick start](../README.md#quick-start) first. The normal local loop is:

~~~bash
pnpm dev -- --port 5000
~~~

Use `POSTPILOT_DEBUG_DEMO=true` only for a local or controlled test database. It exposes clearly labelled debug user and organisation switchers that operate on persistent data.

## Database changes

The Drizzle schema in `src/lib/db/schema.ts` is the source of truth.

~~~bash
# After changing the schema
pnpm db:generate

# Apply the generated migration
pnpm db:migrate

# Refresh demonstration data where appropriate
pnpm db:seed
~~~

Do not edit a migration that has already been applied outside a disposable local database. Create a forward-only migration instead.

Keep schema, migration, Zod validation, tenant scoping, seed data, and tests aligned. A new tenant-owned table must be included in the tenant-boundary review rather than relying on UI filtering.

## Validation and test commands

~~~bash
# Static checks
pnpm exec tsc --noEmit
pnpm lint

# Full browser suite, including credentials auth
pnpm test:e2e

# Focused suites
pnpm test:shows
pnpm test:episodes
pnpm test:bookings
pnpm test:approvals
pnpm test:workflow
pnpm test:work-orders
pnpm test:budget
pnpm test:qc
pnpm test:tenant-isolation
~~~

See [tests/README.md](../tests/README.md) for suite ownership, conventions, and coverage notes.

## How to investigate a problem

Start at the boundary that is failing.

| Symptom | First places to inspect |
| --- | --- |
| Wrong tenant data, 403, or 404 | `src/lib/organizations.ts`, tenant-resource helpers, the relevant `src/server/data` module, then the route handler |
| User cannot see or change something | Capability helper, active-organisation role policy, and episode team assignment |
| Workflow does not advance | Current episode state, named signers, workflow helper, operational gates, and approval activity |
| Booking looks wrong or conflicts | Booking conflict/option helpers, booking API, and the custom Gantt component |
| Budget/rate total is unexpected | Rate resolution, budget data, actual-time submission, linked budget/PO records |
| Manifest cannot dispatch/sign off | Delivery lifecycle, workflow-gate helpers, and episode manifest item state |
| Sign-in or redirect behaves unexpectedly | Auth configuration, login throttle, redirect helper, and `proxy.ts` |

## Development conventions

- Keep database access out of React components where practical; use server data/domain helpers.
- Use React Hook Form and Zod for new forms and mutations.
- Make permission checks capability-based. Do not add workflow or operational behaviour that assumes a fixed job title.
- Do not accept an `organizationId` supplied by a browser as authority.
- Prefer external references to mandatory media uploads.
- Add activity/audit records for meaningful operational transitions.
- Run the smallest focused test suite that proves the change, then static checks appropriate to the risk.

## Demo data

The seed script is intended for development, isolated tenant checks, and product demonstrations. It creates fixed demo organisations and can reset their fixture data. Never run it against a facility database that contains real work.
