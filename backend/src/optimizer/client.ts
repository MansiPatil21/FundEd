import { z } from 'zod'

/**
 * Client for the Python optimiser service.
 *
 * NFR-5 says the product degrades rather than fails. The optimiser is the one
 * component that is genuinely optional: without it a student still has their
 * compliance tracker, their obligations and their deadlines, and simply does not get
 * a suggested transfer schedule. So every failure here is converted into a typed
 * "unavailable" result rather than an exception that bubbles into a 500.
 *
 * The response is parsed with Zod rather than trusted (NFR-3). A separately deployed
 * service can be rolled forward independently, and a silently changed field would
 * otherwise become a wrong number on someone's dashboard.
 */

const plannedTransferSchema = z.object({
  send_on: z.string(),
  amount_minor: z.number().int(),
  fee_minor: z.number().int(),
  rate: z.number().positive(),
  received_home_minor: z.number().int(),
})

const planSchema = z.object({
  status: z.string(),
  transfers: z.array(plannedTransferSchema),
  total_sent_minor: z.number().int(),
  total_fees_minor: z.number().int(),
  total_cost_minor: z.number().int(),
  closing_balance_minor: z.number().int(),
})

export type OptimiserPlan = z.infer<typeof planSchema>

export interface PlanInput {
  periods: Array<{ on: string; rate: number; income_minor?: number; spending_minor?: number }>
  obligations: Array<{ label: string; due_on: string; amount_minor: number }>
  fees: { fixed_minor: number; variable_bps: number }
  opening_balance_minor: number
  minimum_balance_minor?: number
  min_transfer_minor?: number
}

export type PlanOutcome =
  | { kind: 'planned'; plan: OptimiserPlan }
  | { kind: 'rejected'; reason: string }
  | { kind: 'unavailable'; reason: string }

export interface OptimiserClient {
  plan(input: PlanInput): Promise<PlanOutcome>
  healthy(): Promise<boolean>
}

export function createOptimiserClient(baseUrl: string, timeoutMs = 30_000): OptimiserClient {
  const post = async (path: string, body: unknown): Promise<Response> =>
    fetch(new URL(path, baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // A solve is CPU-bound and can legitimately take seconds, but it must not hang
      // a request forever if the service wedges.
      signal: AbortSignal.timeout(timeoutMs),
    })

  return {
    async plan(input) {
      let response: Response
      try {
        response = await post('/plan', input)
      } catch (error) {
        // Read `name` off the value rather than using `instanceof Error`. An
        // AbortSignal timeout rejects with a DOMException, and `instanceof` compares
        // prototypes from one realm: under a test runner that supplies its own
        // globals the check silently returns false and every timeout would be
        // misreported as a refused connection.
        const name = (error as { name?: unknown })?.name
        return {
          kind: 'unavailable',
          reason: name === 'TimeoutError' || name === 'AbortError'
            ? `optimiser did not respond within ${timeoutMs}ms`
            : 'optimiser unreachable',
        }
      }

      // 422 is the service telling us the request is impossible, e.g. an obligation
      // that no period can fund. That is an answer, not an outage, so it is reported
      // as a rejection the user can act on.
      if (response.status === 422) {
        const detail = await response.json().catch(() => ({}))
        return { kind: 'rejected', reason: String((detail as { detail?: string }).detail ?? 'request rejected') }
      }

      if (!response.ok) {
        return { kind: 'unavailable', reason: `optimiser returned ${response.status}` }
      }

      const parsed = planSchema.safeParse(await response.json().catch(() => null))
      if (!parsed.success) {
        return { kind: 'unavailable', reason: 'optimiser returned an unrecognised shape' }
      }

      return { kind: 'planned', plan: parsed.data }
    },

    async healthy() {
      try {
        const response = await fetch(new URL('/health', baseUrl), {
          signal: AbortSignal.timeout(2_000),
        })
        return response.ok
      } catch {
        return false
      }
    },
  }
}
