# PostPilot

> Open-source, self-hosted operations software for television post-production facilities.

PostPilot is a workflow-first operating system for episodic TV post. It brings episode workflow, sign-offs, bookings, rooms, people, QC, work orders, delivery manifests, budgets, CRM, purchase orders, and facility services into one tenant-safe application.

It is deliberately **not** a media-hosting platform. A post house keeps masters, cuts, project files, and review media in the storage, MAM, transfer, or review systems it already trusts. PostPilot records the operational work around them and can store an external reference where useful.

## Why open source and self-hosted?

Post facilities cannot afford to be blocked by a vendor outage, a slow support queue, or a cloud product changing under a live series. PostPilot is designed to be run by a facility on infrastructure it controls.

- **Your operations data stays under your control.** Run it on your own PostgreSQL database and infrastructure.
- **Keep working during vendor problems.** The codebase, migrations, and deployment are available to your team.
- **Fix urgent issues locally.** A competent in-house developer or trusted freelancer can inspect, patch, test, and deploy a fix without waiting on a proprietary vendor.
- **Build for real facility workflows.** Community contributions can address the different ways editorial, picture finishing, audio, QC, delivery, and finance teams work.
- **Avoid forced media migration.** PostPilot coordinates workflow and references; it does not ask facilities to move sensitive production media into a new platform.

Self-hosting is an operational responsibility, not a guarantee of zero downtime. A production deployment still needs backups, monitoring, tested upgrades, secure credentials, and someone responsible for it. The trade-off is that the facility—not an opaque third party—has the ability to diagnose and recover the system.

## Features

| Area | Operational coverage |
| --- | --- |
| Shows and episodes | Show → season → episode structure, deadlines, contacts, per-episode teams, and live activity |
| Multi-tenant operations | Isolated post-house workspaces, active-organisation switching, organisation memberships, tenant-scoped data access, and debug-only user/context switching for safe permission testing |
| Workflow and approvals | One configurable ordered workflow per facility, named episode signers, capability-based access, practical QC/delivery gates |
| Bookings | Room and person bookings, conflicts, buffers, option holds, guest attendance, copied episode sequences, and 09:00–18:00 Gantt scheduling |
| My time and work orders | Assigned work, actual time/overtime, internal or vendor work, billing status, and drag-to-book room reservations |
| QC | QC reports, individual issues, severity, timecode, resolutions, correction work, and re-QC history |
| Delivery | Episode delivery manifests, profile snapshots, required masters/stems/captions/metadata, external references, QC, dispatch, and receipt status |
| Budget and rates | Master, network, show, and episode rate cards; booking-derived costs; actuals; client invoicing readiness; and budgets by episode |
| CRM and procurement | Client/network/vendor accounts, operational contacts, vendor POs, client POs, allocations, and supplier actuals |
| Facility services | Catering requests, runner desk, fulfilment costs, and episode cost attribution |
| Workflow-only media model | No mandatory uploads or hosted review media; store operational metadata and external references while retaining project media in the facility’s existing systems |

## Core principles

1. **Workflow, not media storage.** No required uploads. Use references or secure links to the facility's existing systems.
2. **Tenant isolation by default.** Every operational request resolves an active organisation and is server-scoped to it.
3. **Roles are policy, not workflow logic.** Facilities can customise tenant roles and their capabilities. Workflow sign-off is assigned to named episode-team people, not a hard-coded job title.
4. **Live operational data.** Bookings, actual time, budgets, manifests, approvals, and activity are persisted in PostgreSQL.
5. **Simple, ordered workflow.** One current stage per episode, a clear state, optional early start, and human-readable gates rather than a dependency graph.

## Stack

