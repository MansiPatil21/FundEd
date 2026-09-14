import { describe, expect, it } from 'vitest'
import { buildNotifications, timeAgo } from './notifications'
import type { DashboardData, DashboardDeadline } from '@/components/dashboard/types'

const NOW = Date.parse('2026-09-13T15:00:00Z')

function dashboard(overrides: Partial<DashboardData['dashboard']> = {}): DashboardData['dashboard'] {
  return {
    viewer: { displayName: 'Mansi', email: 'm@example.com', homeCurrency: 'INR' },
    compliance: {
      breachedWeeks: 0,
      weeks: [],
      current: {
        weekStart: '2026-09-07',
        offCampusHours: 10,
        onCampusHours: 0,
        remainingHours: 14,
        capHours: 24,
        breached: false,
      },
    },
    obligations: [],
    alerts: [],
    rate: null,
    upcomingObligationsMinor: 0,
    deadlines: [],
    ...overrides,
  }
}

const deadline = (id: string, status: DashboardDeadline['status'], daysLeft: number): DashboardDeadline => ({
  id,
  label: `Deadline ${id}`,
  kind: 'TUITION',
  dueOn: '2026-09-20',
  completedAt: null,
  daysLeft,
  status,
})

describe('buildNotifications', () => {
  it('is empty when nothing needs attention', () => {
    expect(buildNotifications(dashboard(), { permit: null }, NOW)).toEqual([])
  })

  it('reports an alert that fired, and ignores one still watching', () => {
    const items = buildNotifications(
      dashboard({
        alerts: [
          { id: 'a1', baseCurrency: 'CAD', quoteCurrency: 'INR', targetRate: 63, direction: 'AT_OR_ABOVE', spent: true, triggeredAt: '2026-09-13T12:00:00Z' },
          { id: 'a2', baseCurrency: 'CAD', quoteCurrency: 'INR', targetRate: 70, direction: 'AT_OR_ABOVE', spent: false, triggeredAt: null },
        ],
      }),
      { permit: null },
      NOW,
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'rate', tone: 'success', title: 'CAD/INR reached 63.00', href: '/dashboard#alerts' })
    expect(items[0]!.detail).toBe('Rose to your target 3 h ago')
  })

  it('includes overdue and due-soon deadlines but not upcoming or finished ones', () => {
    const items = buildNotifications(
      dashboard({
        deadlines: [deadline('late', 'OVERDUE', -2), deadline('soon', 'DUE_SOON', 3), deadline('later', 'UPCOMING', 40), deadline('done', 'DONE', 1)],
      }),
      { permit: null },
      NOW,
    )

    expect(items.map((item) => item.title)).toEqual(['Deadline late', 'Deadline soon'])
    expect(items.map((item) => item.tone)).toEqual(['danger', 'warning'])
  })

  it('warns about a breached hour cap and a permit expiring within 90 days, most urgent first', () => {
    const base = dashboard()
    const items = buildNotifications(
      dashboard({
        compliance: { ...base.compliance, current: { ...base.compliance.current, offCampusHours: 26.5, breached: true } },
        alerts: [{ id: 'a1', baseCurrency: 'CAD', quoteCurrency: 'INR', targetRate: 60, direction: 'AT_OR_BELOW', spent: true, triggeredAt: '2026-09-13T14:58:00Z' }],
      }),
      { permit: { institution: 'Dal', programEndsOn: '2027-05-01', expiresOn: '2026-11-01T12:00:00Z', weeklyHourCap: 24 } },
      NOW,
    )

    expect(items.map((item) => item.kind)).toEqual(['hours', 'permit', 'rate'])
    expect(items[0]!.detail).toBe('26.5 of 24 off-campus hours this week')
    expect(items[1]!.detail).toBe('Expires in 49 days')
    expect(items[2]!.detail).toBe('Fell to your target 2 min ago')
  })

  it('stays quiet about a permit that expires more than 90 days away', () => {
    const items = buildNotifications(
      dashboard(),
      { permit: { institution: 'Dal', programEndsOn: '2027-05-01', expiresOn: '2027-06-01T12:00:00Z', weeklyHourCap: 24 } },
      NOW,
    )
    expect(items).toEqual([])
  })

  it('gives a fired alert a new id when it fires again, so it shows as unread', () => {
    const fired = (at: string) =>
      buildNotifications(
        dashboard({ alerts: [{ id: 'a1', baseCurrency: 'CAD', quoteCurrency: 'INR', targetRate: 63, direction: 'AT_OR_ABOVE', spent: true, triggeredAt: at }] }),
        { permit: null },
        NOW,
      )[0]!.id

    expect(fired('2026-09-12T10:00:00Z')).not.toBe(fired('2026-09-13T10:00:00Z'))
  })
})

describe('timeAgo', () => {
  it.each([
    ['2026-09-13T14:59:30Z', 'just now'],
    ['2026-09-13T14:45:00Z', '15 min ago'],
    ['2026-09-13T10:00:00Z', '5 h ago'],
    ['2026-09-12T15:00:00Z', '1 day ago'],
    ['2026-09-10T15:00:00Z', '3 days ago'],
    ['2026-08-30T15:00:00Z', 'on Aug 30'],
  ])('describes %s as "%s"', (iso, expected) => {
    expect(timeAgo(iso, NOW)).toBe(expected)
  })
})
