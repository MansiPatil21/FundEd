# FundEd — UML and architecture diagrams

Written in Mermaid so they render on GitHub and live next to the code they describe. Each
one is drawn from the implementation as it stands, not from a plan.

## 1. Components

```mermaid
flowchart LR
  browser["Browser<br/>Next.js app"]
  nginx["Nginx<br/>single origin"]
  web["Web<br/>Next.js 16 · React 19"]
  api["API<br/>Node · Express 5 · Apollo"]
  worker["Rate poller<br/>BullMQ worker"]
  optimizer["Optimizer<br/>FastAPI · OR-Tools CP-SAT"]
  mongo[("MongoDB 7<br/>replica set")]
  redis[("Redis 7")]
  ecb["Frankfurter<br/>ECB reference rates"]
  provider["Rate provider<br/>signed webhook"]

  browser -- "HTTPS" --> nginx
  nginx -- "/" --> web
  nginx -- "/api · /graphql · /webhooks" --> api
  nginx -. "/socket.io (WebSocket)" .-> api
  api -- "Prisma" --> mongo
  api -- "rate cache" --> redis
  api -- "POST /plan · /baseline · /saving" --> optimizer
  worker -- "queue + schedules" --> redis
  worker -- "GET latest" --> ecb
  worker --> api
  provider -- "HMAC-signed POST" --> api
```

The poller runs inside the API process today. It is drawn separately because it is a separate
concern, and moving it to its own container needs no code change.

## 2. Domain model (class diagram)

```mermaid
classDiagram
  class User {
    +ObjectId id
    +String email «unique»
    +String displayName
    +String homeCurrency
    +String localCurrency = CAD
    +DateTime onboardedAt?
  }
  class StudyPermit {
    <<embedded>>
    +String institution
    +DateTime programEndsOn
    +DateTime expiresOn
    +Int weeklyHourCap = 24
    +String permitNumber?
  }
  class Budget {
    <<embedded>>
    +Int monthlyIncomeMinor
    +Int monthlySpendingMinor
    +Int minimumBufferMinor
  }
  class Shift {
    +DateTime startedAt
    +DateTime endedAt
    +String employer
    +Boolean onCampus
  }
  class Obligation {
    +String label
    +Int amountMinor
    +String currency
    +Cadence cadence
    +DateTime nextDueOn
  }
  class Deadline {
    +String label
    +DeadlineKind kind
    +DateTime dueOn
    +DateTime completedAt?
  }
  class FxAlert {
    +String baseCurrency
    +String quoteCurrency
    +Float targetRate
    +AlertDirection direction
    +DateTime triggeredAt?
  }
  class FxRate {
    +String baseCurrency
    +String quoteCurrency
    +Float rate
    +DateTime observedAt
  }
  class Cadence {
    <<enumeration>>
    ONCE
    MONTHLY
    QUARTERLY
    ANNUAL
  }
  class DeadlineKind {
    <<enumeration>>
    TUITION
    GIC_RELEASE
    PERMIT_EXPIRY
    TAX_FILING
    OTHER
  }

  User "1" *-- "0..1" StudyPermit
  User "1" *-- "0..1" Budget
  User "1" o-- "*" Shift
  User "1" o-- "*" Obligation
  User "1" o-- "*" Deadline
  User "1" o-- "*" FxAlert
  Obligation --> Cadence
  Deadline --> DeadlineKind
  FxAlert ..> FxRate : fires on a crossing between consecutive rates
```

`FxRate` carries a unique index on (baseCurrency, quoteCurrency, observedAt). All money is an
integer in minor units; only exchange rates are floats. The schema also defines a
`TransferPlan` model that nothing writes to yet, so it is omitted here.

## 3. Building a transfer plan (sequence)

```mermaid
sequenceDiagram
  autonumber
  actor Student
  participant Web as Web (PlanPanel)
  participant API as API /api/plan
  participant Repo as ObligationRepository
  participant Opt as Optimizer

  Student->>Web: balance, fees, assumed rate, horizon
  Note over Web: monthly budget converted to daily periods
  Web->>API: POST /api/plan
  API->>Repo: occurrencesFor(user, start, end)
  Repo-->>API: cadences expanded into dated amounts
  alt nothing falls due
    API-->>Web: 422 nothing_to_plan
  else something to plan
    par solved together
      API->>Opt: POST /plan (CP-SAT)
      API->>Opt: POST /baseline (monthly transfers)
    end
    Opt-->>API: schedule, totals net of fees
    Opt-->>API: baseline totals
    alt optimizer down or times out
      API-->>Web: 503 optimiser_unavailable (rest of the API still works)
    else planned
      API-->>Web: 200 schedule + saving vs monthly
    end
  end
  Student->>Web: Estimate with rate swings
  Web->>API: POST /api/plan/saving
  API->>API: observed rates for the student's pair, oldest first
  alt fewer than 3 observed rates
    API-->>Web: 422 not_enough_history
  else enough history
    API->>Opt: POST /saving (40 bootstrapped rate paths)
    Opt-->>API: mean saving + 95% confidence interval
    API-->>Web: 200, rounded to whole minor units
  end
```

## 4. An exchange-rate alert firing (sequence)

```mermaid
sequenceDiagram
  autonumber
  participant Src as Poller or signed webhook
  participant Svc as FxService.record
  participant DB as MongoDB
  participant Cache as Redis
  participant IO as Socket.IO

  Src->>Svc: observation (pair, rate, observedAt)
  Svc->>DB: already stored at this observedAt?
  alt repeat
    Svc-->>Src: nothing to do
  else new
    Svc->>DB: insert (unique index lets exactly one racing insert win)
    Svc->>Cache: latest rate for the pair
    Svc->>DB: open alerts for the pair
    Note over Svc: fires on a crossing between the previous<br/>and current observation, not the instant value
    loop each crossed alert
      Svc->>DB: claim: set triggeredAt where still unset
      alt this caller won the claim
        Svc->>IO: emit fx:alert to room user:{id}
      end
    end
  end
```

## 5. Deadline status (state machine)

```mermaid
stateDiagram-v2
  [*] --> Upcoming : more than 14 days away
  [*] --> DueSoon : 14 days or fewer
  Upcoming --> DueSoon : 14 calendar days before
  DueSoon --> Overdue : the day after it falls due
  Upcoming --> Done : marked done
  DueSoon --> Done : marked done
  Overdue --> Done : marked done
  Done --> Upcoming : reopened
  Done --> DueSoon : reopened
  Done --> Overdue : reopened
```

Days are counted between local calendar dates, so a daylight-saving change never turns three
days into 2.96.
