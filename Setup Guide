# ReachInbox Email Scheduler

A full-stack email scheduler with a React outbox, Google sign-in, PostgreSQL persistence, BullMQ delayed delivery, distributed sender controls, Elasticsearch search, and Slack notifications. The UI follows the supplied Outbox Labs references: a compact mailbox sidebar, white canvas, green controls, recipient chips, and a focused compose screen.

**Validation status:** the application and integration paths are implemented. Live Google/Slack OAuth and Ethereal delivery require your own credentials. Infrastructure tests require Docker or equivalent running services. See [VALIDATION.md](VALIDATION.md) for exactly what was run; implementation is not a claim of verified external delivery.

## Quick start

Requires Node.js **22.12+** and Docker Compose v2, with about 2 GB of memory available for infrastructure. Use `localhost` consistently for the web app and OAuth callbacks.

```sh
npm install
cp .env.example .env
```

PowerShell: `Copy-Item .env.example .env`.

Generate `SESSION_SECRET` and `ENCRYPTION_KEY` independently, running this twice:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put the generated values and your OAuth/SMTP credentials in `.env`. Never commit that file. Then:

```sh
docker compose up -d --wait
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Open **http://localhost:5173**. API: **http://localhost:4000**. Readiness: **http://localhost:4000/health**. `npm run dev` starts the API, separate workers, and Vite together; its logs have process labels.

## Features

- Real Google OAuth with PKCE, expiring session-bound state, ID token verification, session rotation, and HTTP-only Redis sessions.
- CSV/text import with email-column detection, normalization, duplicates, invalid counts, size limits, and a scheduling review.
- Separate Scheduled, Sent, and Failed views with pagination, Elasticsearch search, campaign filtering, delivery detail, and Ethereal previews.
- Multiple sender accounts with encrypted optional sender-specific SMTP passwords.
- Per-sender distributed quota, per-campaign quota, SMTP serialization, and minimum delay.
- Real Slack OAuth channel selection, connection management, and live API notifications.
- Protected, administrator-only Bull Board with read-only queue inspection.
- Responsive layouts, keyboard controls, native accessible dialogs, skeletons, empty/error states, and toasts.

## Architecture

```mermaid
flowchart TD
  UI[React / Vite / TanStack Query] --> API[Express API]
  API --> AUTH[Google OAuth / Redis sessions]
  API --> PG[(PostgreSQL: campaigns + emails + outbox)]
  API --> ES[(Elasticsearch search)]
  PG -->|transactional NOTIFY + startup drain| DISPATCH[Outbox dispatcher]
  DISPATCH --> REDIS[(Redis AOF / BullMQ)]
  REDIS --> SEND[Email workers]
  REDIS --> INDEX[Index workers]
  REDIS --> ALERT[Slack workers]
  SEND --> GATE[Atomic Redis quota + delay + lease]
  GATE --> SMTP[Ethereal SMTP]
  SEND --> PG
  INDEX --> ES
  ALERT --> SLACK[Slack Web API]
