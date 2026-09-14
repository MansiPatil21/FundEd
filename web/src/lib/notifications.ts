import { describeDue } from '@/components/dashboard/DeadlinePanel'
import type { DashboardData } from '@/components/dashboard/types'
import type { Profile } from './session'

export type NotificationKind = 'rate' | 'deadline' | 'hours' | 'permit'
export type NotificationTone = 'danger' | 'warning' | 'success'

export interface AppNotification {
  /** Stable while the underlying fact is unchanged, so "seen" survives a reload but a new event is new. */
  id: string
  kind: NotificationKind
  tone: NotificationTone
  title: string
  detail: string
  href: string
}

const DAY = 86_400_000
const PERMIT_WARNING_DAYS = 90
const SEVERITY: Record<NotificationTone, number> = { danger: 0, warning: 1, success: 2 }

/**
 * Everything worth interrupting a student about, built from data the dashboard already loads.
 *
 * No separate notifications table: each item is derived from the state that causes it, so a
 * deadline marked done or an alert deleted disappears from the list on the next load instead
 * of lingering as a stale message. Most urgent first.
 */
export function buildNotifications(
  dashboard: DashboardData['dashboard'],
  profile: Pick<Profile, 'permit'>,
  now: number,
): AppNotification[] {
  const items: Array<AppNotification & { at: number }> = []

  for (const alert of dashboard.alerts) {
    if (!alert.spent || !alert.triggeredAt) continue
    items.push({
      id: `rate:${alert.id}:${alert.triggeredAt}`,
      kind: 'rate',
      tone: 'success',
      title: `${alert.baseCurrency}/${alert.quoteCurrency} reached ${alert.targetRate.toFixed(2)}`,
      detail: `${alert.direction === 'AT_OR_ABOVE' ? 'Rose' : 'Fell'} to your target ${timeAgo(alert.triggeredAt, now)}`,
      href: '/dashboard#alerts',
      at: Date.parse(alert.triggeredAt),
    })
  }

  for (const deadline of dashboard.deadlines) {
    if (deadline.status !== 'OVERDUE' && deadline.status !== 'DUE_SOON') continue
    items.push({
      id: `deadline:${deadline.id}:${deadline.status}`,
      kind: 'deadline',
      tone: deadline.status === 'OVERDUE' ? 'danger' : 'warning',
      title: deadline.label,
      detail: describeDue(deadline.daysLeft, deadline.status),
      href: '/dashboard#deadlines',
      at: now - deadline.daysLeft * DAY,
    })
  }

  const week = dashboard.compliance.current
  if (week.breached) {
    items.push({
      id: `hours:${week.weekStart}`,
      kind: 'hours',
      tone: 'danger',
      title: 'Over your weekly work cap',
      detail: `${round(week.offCampusHours)} of ${round(week.capHours)} off-campus hours this week`,
      href: '/dashboard#shifts',
      at: now,
    })
  }

  if (profile.permit) {
    const daysLeft = Math.ceil((Date.parse(profile.permit.expiresOn) - now) / DAY)
    if (daysLeft <= PERMIT_WARNING_DAYS) {
      items.push({
        id: `permit:${profile.permit.expiresOn}`,
        kind: 'permit',
        tone: daysLeft <= 0 ? 'danger' : 'warning',
        title: daysLeft <= 0 ? 'Study permit expired' : 'Study permit expiring',
        detail: daysLeft <= 0 ? 'Apply to restore your status' : `Expires in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`,
        href: '/profile',
        at: now,
      })
    }
  }

  return items
    .sort((a, b) => SEVERITY[a.tone] - SEVERITY[b.tone] || b.at - a.at)
    .map(({ id, kind, tone, title, detail, href }) => ({ id, kind, tone, title, detail, href }))
}

export function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  return `on ${new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`
}

function round(hours: number): number {
  return Math.round(hours * 10) / 10
}
