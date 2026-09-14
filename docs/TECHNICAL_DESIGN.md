# FundEd — technical design

## 1. Purpose and scope

FundEd is a financial companion for international students in Canada. It tracks off-campus
work hours against the study-permit cap, holds a monthly budget alongside commitments in the
home currency, watches exchange rates, keeps permit, tuition and tax deadlines, and plans when
to send money home so fees cost as little as possible.

Requirements are in [REQUIREMENTS.md](REQUIREMENTS.md). Decisions with lasting consequences
are recorded as ADRs in [adr/](adr). Diagrams are in [DIAGRAMS.md](DIAGRAMS.md).

## 2. Architecture

Three services behind one Nginx origin (component diagram in DIAGRAMS.md §1).

| Service | Technology | Responsibility |
| --- | --- | --- |
| Web | Next.js 16, React 19, TypeScript, Tailwind v4, Redux Toolkit, Apollo Client | Every page. Cost-of-living pages are server-rendered; the signed-in app renders in the browser |
| API | Node, Express 5, Apollo Server, Prisma, Socket.IO, BullMQ | Authentication, all data, the dashboard query, live alerts, scheduled rate polling, calls to the optimizer |
| Optimizer | Python, FastAPI, Google OR-Tools (CP-SAT), NumPy | Transfer schedules, the monthly baseline, and the bootstrap uncertainty estimate |
| MongoDB 7 | single-node replica set | System of record. A replica set because Prisma needs one for transactions |
| Redis 7 | | Latest-rate cache and BullMQ's queue |

**Why a separate Python service** ([ADR 0002](adr/0002-optimiser-as-a-separate-python-service.md)):
OR-Tools has no Node equivalent, and a CPU-bound solve does not belong on the event loop that
serves every other request.

**Why MongoDB** ([ADR 0001](adr/0001-mongodb-with-prisma.md)): the profile nests deeply and
varies by country of origin. The cost is two MongoDB semantics Prisma preserves faithfully
and that bit this schema, recorded in ADR [0003](adr/0003-no-nullable-unique-fields-on-mongodb.md)
and [0004](adr/0004-mongodb-distinguishes-missing-from-null.md).

## 3. Data conventions

- **Money** is always an integer in minor units with an explicit currency. Exchange rates are the
  only floats, and the solver scales them to integers before use.
- **Calendar dates** from a date picker are sent as local noon, never midnight, so they read back
  as the same day for anyone west of UTC.
- **Day counts** compare local calendar dates, not elapsed milliseconds, so daylight saving
  never shifts a deadline.
- **Optional fields** are read as values on fetched rows and never used as query filters, because
  on MongoDB an unset field is absent rather than null.

## 4. Key flows

### 4.1 Work-hour compliance
Shifts are stored as they happened, and weekly usage is recomputed from them on every read, so a
total can never drift from its source. A shift crossing a week boundary is split at the boundary
and counted in both weeks; attributing it wholly to its start week would let an overnight Sunday
shift escape the cap. On-campus hours are tracked but excluded. The cap comes from the student's
own permit, and a pre-commitment check answers whether a proposed shift would breach it.

### 4.2 Transfer planning
Sequence in DIAGRAMS.md §3. Obligations are stored as rules with a cadence and expanded into
dated amounts across the horizon. The optimizer solves a mixed-integer program: minimise money
sent plus fees, subject to every obligation being covered by its due date and the running
balance, **after transfers and their fees**, never dropping below the student's buffer. The plan
and the monthly baseline are solved together, and the saving is the difference.

At a single assumed rate the saving can only come from paying fewer fees, and the response says
so. The rate-swing estimate replays the plan over 40 bootstrapped rate paths built from observed
rates and reports a 95% confidence interval. Because the optimizer sees each path in advance, that
figure is an upper bound on what timing is worth, not a forecast, and the response says that too.

### 4.3 Exchange rates and alerts
Sequence in DIAGRAMS.md §4. Rates arrive two ways that converge on one `FxService.record`: a
BullMQ poller reading the ECB's daily reference rates through Frankfurter, and an HMAC-signed
webhook. An alert fires on a **crossing** between consecutive observations, because a rate is
sampled, not continuous. The same observation is stored once: a lookup is the fast path and a
unique index is the guarantee, since two simultaneous deliveries both pass any check made in code.

### 4.4 Deadlines
Status is derived on read from the due date and completion time (state machine in DIAGRAMS.md
§5). Anything overdue or due within 14 days is raised on the dashboard.

## 5. Interfaces

**REST** (writes, plus a few reads):

