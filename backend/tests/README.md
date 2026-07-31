# Backend test layers

PostPilot keeps financial correctness in four complementary layers.

| Layer | Selector | Purpose |
| --- | --- | --- |
| Unit | `pytest -m unit` | Fast Decimal arithmetic, rounding boundaries, rate resolution, and pure lifecycle rules. No database is required. |
| API integration | `pytest -m api_integration` | FastAPI plus PostgreSQL: transactions, constraints, retries, permissions, tenant boundaries, and persistence. |
| Golden ledger | `pytest -m golden_ledger` | A small fixed episode scenario with known estimates, actuals, PO balances, invoice values, and export payloads to £0.01. |
| Browser UI | `pnpm test:ui` | Playwright confirms operators see the same server totals, can inspect their sources, and see export gates. |

Golden ledger tests do not read seeded demo records. Each uses the isolated
PostgreSQL lab fixture, creates a realistic editorial/vendor/client-change
episode, and compares a stable projection of API JSON to a checked-in fixture.
Update the expected JSON only after a deliberate commercial-rule change and a
human ledger review.