- [Next.js](https://nextjs.org/) 16 App Router, [React](https://react.dev/) 19, and TypeScript
- PostgreSQL and [Drizzle ORM](https://orm.drizzle.team/)
- [Auth.js](https://authjs.dev/) credentials authentication (email and password)
- [Zod](https://zod.dev/) and React Hook Form for server/client validation
- Tailwind CSS and [HeroUI](https://www.heroui.com/)
- Playwright browser, integration, and tenant-isolation tests

## Quick start

### Prerequisites

- Node.js 20 or newer
- pnpm
- PostgreSQL 14 or newer

### 1. Configure the application

~~~bash
pnpm install
cp .env.example .env.local
~~~

Update .env.local for your local PostgreSQL instance:

~~~dotenv
DATABASE_URL=postgres://postgres:postgres@localhost:5432/posthouse
NEXTAUTH_SECRET=replace-with-a-long-random-string
NEXTAUTH_URL=http://localhost:5000

# Local demo controls only. Never enable this in production.
POSTPILOT_DEBUG_DEMO=true
~~~

Generate a secret, for example:

~~~bash
openssl rand -base64 32
~~~

### 2. Apply the schema and load the demo workspace

~~~bash
pnpm db:migrate
pnpm db:seed
~~~

### 3. Run it

~~~bash
pnpm dev -- --port 5000
~~~

Open [http://localhost:5000](http://localhost:5000).

The seeded credentials use the password **password**. They are strictly local demo credentials: replace them before exposing any deployment.

## Self-hosting in production

PostPilot is a standard Next.js application backed by PostgreSQL. It can run behind your usual reverse proxy, on a virtual machine, container platform, or internal infrastructure. There is intentionally no hosted PostPilot service required by the application.

Minimum production checklist:

1. Use a managed or properly backed-up PostgreSQL instance.
2. Set a long, unique **NEXTAUTH_SECRET** and the public **NEXTAUTH_URL**.
3. Set **POSTPILOT_DEBUG_DEMO=false** (or omit it completely).
4. Use HTTPS and configure your reverse proxy to forward the public host/protocol correctly.
5. Apply migrations as part of each release: **pnpm db:migrate**.
6. Build and run the application:

   ~~~bash
   pnpm build
   pnpm start
   ~~~

7. Back up the database, test restore procedures, monitor the app and database, and retain a documented rollback plan.

Before publishing a public fork or deploying to users, add a license that matches how you want the community to use and contribute to the project. This repository currently has no LICENSE file, so reuse rights are not yet defined by a standard open-source licence.

For the supplied GitHub Actions, container, Terraform, EKS, and Argo CD delivery path, see [infra/README.md](infra/README.md).

## Demo data and debug mode

**pnpm db:seed** creates five isolated example post houses, each with its own people, rooms, shows, episodes, workflow, bookings, commercial records, QC, delivery, and catering data. The seed is designed for local demonstration and testing.

With **POSTPILOT_DEBUG_DEMO=true**, the top bar provides clearly labelled debug user and organisation controls. They use the same persistent PostgreSQL data as the rest of the app, so edits remain after changing context. Debug controls are unavailable when debug mode is disabled.

Use this to verify access boundaries:

- a user only sees organisations they belong to;
- each organisation has separate operational data;
- client users see only the episodes and shared delivery/approval information assigned to them;
- role capability changes take effect within the active organisation.

## How the application works

### Request and data flow

~~~text
Browser / React client components
        │
        ├── Server-rendered App Router pages
        └── /api/* route handlers
                    │
                    ▼
   Active organisation + membership context
       authentication, capability, resource checks
                    │
                    ▼
       Server data-access and domain helpers
                    │
                    ▼
        Drizzle ORM → PostgreSQL
                    │
                    ▼
      Activity/audit records and derived UI state
~~~

The browser never supplies an organisation ID as authority. Every page and mutation obtains the authenticated or debug identity, resolves a valid active membership, and scopes resource lookups to that organisation before returning or changing data.

### Application layout

~~~text
src/
├── app/                       # Next.js App Router pages and HTTP route handlers
│   ├── api/                   # Tenant-scoped mutation/query endpoints
│   ├── bookings/              # Facility calendar and booking operations
│   ├── budget/                # Rates, costs, POs, client POs, invoices
│   ├── crm/                   # Client, network, production-company, and vendor accounts
│   ├── deliveries/            # Delivery register
│   ├── episodes/[episodeId]/  # Episode workspace and operational tabs
│   ├── review/                # Pending workflow sign-offs
│   ├── settings/              # Tenant roles, people, rooms, workflow, commercial settings
│   ├── shows/[showId]/        # Show operations workspace
│   └── sign-in/               # Credentials sign-in
├── components/                # UI, forms, dialogs, navigation, and custom Gantt calendar
├── lib/
│   ├── db/                    # Drizzle client and complete PostgreSQL schema
│   ├── validations/           # Zod validation schemas
│   ├── auth.ts                # Auth.js credentials provider and session shape
│   ├── organizations.ts       # Active organisation context resolution
│   ├── permissions*.ts        # Capability and tenant role-policy checks
│   └── *-gate.ts              # Workflow, QC, and delivery guard helpers
├── server/
│   ├── data/                  # Server-only reads for product screens
│   └── *.ts                   # Server-only delivery and PO domain functions
└── proxy.ts                   # Authentication gate for protected routes

scripts/seed.ts                # Idempotent multi-tenant demo data
drizzle/                       # Ordered SQL migrations and Drizzle migration journal
tests/                         # Playwright UI/integration/isolation and Node unit tests
~~~

### Database model at a glance

~~~text
users ──< organizationMembers >── organizations
                                  │
                                  ├── people, rooms, role policies, workflow stages
                                  ├── CRM companies ──< CRM contacts
                                  ├── shows ──< seasons ──< episodes
                                  │                    ├── episode team assignments
                                  │                    ├── bookings / actual-time submissions
                                  │                    ├── workflow approvals and activity
                                  │                    ├── work orders / QC reports / QC issues
                                  │                    ├── delivery manifest items
                                  │                    └── budget lines / billables / invoices
                                  └── vendor and client purchase orders / allocations
~~~

Users are global login identities. Operational records, including people, are organisation-owned. A person may therefore represent the same global user in more than one tenant while retaining organisation-specific role, rate, availability, and permissions.

### Workflow model

Each organisation configures one ordered set of workflow stages. Stages have a name, position, optional sign-off slots, optional early-start setting, QC/delivery gates, and an optional terminal flag.

Each episode has one current stage and one simple state:

**not_started** → **in_progress** → **awaiting_sign_off** → **complete**

**blocked** is available when work cannot proceed. When all named, episode-level signers complete a required sign-off, PostPilot advances the episode to the next configured stage. Practical gates stop sign-off where required QC, delivery dispatch, receipt confirmation, or blocking work orders are still outstanding.

There are no hard-coded editorial, colour, producer, or client roles in this engine. Tenant-configured role policies grant capabilities; the episode team chooses the named signer for each stage slot.

## API guide

Route handlers are in src/app/api. They are intentionally thin: validate the request, resolve active tenant and capability, call tenant-scoped domain/data helpers, and return a response. Put reusable business rules outside React components and outside individual routes.

| Route group | Responsibility |
| --- | --- |
| /api/auth/[...nextauth] | Auth.js credentials session endpoints |
| /api/organizations, /api/active-show | Active tenant/show context, only from valid memberships/resources |
| /api/shows, /api/seasons, /api/episodes | Programme structure and episode team/workflow records |
| /api/bookings, /api/booking-time-submissions | Calendar bookings, conflicts, actual time, and billing-ready time |
| /api/work-orders, /api/qc-reports, /api/qc-issues | Work, QC exceptions, and corrections |
| /api/workflows | Tenant workflow settings and stage actions |
| /api/delivery-profiles | Delivery profile configuration and episode manifests |
| /api/budget-lines, /api/service-rates, /api/rate-card-overrides | Costs, rate hierarchy, and budget figures |
| /api/purchase-orders, /api/vendor-invoices | Vendor procurement and actual cost allocation |
| /api/client-purchase-orders, /api/client-invoices | Client authorisation and billing records |
| /api/crm | Client, production, network, studio, and vendor accounts/contacts |
| /api/rooms, /api/catering-requests, /api/settings/* | Facility configuration and operations settings |
| /api/debug/* | Local debug controls only; unavailable when debug mode is off |

When adding an endpoint, use this order:

1. Parse request data with a Zod schema.
2. Call the active-organisation context helper.
3. Check the relevant capability.
4. Query every referenced resource by both its ID and organisation ID before using it.
5. Perform the mutation and record activity/audit data where the domain expects it.
6. Add a focused test for capability and cross-tenant denial.

## Local development

### Database changes

The Drizzle schema is the source of truth for new development:

~~~bash
# Edit src/lib/db/schema.ts, then generate a migration
pnpm db:generate

# Apply it to the local database
pnpm db:migrate

# Refresh local demo data when appropriate
pnpm db:seed
~~~

Do not edit an already-applied migration. Create a new forward-only migration. Keep schema, migration, Zod validation, seed data, tenant scoping, and tests in sync.

### Adding or debugging a feature

Start from the boundary that is failing:

| Symptom | First places to inspect |
| --- | --- |
| Wrong tenant data, 403, or 404 | src/lib/organizations.ts, src/lib/tenant-resources.ts, relevant src/server/data files, then the route handler |
| User cannot see or change something | Permission helpers, active organisation role policy, and episode team assignment |
| Workflow does not advance | Current episode state, named signers, workflow sign-off helpers, operational gate helpers, approval activity |
| Booking looks wrong or conflicts | Booking conflict/option helpers, booking API, and Gantt component |
| Budget/rate total is unexpected | Rate resolution, budget data, booking actual-time submission, linked budget/PO records |
| Manifest cannot dispatch/sign off | Delivery lifecycle and workflow-gate helpers, then episode manifest item status |
| Sign-in or redirect behaves unexpectedly | Auth, login-throttle, redirect, and proxy helpers |

Useful commands:

~~~bash
# Type and lint checks
pnpm exec tsc --noEmit
pnpm lint

# All browser tests, including credentials authentication
pnpm test:e2e

# Focused module suites
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

See [tests/README.md](tests/README.md) for suite conventions and the coverage map.

## Security and operations notes

- Do not run with **POSTPILOT_DEBUG_DEMO=true** outside a local or tightly controlled test environment.
- Use unique, strong production passwords and rotate any demo accounts before go-live.
- Store environment variables in your deployment secret manager, not in Git.
- Restrict PostgreSQL network access and back it up regularly.
- Review all code changes for tenant-scoping and capability enforcement before deployment.
- This project coordinates links and metadata, but operators must still protect the external systems those links point to.

PostPilot is not legal, security, accounting, or compliance advice. Each facility remains responsible for its own security controls, contractual requirements, data retention, tax treatment, and client delivery obligations.

## Community development

The project is intended to be understandable and maintainable by post-production teams and their developers.

Good contributions are small, testable, and operationally grounded:

1. Open an issue explaining the facility problem and the expected real-world behaviour.
2. Keep tenant and capability boundaries intact.
3. Use Zod for new input validation and Drizzle migrations for schema changes.
4. Add or update seed data only where it demonstrates the feature clearly.
5. Add focused tests—especially for tenant isolation and lifecycle rules.
6. Run type checks, lint, and the relevant focused test suite before submitting a pull request.

Areas that particularly benefit from community input include facility-specific delivery profiles, regional billing/tax practices, accessibility/localisation workflows, integration adapters for existing review/MAM/accounting systems, and operational reporting.

## Status

PostPilot is an actively evolving application. Treat it as software to evaluate, test, and operate deliberately rather than a finished managed SaaS product. Pilot it with non-critical or mirrored operational data first, document your local runbook, and validate recovery before relying on it for a live delivery schedule.