```

`apps/api/src` separates routes/controllers, services, repositories, integrations, queues, workers, middleware, and configuration. `apps/web/src` separates pages, layouts, hooks, reusable UI, and API access. `packages/shared` owns validation and public types; `packages/config` owns strict TypeScript defaults.

## Scheduling flow

1. The authenticated API validates recipients, sender ownership, time, body size, recipient limit, and effective sender limits.
2. `POST /api/campaigns` requires a UUID `Idempotency-Key`. The unique `(userId, requestKey)` and content hash make double-clicks/network retries safe; different content with the same key returns 409.
3. A single PostgreSQL transaction inserts the campaign, individual email rows, and SEND/INDEX outbox rows. Inserts are chunked to avoid SQL parameter limits. No SMTP work happens inside HTTP requests.
4. A PostgreSQL statement trigger issues `NOTIFY outbox_ready` only at commit. The worker listens and drains outbox rows using `FOR UPDATE SKIP LOCKED`.
5. Each send becomes a BullMQ delayed job named `email-<email UUID>`. Colons are intentionally absent because BullMQ disallows them in custom IDs.
6. Workers check schedule eligibility and campaign sequence, acquire the Redis sender gate, atomically claim the email, call SMTP, and persist SENT/FAILED plus an INDEX event in a transaction.

The API returns after database commit. Queue visibility is asynchronous; if workers are stopped, pending outbox rows remain durable until they return.

**Why no cron:** BullMQ/Redis owns delayed jobs and wakeups. There is no application cron package, interval scan, timeout scheduling loop, or periodic scan for pending email rows. The outbox is awakened by database notifications, with one recovery drain at startup. BullMQ has its own internal maintenance/timer dependencies; this application does not use its repeat/cron APIs.

## Restart persistence

PostgreSQL and Elasticsearch use named volumes. Redis uses AOF, `appendfsync always`, and `noeviction`. API/worker restarts do not recreate the email schedule. Existing Redis delayed jobs retain their identities and eligibility timestamps.

The dispatcher subscribes **before** its startup drain. PostgreSQL notifications are wakeups, not the source of truth: a missed notification while workers are down is recovered from durable outbox rows. Queue insertion followed by a failed outbox delete is safe to replay because job IDs are stable. INDEX events use unique outbox IDs and version-fenced documents.

If a dispatcher loses its PostgreSQL listener or fails a drain, it exits nonzero after closing workers. **Run it under a restarting supervisor in deployment** (systemd, a container restart policy, or your platform's process manager). Locally, restart `npm run worker:dev -w @reachinbox/api` after correcting an infrastructure failure. No background polling is substituted for a failed listener.

At startup, retained terminal queue failures are reconciled to FAILED database rows. SENT rows are never reset. Graceful SIGINT/SIGTERM shutdown waits for active jobs. Do not delete Redis/Postgres volumes to simulate an ordinary restart.

## Idempotency and the SMTP boundary

An atomic conditional update claims only `SCHEDULED` rows. Each claim has a token; terminal updates require the same token and PROCESSING status. A job encountering SENT or FAILED exits without SMTP. Message-ID is deterministic (`<email UUID@reachinbox.local>`).

**Exactly-once external SMTP delivery is impossible to guarantee** across a crash after SMTP acceptance but before committing SENT. Message-ID is not an SMTP deduplication guarantee. This implementation favors avoiding duplicates: a recovered PROCESSING email becomes FAILED with an explicit “delivery outcome unknown” message and is not automatically sent again. A timeout is also potentially ambiguous. Inspect Ethereal before intentionally scheduling a replacement.

SMTP errors are terminal for that email. Infrastructure errors before the SMTP boundary use up to eight exponential BullMQ attempts. Database errors after SMTP acceptance propagate without being misclassified as SMTP rejections. A claim/lease failure can consume quota without delivering; capacity is deliberately conservative.

## Worker concurrency and ordering

`WORKER_CONCURRENCY` controls simultaneous jobs in each email worker; multiple worker processes can run against the same queues. The sender lease allows only one active SMTP attempt per sender. Different senders can progress concurrently.

Within a campaign, an email waits while an earlier sequence is SCHEDULED or PROCESSING. Across campaigns for one sender, fairness is best effort, not global FIFO. Blocked jobs keep their original IDs and move to delayed with a persisted `nextAttemptAt`. Small sequence offsets reduce a simultaneous wakeup burst. A conservative lease wait can add latency (up to `SENDER_LEASE_MS`) when campaigns overlap; it cannot increase capacity.

## Minimum delay

The effective delay is `max(global minimum, sender minimum, campaign delay)`. Initial `scheduledAt = startTime + sequenceNumber × delay`. `scheduledAt` preserves the initial plan; `nextAttemptAt` shows the next effective attempt.

The Redis Lua gate atomically checks server time, the next allowed timestamp, a sender lease, and quota. Successful calls reserve a slot. Releasing a lease sets the next allowed timestamp to **SMTP completion + delay**, conservatively spacing actual attempts. Blocked jobs call `moveToDelayed(timestamp, lockToken)` and throw BullMQ's `DelayedError`, so throttling does not count as delivery failure.

All Redis keys involved in a sender gate share a hash tag. Lease duration must comfortably exceed SMTP timeouts; keep clocks synchronized. An arbitrarily paused process or a network-partitioned SMTP connection cannot be perfectly fenced by SMTP itself. The worker rechecks lease ownership before calling SMTP and never retries a recovered claim automatically.

## Hourly rate limiting

Redis TIME defines fixed UTC hour windows. One Lua script reserves both:

- Sender capacity: minimum of `MAX_EMAILS_PER_HOUR` and sender limit, **shared by all campaigns/workers**.
- Campaign capacity: the campaign's effective hourly limit, shared by its workers.

This prevents campaigns from bypassing the sender budget while allowing a campaign to run more slowly. Gate counters expire after the following window. Quota measures reserved SMTP attempts, not guaranteed successful deliveries. It is a fixed-hour quota, not a rolling 60-minute quota; adjacent hour boundaries can have bursts while the minimum delay remains enforced.

For **1,000 emails, 10 worker concurrency, 200/hour, and 2-second minimum delay**, at most 200 sender attempts are reserved in each UTC window. Remaining emails stay in delayed jobs. Five windows of capacity are required if there are no other campaigns or failures; elapsed time depends on the starting minute and SMTP duration. Concurrency cannot multiply the sender limit.

## Google OAuth setup

1. In Google Cloud Console, configure an OAuth consent screen and add your account as a test user if the app is in testing.
2. Create an OAuth client of type **Web application**.
3. Register the exact redirect URI `http://localhost:4000/api/auth/google/callback`.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` in `.env`.
5. Open `http://localhost:5173/login` and use Continue with Google.

