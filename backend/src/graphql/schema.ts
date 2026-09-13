/**
 * The dashboard query.
 *
 * This exists for one reason: the dashboard needs the student's compliance status,
 * their obligations, their open alerts and the current rate, all at once, on a phone
 * connection. Over REST that is four round trips and four sets of latency, and the
 * client cannot express "I only need the current week" without another endpoint.
 *
 * Reads go through GraphQL. Writes stay on REST (see ADR 0005). Two ways to do the
 * same thing would be worse than either alone; this is a split along a real seam.
 */
export const typeDefs = /* GraphQL */ `
  scalar DateTime

  type WeekUsage {
    weekStart: DateTime!
    offCampusHours: Float!
    onCampusHours: Float!
    capHours: Int!
    remainingHours: Float!
    breached: Boolean!
  }

  type Compliance {
    current: WeekUsage!
    weeks: [WeekUsage!]!
    "Weeks in which the cap was exceeded. Precomputed because it is the one number a student checks first."
    breachedWeeks: Int!
  }

  enum Cadence {
    ONCE
    MONTHLY
    QUARTERLY
    ANNUAL
  }

  type Obligation {
    id: ID!
    label: String!
    amountMinor: Int!
    currency: String!
    cadence: Cadence!
    nextDueOn: DateTime!
  }

  enum AlertDirection {
    AT_OR_ABOVE
    AT_OR_BELOW
  }

  type FxAlert {
    id: ID!
    baseCurrency: String!
    quoteCurrency: String!
    targetRate: Float!
    direction: AlertDirection!
    triggeredAt: DateTime
    "True once it has fired. An alert fires at most once."
    spent: Boolean!
  }

  type Rate {
    pair: String!
    rate: Float!
    observedAt: DateTime!
  }

  type Viewer {
    id: ID!
    email: String!
    displayName: String!
    homeCurrency: String!
  }

  enum DeadlineKind {
    TUITION
    GIC_RELEASE
    PERMIT_EXPIRY
    TAX_FILING
    OTHER
  }

  enum DeadlineStatus {
    DONE
    OVERDUE
    DUE_SOON
    UPCOMING
  }

  type Deadline {
    id: ID!
    label: String!
    kind: DeadlineKind!
    dueOn: DateTime!
    completedAt: DateTime
    "Calendar days until it falls due. Negative once it has passed."
    daysLeft: Int!
    status: DeadlineStatus!
  }

  type Dashboard {
    viewer: Viewer!
    compliance: Compliance!
    obligations: [Obligation!]!
    alerts: [FxAlert!]!
    "Null when the pair has never been observed, rather than an error: a missing rate is not a broken dashboard."
    rate(quoteCurrency: String): Rate
    "Total of every obligation occurrence falling in the next N days, in home-currency minor units."
    upcomingObligationsMinor(days: Int = 30): Int!
    "Every deadline, soonest first, with where it stands today."
    deadlines: [Deadline!]!
  }

  type Query {
    dashboard: Dashboard!
  }
`
