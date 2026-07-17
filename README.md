# PostPilot

> A multi-tenant operations platform for episodic TV post-production.

PostPilot gives post houses one focused workspace for seasons, episodes, workflow sign-off, room bookings, artists, work orders, QC, budgets, commercial records, and client handoff.

It is built for the practical rhythm of television post: multiple episodes in flight, specialist rooms under pressure, approvals moving through departments, and a clear separation between internal operations and client-facing work.

## Highlights

| Area | What PostPilot handles |
| --- | --- |
| Episode operations | Show → season → episode planning, deadlines, team assignments, workflow state, QC status, and activity |
| Workflow & approvals | Ordered, configurable post stages with per-episode signers and approval queues |
| Bookings | Room, artist, guest, and episode bookings in a 09:00–18:00 Gantt calendar with conflicts, buffers, and pencil holds |
| Work orders | Internal and external work, approval lifecycle, actual time, and drag-to-reserve work into a formal room booking |
| QC | Reports, individual issues, correction work, verification, and re-QC |
| Budget & commercial | Rate cards, live booking-derived costs, client/vendor CRM, purchase orders, and budget tracking |
| Facility services | Catering requests tied to people and bookings, with runner fulfilment and cost capture |

## Workflow-first, not media hosting

PostPilot is deliberately a workflow system, not a video-storage platform. It does not require teams to upload masters, cuts, or production media. Facilities retain their existing media and review tools, and can attach secure external links in notes when appropriate.

## Tech stack

- [Next.js](https://nextjs.org/) 16 App Router, React 19, TypeScript
- PostgreSQL and [Drizzle ORM](https://orm.drizzle.team/)
- [Auth.js](https://authjs.dev/) email one-time passcodes
- [Zod](https://zod.dev/) and React Hook Form
- Tailwind CSS and [HeroUI](https://www.heroui.com/)
- Playwright browser, integration, and tenant-isolation tests

## Quick start

### Prerequisites

- Node.js 20+
- pnpm
- PostgreSQL 14+

### Install and run

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm db:seed
pnpm exec next dev --port 5000
```

Open [http://localhost:5000](http://localhost:5000).

### Environment

```dotenv
DATABASE_URL=postgres://postgres:postgres@localhost:5432/posthouse
NEXTAUTH_SECRET=replace-with-a-long-random-string
NEXTAUTH_URL=http://localhost:5000
POSTPILOT_DEBUG_DEMO=true
RESEND_API_KEY=
EMAIL_FROM=PostPilot <signin@example.com>
```

Set a real `NEXTAUTH_SECRET` before using non-debug authentication. In production, set `POSTPILOT_DEBUG_DEMO=false` and configure email delivery.

## Demo workspace

The seed creates five isolated post houses with 21 shows and 84 episodes. It includes distinct people, rooms, workflows, bookings, catering, QC, CRM, budgets, vendor POs, client POs, and live operational activity per tenant.

Debug mode provides persistent user and tenant switchers backed by PostgreSQL. It is designed for testing tenant and permission boundaries; edits remain when you switch away and back.

Try the Work Order → Booking flow:

1. Switch to **Horizon Finish**.
2. Switch to **Mori Vale**.
3. Open **Bookings**.
4. Drag **Prep revised captions and turnover package** from **Ready to schedule** onto a free room/time, or select it with the keyboard.
5. Confirm actual time when the work is done. The booking expands to confirmed actual time in the calendar and updates its episode cost/audit history.

> `pnpm db:seed` rebuilds only the five known demo organizations. It does not delete unrelated organizations or global Auth.js users.

## Architecture

### Tenancy and access

- `organizations` are tenants; `organizationMembers` defines a user's tenant memberships.
- The active organization is kept in an HTTP-only cookie and revalidated against real memberships on every server request.
- All server reads and writes are scoped to the active organization. Browser-supplied organization IDs are never accepted as authority.
- Users are global identities; people are tenant-specific operational records.
- Roles are tenant-configurable, with capabilities governing access. The external **Guest** role is fixed and restricted to assigned/shared work.

### Application structure

```text
src/app/             App Router pages and route handlers
src/components/      UI, dialogs, Gantt calendar, and client interactions
src/server/data/     Server-only, tenant-scoped query functions
src/lib/             Auth, tenancy, permissions, database, validation, domain helpers
src/lib/db/schema.ts Drizzle schema
scripts/seed.ts      Multi-tenant debug dataset
drizzle/             SQL migrations and Drizzle journal
tests/               Playwright UI, integration, and isolation suites
```

## Database workflow

```bash
# Generate a migration after editing the Drizzle schema
pnpm db:generate

# Apply pending migrations
pnpm db:migrate

# Rebuild local demo tenants
pnpm db:seed
```

## Testing

Playwright uses a local server on port `5001` and requires `DATABASE_URL`.

```bash
# Static checks
pnpm exec tsc --noEmit
pnpm lint

# Broad suites
pnpm test:ui
pnpm test:integration
pnpm test:tenant-isolation

# Focused suites
pnpm test:shows
pnpm test:episodes
pnpm test:bookings
pnpm test:bookings-isolation
pnpm test:approvals
pnpm test:workflow
pnpm test:work-orders
pnpm test:budget
pnpm test:qc
```

The bookings suite covers conflicts, buffers, option holds, guest access, actual time, actual-time Gantt expansion, internal work-order reservations, cancelled-booking replacement, concurrent reservation safety, tenant isolation, and drag/drop behavior.

## Contributing

Keep changes tenant-safe and server-scoped. For database changes, add a Drizzle migration and update relevant seed/test coverage. Run type checks, lint, and the focused module suite before opening a pull request.
