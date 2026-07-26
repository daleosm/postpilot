# PostPilot test suite

TypeScript tests use Playwright only for browser journeys. Backend behaviour,
tenancy, security, lifecycle, and migration contracts live in the FastAPI
`pytest` suite and are authoritative.

## Folders

| Folder | Purpose | Current coverage |
| --- | --- | --- |
| `ui/` | Screen-level user journeys: visible controls, filtering, validation, navigation, responsive layouts, and role-specific workspace access. | Chromium journeys across show and episode workspaces, Bookings, workflow actions, Work orders, actual time, Deliveries, commercial registers, CRM, Settings, Approvals, and recovery states. |
| `integration/auth-credentials.spec.ts` | Isolated real sign-in/sign-out and protected-route browser journey. | FastAPI opaque-session behaviour through the UI. |
| `fixtures/` | Shared test helpers only; these are not test specs. | Debug user and active-tenant session helper. |

## Commands

```sh
pnpm test:all
pnpm test:e2e
pnpm test:auth
pnpm test:ui
pnpm test:backend
pnpm test:shows
pnpm test:bookings
pnpm test:deliveries
```

`test:all` runs Playwright browser journeys, including the isolated
credentials-auth suite. Backend tests are run from `backend/` with `pytest`;
CI runs that PostgreSQL-backed suite before browser tests. The legacy Node API
and browser/API integration suites have been retired in favour of FastAPI
tests:

| Retired Node area | Authoritative FastAPI coverage |
| --- | --- |
| Credential security and throttling | `test_security_contract.py`, `test_login_throttle_integration.py` |
| Delivery lifecycle and register state | `test_delivery_lifecycle.py`, `test_delivery_register_state.py` |
| Current-stage workflow state | `test_workflow_state.py` |
| Capability policy resolution | `test_permissions.py` |
| Server error logging | `test_server_logging.py` |
| Migration rollout contract | `test_migration_contract.py` |

## Conventions

- Use `ui/` for a user-visible journey. These are UI regression tests, not a substitute for moderated human usability research.
- Keep server-side permission, workflow, billing, lifecycle, and tenant-boundary
  rules in the FastAPI pytest suite.
- `test:e2e` runs the standard debug-mode browser suite and the isolated credentials-auth suite. The latter uses a separate non-debug server because it verifies the FastAPI session guard and protected-route behaviour.
- Each spec that writes fixture data must use its own ID range, clean up after itself, and run serially when it switches debug identities or mutates shared fixture state.
- Prefer helpers from `fixtures/` over repeating debug-cookie setup.

## Coverage map

| Module | UI journey | Tenant isolation | Business rules |
| --- | --- | --- | --- |
| Shows | `ui/shows`, `ui/shows-detail` | FastAPI show/resource tests | FastAPI show, CRM, and tenant-scope tests |
| Episode workspaces | `ui/shows-detail`, `ui/workflow-actions` | FastAPI episode/team access tests | FastAPI workflow, QC, and delivery tests |
| Bookings | `ui/bookings`, `ui/my-time` | FastAPI booking-scope tests | FastAPI lifecycle, conflicts, actuals, and work-order tests |
| Approvals | `ui/approvals`, `ui/workflow-actions` | FastAPI actor/signer tests | FastAPI workflow-state tests |
| Budget and POs | `ui/commercial-workflows`, `ui/delivery-and-commercial-actions` | FastAPI commercial-scope tests | FastAPI budget, rate-card, PO, and billing tests |
| Work orders & actual time | `ui/work-orders-and-time-actions`, `ui/my-time` | FastAPI work-order and time-scope tests | FastAPI lifecycle, approval, billing, and actual-cost tests |
| CRM & organisation settings | `ui/commercial-workflows`, `ui/settings-context-and-resilience`, `ui/workflow-settings`, `ui/users` | FastAPI membership and CRM-scope tests | FastAPI capability, validation, and authentication tests |
| Responsive and recovery | `ui/access-and-responsive`, `ui/settings-context-and-resilience` | N/A | Viewport overflow, debug controls, legacy redirects, and unavailable-record recovery |
