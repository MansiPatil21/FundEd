import type { ObligationCadence, PrismaClient } from '@prisma/client'

/**
 * Recurring commitments in the student's home currency: family support, a sibling's
 * fees, a loan instalment. These are the demand side of the remittance plan.
 */

export interface ObligationRecord {
  id: string
  label: string
  amountMinor: number
  currency: string
  cadence: ObligationCadence
  nextDueOn: Date
}

export interface NewObligation {
  label: string
  amountMinor: number
  currency: string
  cadence: ObligationCadence
  nextDueOn: Date
}

export interface ObligationRepository {
  add(userId: string, obligation: NewObligation): Promise<ObligationRecord>
  listFor(userId: string): Promise<ObligationRecord[]>
  remove(userId: string, id: string): Promise<boolean>
  /**
   * Every occurrence falling inside a window, with a recurring obligation expanded
   * into one entry per occurrence. The optimiser needs dated amounts, not rules.
   */
  occurrencesFor(userId: string, from: Date, to: Date): Promise<Array<{ label: string; dueOn: Date; amountMinor: number }>>
}

export function createObligationRepository(db: PrismaClient): ObligationRepository {
  return {
    async add(userId, obligation) {
      return toRecord(await db.obligation.create({ data: { userId, ...obligation } }))
    },

    async listFor(userId) {
      const rows = await db.obligation.findMany({ where: { userId }, orderBy: { nextDueOn: 'asc' } })
      return rows.map(toRecord)
    },

    async remove(userId, id) {
      const result = await db.obligation.deleteMany({ where: { id, userId } })
      return result.count > 0
    },

    async occurrencesFor(userId, from, to) {
      const obligations = await this.listFor(userId)
      return obligations.flatMap((obligation) => expand(obligation, from, to))
    },
  }
}

/** Expands a cadence into concrete dated occurrences inside [from, to]. */
export function expand(
  obligation: ObligationRecord,
  from: Date,
  to: Date,
): Array<{ label: string; dueOn: Date; amountMinor: number }> {
  const occurrences: Array<{ label: string; dueOn: Date; amountMinor: number }> = []
  const cursor = new Date(obligation.nextDueOn)
  let index = 0

  // A guard rather than a while(true): a corrupt cadence must not spin forever.
  const LIMIT = 500

  while (cursor <= to && index < LIMIT) {
    if (cursor >= from) {
      occurrences.push({
        label: obligation.cadence === 'ONCE' ? obligation.label : `${obligation.label} #${index + 1}`,
        dueOn: new Date(cursor),
        amountMinor: obligation.amountMinor,
      })
    }

    if (obligation.cadence === 'ONCE') break

    const months = obligation.cadence === 'MONTHLY' ? 1 : obligation.cadence === 'QUARTERLY' ? 3 : 12
    // setMonth clamps a 31st into a short month, which is the behaviour a bill
    // dated the 31st actually has: it lands on the last day available.
    cursor.setMonth(cursor.getMonth() + months)
    index += 1
  }

  return occurrences
}

function toRecord(row: {
  id: string
  label: string
  amountMinor: number
  currency: string
  cadence: ObligationCadence
  nextDueOn: Date
}): ObligationRecord {
  return {
    id: row.id,
    label: row.label,
    amountMinor: row.amountMinor,
    currency: row.currency,
    cadence: row.cadence,
    nextDueOn: row.nextDueOn,
  }
}
