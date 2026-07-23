# PostPilot

> Open-source, self-hosted operations software for episodic television post-production.

[View the public demo](http://postpilot-189307880.eu-west-1.elb.amazonaws.com) — sign in with `maya@postpilot.debug` / `password`.

PostPilot is a workflow-first operating system for post houses. It brings programme structure, episode workflow, sign-off, suites, people, QC, delivery, commercial controls, and facility services into one tenant-safe application.

It is deliberately **not** a media-hosting platform. Facilities retain masters, cuts, project files, and review media in the MAM, storage, transfer, and review systems they already trust. PostPilot records the operational work around them and can store external references where useful.

## Why self-hosted and open source?

Facilities cannot afford to be blocked by a vendor outage or a slow support queue during a live series. PostPilot is intended to run on infrastructure the facility controls, with a PostgreSQL database it owns.

- Keep operational data under facility control.
- Retain the ability to diagnose, patch, and deploy urgent fixes locally.
- Avoid forced media migration or platform lock-in.
- Develop the product with people who understand editorial, finishing, audio, QC, delivery, and finance workflows.

Self-hosting still needs backups, monitoring, secure credentials, tested upgrades, and an accountable operator. It gives the facility control; it does not remove operational responsibility.

## Features

| Area | Operational coverage |
| --- | --- |
| Shows and episodes | Show → season → episode structure, deadlines, contacts, per-episode teams, and activity |
| Multi-tenant operations | Isolated post-house workspaces, membership-aware context switching, server-side tenant scoping, and debug-only context testing |
| Workflow and approvals | One configurable ordered workflow per facility, named episode signers, capability-based access, and practical QC/delivery gates |
| Bookings | Room and person bookings, conflict warnings, buffers, option holds, guest attendance, copied sequences, and Gantt scheduling |
| My time and work orders | Assigned work, actual time/overtime, internal or vendor work, billing status, and drag-to-book reservations |
| QC and delivery | QC reports/issues, corrections, delivery profiles/manifests, external references, dispatch, and receipt tracking |
| Budget and rates | Master, network, show, and episode rate cards; booking-derived costs; actuals; budgets; and invoice readiness |
| CRM and procurement | Client, network, production-company, and vendor accounts; contacts; vendor/client POs; allocations; and supplier actuals |
| Facility services | Catering requests, runner desk, fulfilment costs, and episode cost attribution |
| Workflow-only media model | No required uploads or hosted review media—use metadata and external links to existing facility systems |

## How it works

Every request resolves an authenticated user (or local debug user), a valid active organisation membership, and tenant-scoped permissions before it reads or changes operational data. Roles grant configurable capabilities; workflow sign-off is assigned to named people on each episode team rather than hard-coded job titles.

~~~text
Browser / React UI
        ↓
App Router pages and API routes
        ↓
Active organisation + capability checks
        ↓
Server-only domain and data helpers
        ↓
Drizzle ORM → PostgreSQL
~~~

Read the detailed [architecture guide](docs/architecture.md) for the data model, tenant boundary, authentication, and codebase layout.

## Quick start

### Prerequisites

- Node.js 20 or newer
- pnpm
- PostgreSQL 14 or newer

~~~bash
pnpm install
cp .env.example .env.local
~~~

Configure `.env.local` for a local database:

~~~dotenv
DATABASE_URL=postgres://postgres:postgres@localhost:5432/posthouse
NEXTAUTH_SECRET=replace-with-a-long-random-string
NEXTAUTH_URL=http://localhost:5000

# Local demo controls only. Never enable this in production.
POSTPILOT_DEBUG_DEMO=true
~~~

Apply the schema, load the demonstration workspace, and run the app:

~~~bash
pnpm db:migrate
pnpm db:seed
pnpm dev -- --port 5000
~~~

Open [http://localhost:5000](http://localhost:5000). Demo accounts use the password `password`; they are strictly for local development and should never be exposed publicly.

## Documentation

| Guide | Contents |
| --- | --- |
| [Product and operations](docs/product-and-operations.md) | Modules, workflow model, delivery/QC, commercial controls, and demo data |
| [Architecture](docs/architecture.md) | Request flow, tenancy, authentication, codebase layout, and database model |
| [Development and testing](docs/development.md) | Migrations, validation, test suites, debugging, and contribution workflow |
| [Self-hosting and operations](docs/self-hosting.md) | Production configuration, deployment, backups, security, and the supplied AWS/EKS/Argo path |
| [Contributing](docs/contributing.md) | Scope, standards, and contribution expectations |
| [Infrastructure README](infra/README.md) | GitHub Actions, ECR, Terraform, EKS, and Argo CD details |
| [Test guide](tests/README.md) | Test-suite conventions and coverage map |

## Stack

- Next.js App Router, React, and TypeScript
- PostgreSQL and Drizzle ORM
- Auth.js credentials authentication
- Zod and React Hook Form
- Tailwind CSS and HeroUI
- Playwright UI/integration/isolation tests and Node unit tests

## Project status

PostPilot is an actively evolving application. Evaluate it deliberately, pilot it with non-critical or mirrored operational data, document a local runbook, and validate backup/restore before relying on it for a live delivery schedule.

Before publishing a public fork or deploying to users, add a licence that matches how you want the community to use and contribute to the project. This repository currently has no `LICENSE` file, so reuse rights are not yet defined by a standard open-source licence.
