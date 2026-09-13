export interface DashboardObligation {
  id: string
  label: string
  amountMinor: number
  currency: string
  cadence: string
  nextDueOn: string
}

export type DeadlineKind = 'TUITION' | 'GIC_RELEASE' | 'PERMIT_EXPIRY' | 'TAX_FILING' | 'OTHER'
export type DeadlineStatus = 'DONE' | 'OVERDUE' | 'DUE_SOON' | 'UPCOMING'

export interface DashboardDeadline {
  id: string
  label: string
  kind: DeadlineKind
  dueOn: string
  completedAt: string | null
  daysLeft: number
  status: DeadlineStatus
}

export interface DashboardAlert {
  id: string
  baseCurrency: string
  quoteCurrency: string
  targetRate: number
  direction: string
  spent: boolean
}

export interface DashboardRate {
  pair: string
  rate: number
  observedAt: string
}

export interface DashboardData {
  dashboard: {
    viewer: { displayName: string; email: string; homeCurrency: string }
    compliance: {
      breachedWeeks: number
      weeks: Array<{ weekStart: string; offCampusHours: number }>
      current: {
        weekStart: string
        offCampusHours: number
        onCampusHours: number
        remainingHours: number
        capHours: number
        breached: boolean
      }
    }
    obligations: DashboardObligation[]
    alerts: DashboardAlert[]
    rate: DashboardRate | null
    upcomingObligationsMinor: number
    deadlines: DashboardDeadline[]
  }
}
