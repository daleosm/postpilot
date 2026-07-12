# PostPilot

PostPilot is a production-operations workspace for episodic TV post teams.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. For production auth, provide `DATABASE_URL`, `NEXTAUTH_SECRET`, `RESEND_API_KEY`, and `EMAIL_FROM`.
3. Leave `POSTPILOT_DEBUG_DEMO=true` in local development to open the command center with built-in demo data and no database or login.
4. When connecting PostgreSQL, generate and apply the database migration:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

4. Start the app:

```bash
pnpm exec next dev --port 5000
```

## Foundation

- Auth.js uses an email one-time-passcode flow. Codes are SHA-256 hashed and stored in the Auth.js verification-token table for 10 minutes.
- In production, OTP emails are sent through Resend. Development logs the generated code when debug mode is disabled but email delivery is not configured.
- `POSTPILOT_DEBUG_DEMO` is deliberately limited to non-production environments. It bypasses route protection and supplies realistic in-memory dashboard data for UI work.
- Application routes are protected by Auth.js proxy middleware outside debug mode; `/sign-in` and the OTP-request endpoint are public.
- Organization membership is appended to the session, and the active organization is stored in a secure HTTP-only cookie through `POST /api/organizations/active`.
- The initial migration in `drizzle/` includes Auth.js, organization tenancy, shows/seasons/episodes, workflows, scheduling, review, delivery, budget, billing, and activity-log tables.
- `src/lib/validations/entities.ts` provides Zod insert/update schemas for each product domain.
- `scripts/seed.ts` resets and repopulates the Northstar Post sample organization with 8 people, 3 shows, 22 episodes, rooms, bookings, review activity, delivery packages, budgets, and billables.
- `src/server/data/` contains server-only query functions for dashboard, shows, episodes, schedule, review, assets, deliverables, budget, and team views.
