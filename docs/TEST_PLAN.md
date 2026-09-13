# FundEd — test plan

## Strategy

Each layer tests what the layer below cannot see. Anything that talks to infrastructure is tested
against the real thing: a MongoDB replica set, Redis, real HTTP sockets and real browsers. A mock
passes while the query is wrong, so mocks are used only where the thing being tested is our own
behaviour around a dependency, such as the API degrading when the optimizer is down.

| Layer | Tool | Count | Runs against |
| --- | --- | --- | --- |
| API unit and integration | Jest, Supertest | 160 tests, 18 suites | Real MongoDB (one database per suite) and real Redis (one database index per suite) |
| Optimizer | pytest | 26 tests | The real CP-SAT solver |
| Web unit and component | Vitest, React Testing Library | 62 tests | jsdom |
| End to end | Playwright | 8 journeys × 3 engines = 24 runs | Chromium, Firefox and WebKit |

## What each layer covers

**Optimizer.** Cases with an optimum worked out by hand: sending on the best-rate day, bundling
when a flat fee dominates, splitting when the buffer forbids one large transfer, infeasible
requests reported rather than invented, fees charged on what was sent, a provider's minimum
transfer, and fees counted against the buffer and the closing balance. Bootstrap inference is
tested for reproducibility and for reporting infeasible paths rather than counting them as zero.

**API.** Compliance arithmetic including week-boundary splits; JWT rejection of forged, expired,
malformed and unsigned tokens; per-user scoping on every resource; the optimizer client over real
sockets for refused connections, hangs, 500s, malformed bodies and FastAPI validation lists;
planning's 422 and 503 paths; webhook signatures; alert crossings; the cache's fallbacks; BullMQ
schedules against real Redis; the GraphQL dashboard; profile setup; deadlines.

**Web.** The setup wizard's rules, the money input typed one key at a time, date handling across
timezones, the monthly-to-daily plan conversion, the dashboard hero's eight-week series.

**End to end.** Route guards, sign-in validation, server-rendered cost-of-living pages present in
the raw HTML, and the dark-mode regression, on all three browser engines.

## Regression tests for bugs found during development

Each of these was a real defect. The test is named for the behaviour it protects.

| Bug | Where it surfaced | Test |
| --- | --- | --- |
| An overnight shift escaped the weekly cap | Design review | splits a shift that crosses midnight into Monday across both weeks |
| A nullable unique index allowed one user without Google sign-in | Second sign-up failed with P2002 | ADR 0003; profile and shift suites |
| `triggeredAt: null` matched nothing, so alerts never fired | Integration test | ADR 0004; fires when an incoming rate crosses the target |
| One suite's Redis flush deleted another suite's BullMQ keys | Intermittent CI-style failure | Per-suite Redis database indices |
| GraphQL returned 404 because it mounted after the catch-all | Integration test | the dashboard query suite |
| The browser blocked every sign-in (no CORS on REST) | Manual browser check | Covered by the live journey; CORS allow-list |
| Pages looked blank in dark mode | User report | keeps dark text on a light page when the system is in dark mode |
| Typing `1200.50` produced `120050` | User report | keeps a decimal point while typing, one key at a time |
| Fees ignored against the buffer; closing balance overstated | Numbers in a screenshot | fees count against the minimum balance; closing balance is net of fees |
| The same rate stored twice by concurrent polls | Running the real poller | stores one row when the same observation is recorded several times at once |
| A malformed id caused a 500 | Design review | answers 404, not 500, for an id that is not an ObjectId |
| Daylight saving could shift a day count | Design review | is not thrown off by a daylight-saving change |

## Running the tests

```bash
docker compose up -d                              # MongoDB and Redis
cd backend   && npx jest                          # needs `npx prisma db push` per test database once
cd optimizer && python -m pytest -q
cd web       && npx vitest run && npx playwright test
```

## Not covered

- No load or soak testing; the performance figures in TECHNICAL_DESIGN.md are single-machine timings.
- The full stack is exercised in a live browser during development but not by an automated
  end-to-end test that runs MongoDB, the API, the optimizer and the web app together.
- No accessibility audit beyond semantic markup and labelled controls.
- No test against the live Frankfurter service; its client is tested against a local server.