Only `openid email profile` is requested. No Gmail access or tokens are stored. A default sender is created from the verified profile. There is no password login or demo authentication bypass; the reference's email/password controls are intentionally not presented as working authentication.

Reference: [Google server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

## Ethereal SMTP setup

Create a test mailbox at [Ethereal](https://ethereal.email/create). Copy its SMTP username/password into `ETHEREAL_USER` and `ETHEREAL_PASSWORD`. Default host/port is `smtp.ethereal.email:587` with required STARTTLS. Use `ETHEREAL_SECURE=true` only for an implicit-TLS endpoint.

Each sender may optionally provide its own Ethereal username/password in Settings. Passwords are AES-256-GCM encrypted with `ENCRYPTION_KEY`; tokens/passwords never appear in sender responses. Nodemailer transports are reused with a bounded cache. Emails are plain text; the compose toolbar inserts text lists/quotes, not misleading HTML formatting. Attachments are outside this assignment's implemented scope.

**Ethereal captures test messages; it does not deliver to real recipient inboxes.** Each accepted message stores a development preview URL shown in Email Details and structured logs. Treat preview links as private test-message access.

## Slack OAuth

1. Create a Slack application in a workspace where you can install apps.
2. Enable Incoming Webhooks. Under OAuth & Permissions add bot scopes `chat:write` and `incoming-webhook`.
3. Register `http://localhost:4000/api/slack/callback` as a redirect URL.
4. Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_REDIRECT_URI`.
5. Choose **Settings → Connect Slack**, authorize, and select a channel. If Slack requires it, invite the bot to that channel.

The callback stores workspace/channel metadata and an encrypted bot token. Notifications call `chat.postMessage`; they include sender, effective limit, UTC window, and queued count. A deterministic alert job plus a Redis sent marker suppress repeated alerts per sender/window. A crash after Slack accepts but before the sent marker commits can produce a duplicate alert; external exactly-once is not claimed.

Disconnected users do not block delivery. Workers load the current integration at notification time, so new connections are picked up without deployment. Disconnect removes local credentials; it does not uninstall the workspace app. Future alerts stop. Reconnect can select a new channel. Slack failures retry independently and cannot fail an email send.

References: [Slack OAuth](https://api.slack.com/authentication/oauth-v2), [channel selection through incoming-webhook scope](https://docs.slack.dev/reference/scopes/incoming-webhook).

## Elasticsearch

The dedicated index uses keyword identifiers/status fields, text recipient/subject fields, and date timestamps. The index worker creates mappings if needed and retries failed indexing with exponential backoff. Email revisions use `external_gte` versioning, so an older worker cannot overwrite a newer state.

`GET /api/emails/search` always queries Elasticsearch with the authenticated `userId` filter. It uses `multi_match` (not raw user-controlled query DSL). Results are hydrated from PostgreSQL with a second tenant check to return fresh state. There is no silent database-search fallback. Status/campaign filters are supported, and the 10,000-result search window is bounded.

Search is eventually consistent: outbox delay and Elasticsearch refresh can briefly lag the normal mailbox lists. Refresh the mailbox after sending; TanStack Query also refreshes on focus. No frontend timer schedules messages. Elasticsearch downtime retries index jobs independently; it does not stop email sending. Retained exhausted index jobs need operator attention/retry.

## Database schema

| Entity           | Purpose / guarantees                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| User             | Unique Google identity and email; dynamic profile                                                          |
| Sender           | Tenant-owned account, quota, delay, optional encrypted SMTP password                                       |
| EmailCampaign    | Schedule configuration, recipient count, unique tenant request key + hash                                  |
| Email            | One row per recipient; campaign sequence; timestamps; status; unique queue identity; claim token; revision |
| SlackIntegration | One current encrypted workspace connection per user                                                        |
| Outbox           | Transactional SEND, INDEX, ALERT events dispatched after commit                                            |

Foreign keys and indexes cover user/status/schedule, sender/status/next-attempt, sent timestamps, recipient, campaign/sequence, and request-key uniqueness. SQL migrations include the PostgreSQL outbox notification trigger; use migrations, not `prisma db push`.

## API documentation

Responses are `{ success: true, data }`; collections include `{ pagination: { page, limit, total, totalPages } }`. Errors use `{ success: false, error: { code, message } }`. Pagination defaults to page 1 and limit 25, maximum limit 100. Non-GET requests must include the application's Origin and session cookie.

| Method / path                   | Behavior                                                   |
| ------------------------------- | ---------------------------------------------------------- |
| GET `/api/auth/google`          | Start Google OAuth                                         |
| GET `/api/auth/google/callback` | Verify identity, rotate session, redirect                  |
| GET `/api/auth/me`              | Current profile or 401                                     |
| POST `/api/auth/logout`         | Destroy session and clear cookie                           |
| GET `/api/config`               | Public-to-authenticated operational form limits            |
| GET `/api/dashboard/stats`      | Scheduled/processing, sent, failed counts                  |
| POST `/api/campaigns`           | Persist campaign; UUID Idempotency-Key required            |
| GET `/api/campaigns`            | Paginated campaigns                                        |
| GET `/api/campaigns/:id`        | Tenant-owned campaign summary                              |
| GET `/api/emails/scheduled`     | SCHEDULED and PROCESSING                                   |
| GET `/api/emails/sent`          | SENT                                                       |
| GET `/api/emails/failed`        | FAILED, including ambiguous interruption outcomes          |
| GET `/api/emails/search`        | `q`, `status`, `campaignId`, `page`, `limit`               |
| GET `/api/emails/:id`           | Email and public sender details                            |
| GET / POST `/api/senders`       | List / create senders                                      |
| PATCH `/api/senders/:id`        | Update sender settings (complete public settings payload)  |
| GET `/api/slack/connect`        | Begin session-bound Slack OAuth                            |
| GET `/api/slack/callback`       | Exchange code, encrypt token                               |
| GET `/api/slack/status`         | Workspace/channel/connection date only                     |
| POST `/api/slack/disconnect`    | Remove local integration                                   |
| GET `/health`                   | PostgreSQL, Redis, Elasticsearch readiness; 503 on failure |
| GET `/admin/queues`             | Session + allowlisted admin, read-only Bull Board          |

Campaign request (delay in **milliseconds**, ISO start time with timezone):

```json
{
  "senderId": "a-real-sender-uuid",
  "subject": "A quick follow-up",
  "body": "Hi there,\nThanks for your time.",
  "recipients": ["alex@example.com", "jamie@example.com"],
  "startTime": "2026-10-09T10:00:00+05:30",
  "delayBetweenEmails": 2000,
  "hourlyLimit": 200
}
```

## Environment variables

All variables and local defaults are in [.env.example](.env.example).

| Group             | Variables                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime           | `NODE_ENV`, `PORT`, `FRONTEND_URL`, `LOG_LEVEL`                                                                                                                 |
| Persistence       | `DATABASE_URL`, `REDIS_URL`, `ELASTICSEARCH_URL`, `ELASTICSEARCH_INDEX`, optional `ELASTICSEARCH_API_KEY`                                                       |
| Sessions/security | `SESSION_SECRET` (at least 32 chars), `ENCRYPTION_KEY` (64 hex chars), `SESSION_TTL_SECONDS`, `ADMIN_EMAILS`                                                    |
| Google            | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`                                                                                               |
| Slack             | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`                                                                                                  |
| SMTP              | `ETHEREAL_USER`, `ETHEREAL_PASSWORD`, `ETHEREAL_HOST`, `ETHEREAL_PORT`, `ETHEREAL_SECURE`                                                                       |
| Worker            | `WORKER_CONCURRENCY`, `INDEX_WORKER_CONCURRENCY`, `SLACK_WORKER_CONCURRENCY`, `MIN_EMAIL_DELAY_MS`, `MAX_EMAILS_PER_HOUR`, `SENDER_LEASE_MS`, `SMTP_TIMEOUT_MS` |
| Input limits      | `MAX_RECIPIENTS`, `MAX_UPLOAD_BYTES`, `REQUEST_LIMIT_BYTES`                                                                                                     |
| Tests             | `TEST_DATABASE_URL`, `TEST_REDIS_URL`, `TEST_ELASTICSEARCH_URL`                                                                                                 |

Changing the encryption key without decrypting/re-encrypting existing credentials invalidates them. Back up keys securely. Environment validation fails early without printing secret values. Production requires HTTPS and one trusted reverse proxy; secure session cookies are enabled in production. Host frontend and API under the same site, forwarding `/api` and `/admin` to Express and serving the built SPA with an index fallback. Restrict infrastructure networks and enable managed-service authentication/TLS in deployment. Compose's localhost-only credentials are for development.

## Docker setup

`docker compose up -d --wait` starts PostgreSQL 16, Redis 7.4, and Elasticsearch 8 with health checks and persistent volumes. Host bindings are loopback only. On Windows/macOS, start Docker Desktop first. Linux Elasticsearch may require `vm.max_map_count=262144`; configure that on the Docker host if its logs request it.

`docker compose down` stops services but retains data. Do not add `-v` unless intentionally deleting local data. The first Postgres initialization creates `reachinbox_test` for the integration suite. Existing volumes created before the init script need that test database created once manually.

## Running backend, worker, and frontend

```sh
# Separate terminals, alternative to npm run dev
npm run dev -w @reachinbox/api
npm run worker:dev -w @reachinbox/api
npm run dev -w @reachinbox/web

# Production artifacts and processes
npm run build
npm start
npm run worker
```

Serve `apps/web/dist` from your web server; Vite's development server is not a production host. Start multiple `npm run worker` processes to exercise distributed control. Workers and API load the root `.env` by walking upward from the working directory.

## Bull Board and observability

Set `ADMIN_EMAILS` to your Google account email, sign in, and open **Queue dashboard** from the sidebar or `http://localhost:4000/admin/queues`. Ordinary authenticated accounts cannot view cross-tenant job metadata. Read-only mode prevents manually retrying an ambiguous SMTP job by accident.

The three queues are `email-send`, `email-index`, and `slack-alert`. View waiting, delayed, active, completed, and failed work. Completed send jobs are retained for seven days; durable database status remains the final deduplication guard after cleanup. Failed jobs are retained for diagnosis.

Pino logs email ID, sender, recipient, sequence, state, scheduled time, actual completion, UTC quota window, and worker PID. OAuth query strings, session cookies, passwords, and tokens are not logged. Recipient/preview logs are private operational data; set access and retention appropriately.

## Testing

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Unit/service/HTTP tests run without external services. Test doubles exist only in tests and are never a product login or fake delivery path.

Real infrastructure suite:

```sh
docker compose up -d --wait
# Apply migrations to the dedicated test database.
```

PowerShell:

```powershell
$env:DATABASE_URL='postgresql://reachinbox:reachinbox@localhost:5432/reachinbox_test'
npm run prisma:migrate
Remove-Item Env:DATABASE_URL
npm run test:integration
```

POSIX:

```sh
DATABASE_URL=postgresql://reachinbox:reachinbox@localhost:5432/reachinbox_test npm run prisma:migrate
npm run test:integration
```

The integration suite refuses non-test database/index/Redis names. It creates and cleans its own data. It tests transaction/idempotency races, concurrent database claims, independent Redis clients enforcing quota and delay, tenant-isolated Elasticsearch indexing/search, and BullMQ delayed-job identity/execution after connection restarts. A connection restart test is not a substitute for the manual process/Redis restart demonstration below. GitHub Actions runs these checks with real Docker services.

## Five-minute demo flow

1. Configure credentials/services first; add your Google email to `ADMIN_EMAILS`. Sign in.
2. Compose an email; upload [examples/recipients.csv](examples/recipients.csv). Expect **3 valid, 1 invalid, 1 duplicate**.
3. Choose a time about a minute ahead, 2-second delay, and an hourly limit. Review and schedule.
4. Open Bull Board and show the `email-send` delayed queue. Open Scheduled and the email detail.
5. After the start time, refresh. Open Sent and the Ethereal preview.
6. Schedule another email a few minutes ahead. Stop API and worker; restart them without stopping/deleting infrastructure. Show the same job ID and future execution.
7. Optional: connect Slack, set a sender limit to 2, and schedule 4 recipients. Show 2 sends, 2 pending, the next UTC-window attempt time, and the real Slack alert. A full quota rollover requires waiting for that boundary, so plan this near the hour for a short demo.

## Trade-offs and assumptions

- Real provider accounts and credentials are prerequisites; none are fabricated.
- Fixed UTC windows count reservations. Failed/ambiguous attempts conservatively consume capacity.
- FIFO is strict inside a campaign, best effort between campaigns. A slow/blocked predecessor delays successors. Sequence checks and delayed wakeups prioritize correctness over maximal throughput.
- Outbox dispatcher failures require process-supervisor restart; pending events stay in PostgreSQL. There is no cron repair scan.
- Redis AOF is durable on ordinary process restarts. Total volume loss requires an explicit recovery procedure and operator review; the app does not blindly rebuild/resend an entire schedule.
- Elasticsearch is eventually consistent, does not store email body text, and has a bounded result window. PostgreSQL is the delivery source of truth.
- SMTP and Slack cannot provide a cross-system exactly-once commit. Duplicate-avoidance and ambiguous outcomes are documented above.
- The login uses Google only, and the editor uses plain text. Unsupported password login, attachments, and rich-text formatting are not represented by inactive controls.
- Mailbox updates use request completion, manual refresh, and focus refresh. The scheduler never depends on browser timing.
- This is an assignment-ready implementation with a documented operational model, not a claim that unconfigured provider flows have already passed a production deployment review.
