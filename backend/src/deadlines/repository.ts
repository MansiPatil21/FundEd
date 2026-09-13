import type { DeadlineKind, PrismaClient } from '@prisma/client'

/**
 * Deadlines that carry consequences beyond a late fee: tuition, a GIC release, a permit
 * expiring, tax filing.
 *
 * Nothing here filters on completedAt in the database. On MongoDB an unset field is absent
 * rather than null (ADR 0004), so "open" and "done" are decided from the fetched rows in
 * status.ts, where that trap cannot bite.
 */

export interface DeadlineRecord {
  id: string
  label: string
  kind: DeadlineKind
  dueOn: Date
  completedAt: Date | null
}

export interface NewDeadline {
  label: string
  kind: DeadlineKind
  dueOn: Date
}

export interface DeadlineRepository {
  add(userId: string, deadline: NewDeadline): Promise<DeadlineRecord>
  listFor(userId: string): Promise<DeadlineRecord[]>
  setCompleted(userId: string, id: string, completed: boolean): Promise<DeadlineRecord | null>
  remove(userId: string, id: string): Promise<boolean>
}

export function createDeadlineRepository(db: PrismaClient): DeadlineRepository {
  return {
    async add(userId, deadline) {
      return toRecord(await db.deadline.create({ data: { userId, ...deadline } }))
    },

    async listFor(userId) {
      const rows = await db.deadline.findMany({ where: { userId }, orderBy: { dueOn: 'asc' } })
      return rows.map(toRecord)
    },

    async setCompleted(userId, id, completed) {
      // Scoped by owner inside the update, so a guessed id cannot touch someone else's row.
      const result = await db.deadline.updateMany({
        where: { id, userId },
        data: { completedAt: completed ? new Date() : null },
      })
      if (result.count === 0) return null
      const row = await db.deadline.findFirst({ where: { id, userId } })
      return row ? toRecord(row) : null
    },

    async remove(userId, id) {
      const result = await db.deadline.deleteMany({ where: { id, userId } })
      return result.count > 0
    },
  }
}

function toRecord(row: {
  id: string
  label: string
  kind: DeadlineKind
  dueOn: Date
  completedAt: Date | null
}): DeadlineRecord {
  return { id: row.id, label: row.label, kind: row.kind, dueOn: row.dueOn, completedAt: row.completedAt ?? null }
}
