import { gql } from '@apollo/client'

/**
 * One query for the whole dashboard. Four REST calls become one round trip, which is the
 * entire reason the read side is GraphQL.
 */
export const DASHBOARD = gql`
  query Dashboard($upcomingDays: Int) {
    dashboard {
      viewer {
        displayName
        email
        homeCurrency
      }
      compliance {
        breachedWeeks
        weeks {
          weekStart
          offCampusHours
        }
        current {
          weekStart
          offCampusHours
          onCampusHours
          remainingHours
          capHours
          breached
        }
      }
      obligations {
        id
        label
        amountMinor
        currency
        cadence
        nextDueOn
      }
      alerts {
        id
        baseCurrency
        quoteCurrency
        targetRate
        direction
        spent
      }
      rate {
        pair
        rate
        observedAt
      }
      upcomingObligationsMinor(days: $upcomingDays)
      deadlines {
        id
        label
        kind
        dueOn
        completedAt
        daysLeft
        status
      }
    }
  }
`
