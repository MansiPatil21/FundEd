/**
 * Study-permit work-hour compliance.
 *
 * A student on a Canadian study permit may work a limited number of off-campus
 * hours per week during study terms. Breaching the cap is a permit violation, not
 * an employment matter, so the calculation has to be defensible rather than
 * approximately right.
 *
 * Two details drive the implementation:
 *
 *   1. A shift that crosses a week boundary belongs to BOTH weeks, split at the
 *      boundary. Attributing the whole shift to its start week would let a student
 *      work an unlimited Sunday-night-into-Monday shift without ever appearing to
 *      breach. This is the bug the naive version has.
 *
 *   2. On-campus hours do not count against the cap, so they are tracked but
 *      excluded from the total that matters.
 *
 * Weeks run Monday 00:00 to Monday 00:00 in the student's local time, matching how
 * the cap is described.
 */

export interface Shift {
  startedAt: Date
  endedAt: Date
  onCampus: boolean
}

export interface WeekUsage {
  /** Monday 00:00 that opens the week. */
  weekStart: Date
  offCampusHours: number
  onCampusHours: number
  capHours: number
  /** Negative once the cap is exceeded. */
  remainingHours: number
  breached: boolean
}

const HOUR_MS = 3_600_000
const WEEK_MS = 7 * 24 * HOUR_MS

/** Monday 00:00:00.000 of the week containing `instant`. */
export function weekStartOf(instant: Date): Date {
  const start = new Date(instant)
  start.setHours(0, 0, 0, 0)
  // getDay(): Sunday is 0, so Sunday belongs to the week that began six days earlier.
  const daysSinceMonday = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - daysSinceMonday)
  return start
}

/**
 * Splits a shift at every week boundary it crosses, so each piece belongs to
 * exactly one week. A shift entirely inside one week yields a single piece.
 */
function splitAcrossWeeks(shift: Shift): Array<{ weekStart: Date; hours: number; onCampus: boolean }> {
  if (shift.endedAt <= shift.startedAt) {
    return []
  }

  const pieces: Array<{ weekStart: Date; hours: number; onCampus: boolean }> = []
  let cursor = shift.startedAt

  while (cursor < shift.endedAt) {
    const weekStart = weekStartOf(cursor)
    const nextWeekStart = new Date(weekStart.getTime() + WEEK_MS)
    const sliceEnd = nextWeekStart < shift.endedAt ? nextWeekStart : shift.endedAt

    pieces.push({
      weekStart,
      hours: (sliceEnd.getTime() - cursor.getTime()) / HOUR_MS,
      onCampus: shift.onCampus,
    })

    cursor = sliceEnd
  }

  return pieces
}

/**
 * Per-week usage for every week that has at least one shift, oldest first.
 */
export function weeklyUsage(shifts: readonly Shift[], capHours: number): WeekUsage[] {
  const byWeek = new Map<number, { offCampus: number; onCampus: number }>()

  for (const shift of shifts) {
    for (const piece of splitAcrossWeeks(shift)) {
      const key = piece.weekStart.getTime()
      const entry = byWeek.get(key) ?? { offCampus: 0, onCampus: 0 }
      if (piece.onCampus) {
        entry.onCampus += piece.hours
      } else {
        entry.offCampus += piece.hours
      }
      byWeek.set(key, entry)
    }
  }

  return [...byWeek.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, totals]) => ({
      weekStart: new Date(key),
      offCampusHours: round2(totals.offCampus),
      onCampusHours: round2(totals.onCampus),
      capHours,
      remainingHours: round2(capHours - totals.offCampus),
      breached: totals.offCampus > capHours,
    }))
}

/**
 * Usage for the week containing `asOf`, present even when no shift has been worked,
 * because "you have used none of your hours" is a real answer the dashboard needs.
 */
export function currentWeek(shifts: readonly Shift[], capHours: number, asOf: Date): WeekUsage {
  const weekStart = weekStartOf(asOf)
  const found = weeklyUsage(shifts, capHours).find(
    (week) => week.weekStart.getTime() === weekStart.getTime(),
  )
  return (
    found ?? {
      weekStart,
      offCampusHours: 0,
      onCampusHours: 0,
      capHours,
      remainingHours: capHours,
      breached: false,
    }
  )
}

/**
 * Whether adding a proposed shift would breach the cap in any week it touches.
 * This is the question the UI asks before letting a student accept a shift.
 */
export function wouldBreach(
  existing: readonly Shift[],
  proposed: Shift,
  capHours: number,
): boolean {
  const after = weeklyUsage([...existing, proposed], capHours)
  const touched = new Set(splitAcrossWeeks(proposed).map((piece) => piece.weekStart.getTime()))
  return after.some((week) => touched.has(week.weekStart.getTime()) && week.breached)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