| Route | Purpose |
| --- | --- |
| `POST /api/auth/register` | Create an account with email and password; 409 if the email is taken |
| `POST /api/auth/login` | Exchange email and password for a token; the same 401 for either being wrong, 429 after repeated failures |
| `POST /api/auth/password` | Change the password after confirming the current one |
| `POST /api/auth/local` | Development email-only sign-in used by the test suite, refused in production |
| `GET, PATCH /api/me` | Profile, permit and budget; finishing setup |
| `/api/shifts` | Create, list, delete; `GET /compliance`; `POST /compliance/would-breach` |
| `/api/obligations` | Create, list, delete |
| `/api/deadlines` | Create, list, mark done or reopen, delete |
| `/api/fx/alerts`, `GET /api/fx/rate/:base/:quote` | Create, list and delete rate alerts; the latest rate |
| `POST /api/plan`, `POST /api/plan/saving` | Transfer plan with baseline; uncertainty estimate |
| `POST /api/compliance/usage`, `/would-breach` | Stateless calculators, no sign-in needed |
| `POST /webhooks/fx/rates` | Rate provider push, HMAC-verified over the raw body |
| `GET /health` | 200 when every dependency is up, 503 otherwise |

**GraphQL** `POST /graphql`: one `dashboard` query returning the viewer, compliance with eight
weeks of history, obligations, alerts, the latest rate, upcoming obligations and deadlines. Reads
use GraphQL and writes use REST, so status codes keep their meaning
([ADR 0005](adr/0005-graphql-for-reads-rest-for-writes.md)).

**Socket.IO**: `fx:alert`, emitted to a per-user room after the handshake is authenticated.

## 6. Cross-cutting concerns

- **Authentication.** Email and password accounts. Passwords are hashed with scrypt, salted, with
  the cost parameters stored beside each hash so they can be raised later, and compared in constant
  time. A sign-in for an unknown email still runs a full verification against a throwaway hash, so
  response time does not reveal which emails are registered, and a wrong password and an unknown
  email return the same 401. Five failed sign-ins for one email, or thirty from one address, within
  fifteen minutes return 429 with `Retry-After`. Passwords follow NIST SP 800-63B: at least eight
  characters and a blocklist of the most common, with no composition rules.
  Sessions are short-lived JWTs with the algorithm pinned, so an unsigned `alg: none` token
  is rejected. 401 means not signed in; 403 is reserved for signed in but not allowed. Every query
  is scoped by user, including deletes, so a guessed id never touches another student's data, and
  a malformed id is a 404 rather than a Prisma exception.
- **Validation.** Zod at every boundary: environment at boot, request bodies, webhook payloads,
  optimizer responses and third-party rate responses.
- **Secrets.** `JWT_SECRET` and `FX_WEBHOOK_SECRET` have no defaults; the API refuses to start
  without them. Webhook signatures are compared in constant time over the raw request bytes.
- **Resilience.** The optimizer is optional: when it is down the plan endpoints answer 503 naming
  the one unavailable feature and everything else keeps working. The Redis cache is never
  authoritative; a miss, a corrupt entry or an unreachable Redis all fall back to the database.
- **Concurrency.** Alerts are claimed with a conditional update so two paths processing the same
  crossing cannot both notify. Rate observations are unique per pair and timestamp.
- **CORS.** An explicit allow-list for local development. In the container deployment the site
  and API share one origin behind Nginx, so no cross-origin requests are made.

## 7. Performance

Measured on a MacBook Air against the local stack, 180-day horizon, six monthly obligations:

| Operation | Time |
| --- | --- |
| One optimal plan | 0.18 s |
| Monthly baseline | effectively instant |
| Uncertainty estimate, 40 paths | about 9 s alone; about 28 s with the browser and dev server competing for CPU |
| Uncertainty estimate, 120 paths | about 41 s, with an almost identical interval |

Forty paths was chosen from these numbers: tripling the work barely narrows the interval. The
estimate is its own request with its own timeout, so it never slows the plan.

## 8. Deployment

`docker compose up -d` starts MongoDB and Redis for development. `docker compose --profile full
up --build` runs the whole product behind Nginx on port 8080, or `FUNDED_HTTP_PORT`: a one-off `migrate` service creates
indexes, including the unique ones correctness depends on, before the API starts. Images are
multi-stage and run as non-root users. GitHub Actions runs the API suite against a real replica
set and Redis, the optimizer suite, the web unit tests, browser tests on three engines, and an
image build.

## 9. Deliberate limits

- Plans assume one flat exchange rate; the uncertainty estimate is an upper bound, not a forecast.
- Rates are the ECB's daily reference rates, not live market quotes.
- There is no password reset, because the app sends no email. Google sign-in is not built.
- Tokens cannot be revoked before they expire, so changing a password does not end other sessions.
- Sign-in attempt limits are held in memory, so they apply per API instance. Running a second
  instance would need them moved to Redis.
- Deadlines are raised in the app; there are no email or push reminders.
- Plans are computed on request and not stored; the `TransferPlan` model is defined but unused.
- Hosted on free tiers (Vercel, Render, MongoDB Atlas). Render's free services sleep after 15 minutes
  without traffic, so the first request after a quiet spell takes about a minute.
