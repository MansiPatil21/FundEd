import { GraphQLScalarType, Kind } from 'graphql'
import type { PrismaClient } from '@prisma/client'
import { currentWeek, weeklyUsage } from '../compliance/workHours.js'
import type { ShiftRepository } from '../shifts/repository.js'
import type { ObligationRepository } from '../obligations/repository.js'
import type { FxService } from '../fx/service.js'

export interface GraphContext {
  userId: string | null
  db: PrismaClient
  shifts: ShiftRepository
  obligations: ObligationRepository
  fx: FxService
}

export class NotAuthenticatedError extends Error {
  readonly extensions = { code: 'UNAUTHENTICATED' }
  constructor() {
    super('Sign in to load the dashboard')
    this.name = 'NotAuthenticatedError'
  }
}

const DateTime = new GraphQLScalarType({
  name: 'DateTime',
  description: 'An ISO 8601 timestamp',
  serialize: (value) => (value instanceof Date ? value.toISOString() : String(value)),
  parseValue: (value) => new Date(String(value)),
  parseLiteral: (node) => (node.kind === Kind.STRING ? new Date(node.value) : null),
})

const DAY_MS = 86_400_000

export const resolvers = {
  DateTime,

  Query: {
    dashboard: (_parent: unknown, _args: unknown, context: GraphContext) => {
      if (!context.userId) throw new NotAuthenticatedError()
      // Returns the context itself. Each field below resolves independently, so a
      // client asking only for compliance never touches the obligations collection
      // or the rate cache. That laziness is the reason this is GraphQL.
      return context
    },
  },

  Dashboard: {
    async viewer(_parent: GraphContext, _args: unknown, context: GraphContext) {
      const user = await context.db.user.findUnique({ where: { id: context.userId! } })
      if (!user) throw new NotAuthenticatedError()
      return user
    },

    async compliance(_parent: GraphContext, _args: unknown, context: GraphContext) {
      const stored = await context.shifts.listFor(context.userId!)
      const weeks = weeklyUsage(stored, 24)
      return {
        weeks,
        current: currentWeek(stored, 24, new Date()),
        breachedWeeks: weeks.filter((week) => week.breached).length,
      }
    },

    obligations: (_parent: GraphContext, _args: unknown, context: GraphContext) =>
      context.obligations.listFor(context.userId!),

    alerts: (_parent: GraphContext, _args: unknown, context: GraphContext) =>
      context.db.fxAlert.findMany({
        where: { userId: context.userId! },
        orderBy: { createdAt: 'desc' },
      }),

    async rate(
      _parent: GraphContext,
      args: { quoteCurrency?: string | null },
      context: GraphContext,
    ) {
      const user = await context.db.user.findUnique({ where: { id: context.userId! } })
      const quote = args.quoteCurrency ?? user?.homeCurrency ?? 'INR'
      const base = user?.localCurrency ?? 'CAD'
      const latest = await context.fx.latest(base, quote)
      // Null, not an error. A pair nobody has observed yet is a normal state on a
      // new account, and failing the whole query for it would be wrong.
      return latest ? { pair: `${base}/${quote}`, ...latest } : null
    },

    async upcomingObligationsMinor(
      _parent: GraphContext,
      args: { days?: number | null },
      context: GraphContext,
    ) {
      const days = args.days ?? 30
      const from = new Date()
      const to = new Date(from.getTime() + days * DAY_MS)
      const occurrences = await context.obligations.occurrencesFor(context.userId!, from, to)
      return occurrences.reduce((total, occurrence) => total + occurrence.amountMinor, 0)
    },
  },

  FxAlert: {
    spent: (alert: { triggeredAt: Date | null }) => alert.triggeredAt !== null,
  },
}
