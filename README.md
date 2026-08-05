# PostPilot

> GNU AGPLv3-licensed operations software for episodic television post-production.

[View the public demo](http://postpilot-189307880.eu-west-1.elb.amazonaws.com) — sign in with `maya@postpilot.debug` / `password`.

PostPilot is a workflow-first operating system for post houses. It brings programme structure, episode workflow, sign-off, suites, people, QC, delivery, commercial controls, and facility services into one tenant-safe application.

It is deliberately **not** a media-hosting platform. Facilities retain masters, cuts, project files, and review media in the MAM, storage, transfer, and review systems they already trust. PostPilot records the operational work around them and can store external references where useful.

## Why AGPLv3 and flexible deployment?

Facilities cannot afford to be blocked by a vendor outage or a slow support queue during a live series. PostPilot can be offered as Cutluma Cloud, or self-hosted on facility infrastructure or in its own cloud account. Enterprise self-hosted can add a separately agreed support and release-management package.

- Choose the operating model that suits the facility’s technical ownership and control requirements.
- Retain the ability to inspect, diagnose, patch, and deploy urgent fixes.
- Avoid forced media migration or platform lock-in.
- Keep improvements available to network users when a modified version is offered as a service, as required by GNU AGPLv3.

Customer-managed deployments still need backups, monitoring, secure credentials, tested upgrades, and an accountable operator. They give the facility control; they do not remove operational responsibility.

## Deployment options

Choose the deployment path that matches the installation rather than treating
every environment as production infrastructure:

| Path | Intended use |
| --- | --- |
| [Docker Compose](deploy/docker/README.md) | Local development, internal pilots, or one managed host |
| [Two-AZ EKS](deploy/eks-ha/README.md) | Production-oriented AWS deployment with private workers, per-AZ NAT, and Multi-AZ RDS |

Choose the production EKS path only after reviewing its operational,
backup, and capacity requirements.

## Features

| Area | Operational coverage |
| --- | --- |
| Shows and episodes | Show → season → episode structure, deadlines, contacts, per-episode teams, and activity |
| Multi-tenant operations | Isolated post-house workspaces, membership-aware context switching, server-side tenant scoping, and debug-only context testing |
| Workflow and approvals | One configurable ordered workflow per facility, named episode signers, capability-based access, and practical QC/delivery gates |
| Bookings | Room and person bookings, conflict warnings, buffers, option holds, guest attendance, copied sequences, and Gantt scheduling |
| My work and work orders | Workflow sign-offs, assigned work, actual time/overtime, internal or vendor work, billing status, and drag-to-book reservations |
| QC and delivery | QC reports/issues, corrections, delivery profiles/manifests, external references, dispatch, and receipt tracking |
| Budget and rates | Master, network, show, and episode rate cards; booking-derived costs; actuals; budgets; and invoice readiness |
| CRM and procurement | Client, network, production-company, and vendor accounts; contacts; vendor/client POs; allocations; and supplier actuals |
| Facility services | Catering requests, runner desk, fulfilment costs, and episode cost attribution |
| Workflow-only media model | No required uploads or hosted review media—use metadata and external links to existing facility systems |

## How it works

Every request resolves an authenticated user (or local debug user), a valid active organisation membership, and tenant-scoped permissions before it reads or changes operational data. Roles grant configurable capabilities; workflow sign-off is assigned to named people on each episode team rather than hard-coded job titles.

~~~text
Browser / React + TypeScript UI
        ↓  /v1
FastAPI: sessions, tenant context, capabilities, product API
        ↓
SQLAlchemy + Alembic → PostgreSQL
~~~

FastAPI is the sole application backend. It owns opaque password sessions,
active tenant/show context, debug impersonation, permissions, validation,
business rules, migrations, and PostgreSQL access. Next.js is the React UI
layer and calls the native FastAPI `/v1` API. See
[backend/README.md](backend/README.md) for the API contract and migration
rules.

Read the detailed [architecture guide](docs/architecture.md) for the data model, tenant boundary, authentication, and codebase layout.

## Quick start

### Prerequisites

- Node.js 20 or newer
- pnpm
- Python 3.12 or newer
- PostgreSQL 14 or newer

~~~bash
pnpm install
cp .env.example .env.local
~~~

Configure `.env.local` for a local database:

~~~dotenv
DATABASE_URL=postgres://postgres:postgres@localhost:5432/posthouse
POSTPILOT_SESSION_SECRET=replace-with-a-long-random-string
POSTPILOT_FRONTEND_ORIGINS=http://localhost:5000
POSTPILOT_API_ORIGIN=http://127.0.0.1:8000

# Local demo controls only. Never enable this in production.
POSTPILOT_DEBUG_DEMO=true
~~~

Apply the schema, load the demonstration workspace, and start FastAPI:

~~~bash
cd backend
python -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/alembic upgrade head
.venv/bin/python -m app.demo_seed
.venv/bin/uvicorn app.main:app --reload --port 8000
~~~

In a second terminal, start the TypeScript frontend:

~~~bash
pnpm dev -- --port 5000
~~~

FastAPI reads the root `.env.local` when run from `backend/`; Next.js reads the
same file and forwards local `/v1` requests to `POSTPILOT_API_ORIGIN`.

Open [http://localhost:5000](http://localhost:5000). Demo accounts use the password `password`; they are strictly for local development and should never be exposed publicly.

## Documentation

| Guide | Contents |
| --- | --- |
| [Product and operations](docs/product-and-operations.md) | Modules, workflow model, delivery/QC, commercial controls, and demo data |
| [Architecture](docs/architecture.md) | Request flow, tenancy, authentication, codebase layout, and database model |
| [Development and testing](docs/development.md) | Migrations, validation, test suites, debugging, and contribution workflow |
| [Self-hosting and operations](docs/self-hosting.md) | Production configuration, deployment choices, backups, and security |
| [Contributing](docs/contributing.md) | Scope, standards, and contribution expectations |
| [Infrastructure README](infra/README.md) | GitHub Actions, ECR, Terraform, EKS, and Argo CD details |
| [Test guide](tests/README.md) | Test-suite conventions and coverage map |
| [Cutluma static site](site/README.md) | Separate static sales-site development and build instructions |

## Stack

- Next.js App Router, React, and TypeScript (frontend)
- FastAPI, Pydantic, SQLAlchemy Core, and Alembic (backend)
- PostgreSQL
- Opaque HTTP-only FastAPI password sessions
- Zod and React Hook Form (frontend validation)
- Tailwind CSS and HeroUI
- Pytest backend/API tests plus Playwright UI and credentials-auth journeys

## Project status

PostPilot is an actively evolving application. Evaluate it deliberately, pilot it with non-critical or mirrored operational data, document a local runbook, and validate backup/restore before relying on it for a live delivery schedule.

## Licence

PostPilot is licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). If you modify it and make the modified version available for users to interact with over a network, GNU AGPLv3 requires you to offer those users the corresponding source of that version. Review the [full licence text](LICENSE) before distributing or operating a modified deployment.
