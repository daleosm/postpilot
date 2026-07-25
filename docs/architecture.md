# Architecture guide

## Request flow

~~~text
Browser / React client components
        │
        └── Server-rendered App Router pages
                    │
                    ▼
          FastAPI /v1 API
  authentication, active tenant, capability and resource checks
                    │
                    ▼
     SQLAlchemy Core → PostgreSQL
                    │
                    ▼
      Activity/audit records and derived UI state
~~~

React components should not be the source of database access or tenant authority.
Next renders the UI; FastAPI validates input, resolves context, checks
capabilities, and validates referenced resources before writing.

## Tenancy

`organizations` is the tenant entity. `users` are global login identities and connect to organisations through `organizationMembers`.

The active organisation is derived only from valid memberships:

1. Resolve the opaque FastAPI session, or the controlled debug identity.
2. Load valid memberships for that user.
3. Read the active-organisation cookie only as a preference.
4. Accept it only if it is one of those memberships; otherwise fall back to the first valid membership.
5. Resolve the organisation-specific `people` record if one exists.

`backend/app/auth.py` resolves the user, active organisation, membership role,
memberships, and current person record. API functions use this context rather
than accepting an organisation ID from the browser.

## Permissions

Roles are tenant policy records. Capabilities determine whether a person can perform a particular operation. This keeps operational access configurable without encoding job titles into the workflow engine.

Typical checks are:

- workflow configuration and stage update;
- assigned work update and workflow submission;
- workflow sign-off;
- early-start authorisation;
- QC management;
- delivery confirmation;
- booking, budget, CRM, or commercial administration.

Workflow sign-off requires both capability and a matching named episode-team signer slot.

## Authentication

FastAPI provides opaque HTTP-only email/password sessions. Internal users remain
application records even when future SSO providers are configured; identity
providers map to application users rather than replacing tenant membership,
person, role, or episode access records.

Production requires `POSTPILOT_SESSION_SECRET`. Secure cookies are enabled for
HTTPS canonical URLs. The explicit `http://localhost` development/port-forward
URL uses non-secure cookies because browsers reject Secure cookies over HTTP.

## Codebase map

~~~text
src/
├── app/                       # App Router UI pages only
│   ├── bookings/              # Facility calendar and booking operations
│   ├── budget/                # Rates, costs, POs, client POs, invoices
│   ├── crm/                   # Client, network, production-company, vendor accounts
│   ├── deliveries/            # Delivery register
│   ├── episodes/[episodeId]/  # Episode workspace
│   ├── review/                # Pending workflow sign-offs
│   ├── settings/              # Tenant settings
│   ├── shows/[showId]/        # Show workspace
│   └── sign-in/               # Credentials sign-in
├── components/                # UI, forms, dialogs, navigation, custom Gantt
├── lib/
│   ├── validations/           # Zod schemas for browser forms
│   └── postpilot-api-*.ts     # Typed FastAPI HTTP clients
├── proxy.ts                   # FastAPI session gate for protected UI routes

backend/
├── app/api/                   # Tenant-scoped FastAPI endpoints
├── app/db/                    # SQLAlchemy Core table maps and session factory
├── app/auth.py                # Session, tenant, and capability resolution
├── app/demo_seed.py           # Idempotent multi-tenant fixture data
└── alembic/                   # Python-owned schema migrations

drizzle/                       # Immutable historical SQL bootstrap snapshot
tests/                         # Playwright UI and credentials-auth journeys
~~~

## Database ownership model

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

Tenant-owned tables carry `organizationId` where it materially improves query safety and indexing, or are safely constrained through a tenant-owned parent relationship. Cross-tenant references are rejected in server functions and API routes.

## API convention

Route handlers are intentionally thin. For each new endpoint:

1. Validate browser forms with Zod and validate API input with Pydantic.
2. Resolve active organisation context.
3. Check the relevant capability.
4. Query every referenced record with its ID **and** organisation boundary before using it.
5. Call a Python domain/data helper.
6. Record activity where the domain requires it.
7. Add focused permission and tenant-isolation coverage.
