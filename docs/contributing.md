# Contributing to PostPilot

PostPilot is intended to be understandable and maintainable by post-production teams and their developers. Contributions should solve a real facility problem without weakening tenant isolation, auditability, or operational clarity.

## Before you begin

1. Describe the facility problem and the expected real-world outcome.
2. Check whether the change belongs in workflow coordination rather than media storage.
3. Decide which tenant roles/capabilities need access—do not assume a fixed job title.
4. Identify the affected lifecycle, data ownership, audit history, and test boundary.

## Contribution standards

- Keep changes small and focused where possible.
- Use Zod validation for new inputs and Drizzle migrations for schema changes.
- Scope operational reads and writes to the active organisation.
- Validate parent/child references within the same organisation before mutation.
- Use named episode-team signers for sign-off rather than job-title shortcuts.
- Preserve the link-first, no-required-upload media model.
- Add realistic seed data only when it clearly demonstrates the capability.
- Add focused tests, especially for lifecycle behaviour, capabilities, and cross-tenant denial.

## Pull-request checklist

Before opening a pull request:

~~~bash
pnpm exec tsc --noEmit
pnpm lint
~~~

Run the relevant focused suite from [the test guide](../tests/README.md), and include a concise summary of:

- the facility workflow being supported;
- migration and deployment implications;
- tenant and permission impact;
- test coverage; and
- any open operational questions.

## Good areas for community contribution

- facility-specific delivery profiles;
- regional billing/tax practices;
- accessibility and localisation workflows;
- integration adapters for review, MAM, transfer, and accounting systems;
- operational reporting; and
- deployment options for facilities with their own infrastructure standards.

## Licence

This repository does not currently contain a `LICENSE` file. Do not assume standard open-source reuse rights until maintainers select and add a licence.
