# PostPilot test suite

All automated browser tests use Playwright and the database-backed debug environment. They are organised by the type of regression they protect, rather than calling screen checks “usability” tests.

## Folders

| Folder | Purpose | Current coverage |
| --- | --- | --- |
| `ui/` | Screen-level user journeys: visible controls, filtering, validation, navigation, and role-specific workspace access. | Shows, Episodes, Bookings, Approvals, My time, Users & access. |
| `integration/` | Business rules exercised through real API routes with isolated database fixtures. | Configurable workflow, work orders/commercial rules, QC lifecycle. |
| `integration/tenant-isolation/` | Tenant-boundary checks for pages, mutations, and safe route switching. | Shows, Episodes, Bookings, Approvals. |
| `fixtures/` | Shared test helpers only; these are not test specs. | Debug user and active-tenant session helper. |

## Commands

```sh
pnpm test:e2e
pnpm test:ui
pnpm test:integration
pnpm test:tenant-isolation
pnpm test:qc
```

## Conventions

- Use `ui/` for a user-visible journey. These are UI regression tests, not a substitute for moderated human usability research.
- Use `integration/` when the point of the test is a permission, workflow, billing, or data-integrity rule.
- Put tenant-boundary coverage in `integration/tenant-isolation/`, including cross-tenant route and API attempts.
- Each spec that writes fixture data must use its own ID range, clean up after itself, and run serially when it switches debug identities or mutates shared fixture state.
- Prefer helpers from `fixtures/` over repeating debug-cookie setup.

## Coverage map

| Module | UI journey | Tenant isolation | Business rules |
| --- | --- | --- | --- |
| Shows | `ui/shows` | `tenant-isolation/shows` | — |
| Episodes | `ui/episodes` | `tenant-isolation/episodes` | workflow integration |
| Bookings | `ui/bookings`, `ui/my-time` | `tenant-isolation/bookings` | — |
| Approvals | `ui/approvals` | `tenant-isolation/approvals` | workflow integration |
| Work orders | — | covered through tenant-scoped APIs | `integration/work-orders` |
| QC | episode QC UI is covered through the episode workspace | `integration/qc-lifecycle` | `integration/qc-lifecycle` |
| Users & access | `ui/users` | tenant-local creation exercised in the journey | — |
