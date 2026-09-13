/**
 * Where a deadline stands today.
 *
 * Counted in calendar days between local dates, not elapsed milliseconds divided by a day.
 * Around a daylight-saving change a day is 23 or 25 hours long, and dividing elapsed time
 * would call a deadline three days away 2.96 days, which then rounds the wrong way.
 */

export type DeadlineStatus = 'DONE' | 'OVERDUE' | 'DUE_SOON' | 'UPCOMING'

/** Two weeks: long enough to act on a tuition or permit date, short enough not to nag. */
export const DUE_SOON_DAYS = 14

export function daysUntil(dueOn: Date, now: Date): number {
  const due = Date.UTC(dueOn.getFullYear(), dueOn.getMonth(), dueOn.getDate())
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((due - today) / 86_400_000)
}

export function deadlineStatus(
  deadline: { dueOn: Date; completedAt: Date | null },
  now: Date,
): { daysLeft: number; status: DeadlineStatus } {
  const daysLeft = daysUntil(deadline.dueOn, now)
  if (deadline.completedAt) return { daysLeft, status: 'DONE' }
  if (daysLeft < 0) return { daysLeft, status: 'OVERDUE' }
  if (daysLeft <= DUE_SOON_DAYS) return { daysLeft, status: 'DUE_SOON' }
  return { daysLeft, status: 'UPCOMING' }
}

/** Open deadlines needing attention: the most overdue first, then those due soonest. */
export function needingAttention<T extends { dueOn: Date; completedAt: Date | null }>(
  deadlines: readonly T[],
  now: Date,
): Array<T & { daysLeft: number; status: DeadlineStatus }> {
  return deadlines
    .map((deadline) => ({ ...deadline, ...deadlineStatus(deadline, now) }))
    .filter((deadline) => deadline.status === 'OVERDUE' || deadline.status === 'DUE_SOON')
    .sort((a, b) => a.daysLeft - b.daysLeft)
}
