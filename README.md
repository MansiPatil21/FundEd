# FundEd

A financial companion for international students in Canada: permit work hours, a two-currency
budget, exchange-rate alerts, deadlines, and a plan for when to send money home.

## What it does

- **Work-hour compliance.** Log shifts and see off-campus hours against your permit's weekly cap.
  Overnight shifts split across the week boundary, and it asks before you log a shift that would
  breach the cap.
- **Transfer planning.** A mixed-integer program chooses when and how much to send home, with fees
  counted against your safety buffer. It shows the saving over monthly transfers and, from observed
  rates, a 95% confidence interval on what timing could be worth.
- **Rate alerts.** Set a target rate and get a live notification the moment a new observation
  crosses it.
- **Deadlines.** Tuition, GIC release, permit expiry and tax filing, flagged when due soon or overdue.
- **Profile setup** for your permit, budget and commitments, and **public cost-of-living pages**.

## Stack

| Area | Technology |
| --- | --- |
| Web | Next.js 16, React 19, TypeScript, Tailwind CSS v4, Redux Toolkit, Apollo Client, Socket.IO client |
| API | Node.js, Express 5, TypeScript, Apollo Server (GraphQL), Prisma, Socket.IO, BullMQ, Zod, JWT |
| Optimizer | Python, FastAPI, Google OR-Tools (CP-SAT), NumPy, Pydantic |
| Data | MongoDB 7 (replica set), Redis 7 |
| Delivery | Docker (multi-stage images), Docker Compose, Nginx, GitHub Actions |
| Testing | Jest, Supertest, pytest, Vitest, React Testing Library, Playwright (Chromium, Firefox, WebKit) |

## Running it

**Everything in containers**, served on http://localhost:8080 (set `FUNDED_HTTP_PORT` if that port is taken):

```bash
cp .env.example .env    # then set JWT_SECRET and FX_WEBHOOK_SECRET
docker compose --profile full up --build
```

**For development**, with hot reload:

```bash
docker compose up -d                                          # MongoDB and Redis
cd optimizer && python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --port 5050                    # 5050: macOS reserves 5000
cd backend && cp .env.example .env && npm ci && npx prisma db push && npm run dev
cd web && npm ci && npm run dev                               # http://localhost:3000
```

## Documentation

- [Technical design](docs/TECHNICAL_DESIGN.md): architecture, flows, interfaces, performance, limits
- [UML and architecture diagrams](docs/DIAGRAMS.md): components, domain model, sequences, deadline states
- [Test plan](docs/TEST_PLAN.md): strategy, coverage, and the regression test behind each bug found
- [Requirements](docs/REQUIREMENTS.md) and [architecture decision records](docs/adr)

## Status and limits

Built and tested locally; not deployed to a public cloud. Accounts use email and password, with
scrypt hashing and limits on repeated failed sign-ins.
Plans assume one flat exchange rate, and exchange rates are the ECB's daily reference rates. See
the technical design for the full list.
