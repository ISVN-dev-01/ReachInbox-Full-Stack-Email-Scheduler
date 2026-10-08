# Validation record

Validation date: **8 October 2026 (Asia/Kolkata)**.

## Verified locally

- Dependency installation and Prisma client generation.
- Strict TypeScript compilation of the API, frontend, and tests.
- ESLint.
- Production builds for the Express/worker code and Vite frontend.
- 37 automated unit, service, HTTP, and compose interaction tests:
  - CSV/text parsing, normalization, invalid addresses, duplicates, malformed files.
  - Validation, pagination bounds, encrypted credentials, stable BullMQ job IDs.
  - Tenant-owned campaign creation, batched email/outbox persistence, safe request-key reuse.
  - Authentication protection, tenant filtering, Origin enforcement, structured API errors.
  - OAuth state mismatch/expiry, identity token verification path, PKCE, session rotation.
  - Claim ownership, SENT idempotency, campaign order, delay rescheduling, SMTP failures, ambiguous interruption handling.
  - Durable outbox acknowledgement ordering and Redis failure behavior.
  - Slack connected/disconnected behavior, live-request construction, retries, deduplication, connection changes.
  - Compose validation, effective schedule review, recipient counts, submission, stable retry keys.
- `npm audit`: zero reported vulnerabilities at validation time.
- Browser inspection of the login page and backend-unavailable state.
- Mobile login viewport at 390 CSS pixels: document scroll width was 390px (no horizontal overflow).

The test suite uses explicit test doubles for external integrations and HTTP sessions. These tests validate application behavior; they do **not** prove provider authorization or message delivery.

## Implemented but not run in this environment

`npm run test:integration` targets real PostgreSQL, Redis, BullMQ, and Elasticsearch. It covers campaign transaction races, simultaneous claims, distributed quota/delay gates, delayed job identity across connection restarts, index updates, and tenant-isolated search. The GitHub Actions workflow provisions Docker and runs it.

Docker was not installed/available on this machine. The WSL command failed with a registration error. Consequently, no claim is made that Docker startup, database migrations against a live server, or the real infrastructure suite passed locally.

## Credential-dependent acceptance checks still pending

The user chose to provide provider credentials later. Complete these after following the README setup:

1. Google sign-in → authenticated dynamic profile → logout.
2. CSV compose → campaign transaction → real BullMQ delayed jobs and protected Bull Board.
3. Scheduled time → distributed gate → Ethereal acceptance → SENT transaction → Elasticsearch update → Sent UI and preview.
4. Multiple worker **processes**, tiny sender quota, delayed excess jobs, and a real Slack notification.
5. API/worker process shutdown and restart with the same future job ID, then correct delivery.
6. Redis restart with its existing AOF volume, without deleting persistence.
7. Authenticated dashboard, compose, and settings visual verification at desktop/tablet/mobile widths.

These checks are required before declaring the complete external end-to-end acceptance flow verified. There is no mock login, seeded fake mailbox, or fake provider integration in the application.
