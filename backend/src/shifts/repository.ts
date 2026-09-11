import type { PrismaClient } from '@prisma/client'
import type { Shift } from '../compliance/workHours.js'

/**
 * Shift storage.
 *
 * The compliance rules in ../compliance/workHours.ts are pure functions over a list
 * of shifts and know nothing about a database. This layer is the only thing that
 * does, which is why those rules can be tested exhaustively without one.
 */

export interface ShiftRecord extends Shift {
  id: string
  employer: string
}

export interface NewShift {
  startedAt: Date
  endedAt: Date
  employer: string
  onCampus: boolean
}

export interface ShiftRepository {
  add(userId: string, shift: NewShift): Promise<ShiftRecord>
  listFor(userId: string, from?: Date, to?: Date): Promise<ShiftRecord[]>
  remove(userId: string, shiftId: string): Promise<boolean>
}

export function createShiftRepository(db: PrismaClient): ShiftRepository {
  return {
    async add(userId, shift) {
      const created = await db.shift.create({
        data: { userId, ...shift },
      })
      return toRecord(created)
    },

    async listFor(userId, from, to) {
      const rows = await db.shift.findMany({
        where: {
          userId,
          ...(from || to
            ? { startedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
            : {}),
        },
        orderBy: { startedAt: 'asc' },
      })
      return rows.map(toRecord)
    },

    async remove(userId, shiftId) {
      // Scoped by userId as well as id, so one user cannot delete another's shift by
      // guessing an ObjectId. Checking ownership after the fact would still delete it.
      const result = await db.shift.deleteMany({ where: { id: shiftId, userId } })
      return result.count > 0
    },
  }
}

function toRecord(row: {
  id: string
  startedAt: Date
  endedAt: Date
  employer: string
  onCampus: boolean
}): ShiftRecord {
  return {
    id: row.id,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    employer: row.employer,
    onCampus: row.onCampus,
  }
}
