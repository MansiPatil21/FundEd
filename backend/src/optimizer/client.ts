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
 * Responses are parsed with Zod rather than trusted (NFR-3). A separately deployed
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

const savingSchema = z.object({
  paths: z.number().int(),
  feasible_paths: z.number().int(),
  mean_saving_minor: z.number(),
  median_saving_minor: z.number(),
  ci_low_minor: z.number(),
  ci_high_minor: z.number(),
  confidence: z.number(),
  significant: z.boolean(),
  caveat: z.string(),
})

export type OptimiserPlan = z.infer<typeof planSchema>
export type OptimiserSaving = z.infer<typeof savingSchema>

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

export type SavingOutcome =
  | { kind: 'estimated'; saving: OptimiserSaving }
  | { kind: 'rejected'; reason: string }
  | { kind: 'unavailable'; reason: string }

export interface SavingOptions {
  paths?: number
  confidence?: number
}

export interface OptimiserClient {
  /** The optimal transfer schedule. */
  plan(input: PlanInput): Promise<PlanOutcome>
  /** What sending a fixed amount on a fixed day each month would cost, for comparison. */
  baseline(input: PlanInput): Promise<PlanOutcome>
  /** The saving across simulated rate paths, with a confidence interval. CPU-heavy. */
  saving(input: PlanInput, historicalRates: number[], options?: SavingOptions): Promise<SavingOutcome>
  healthy(): Promise<boolean>
}

type CallResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'rejected'; reason: string }
  | { kind: 'unavailable'; reason: string }

/**
 * @param timeoutMs A single solve. Normally well under a second.
 * @param savingTimeoutMs The uncertainty estimate, which solves once per simulated rate
 *   path. Measured on a 180-day horizon: 40 paths took about 9 s and 120 took about 41 s,
 *   so it gets its own, longer limit rather than sharing the one for a single solve.
 * @param apiKey Sent as `x-api-key` when the optimiser requires one, as it does on Azure.
 */
export function createOptimiserClient(
  baseUrl: string,
  timeoutMs = 30_000,
  savingTimeoutMs = 90_000,
  apiKey?: string,
): OptimiserClient {
  async function call<T>(path: string, body: unknown, schema: z.ZodType<T>, limitMs: number): Promise<CallResult<T>> {
    let response: Response
    try {
      response = await fetch(new URL(path, baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) },
        body: JSON.stringify(body),
        // CPU-bound work can legitimately take seconds, but must not hang a request
        // forever if the service wedges.
        signal: AbortSignal.timeout(limitMs),
      })
    } catch (error) {
      // Read `name` off the value rather than using `instanceof Error`. An AbortSignal
      // timeout rejects with a DOMException, and `instanceof` compares prototypes from
      // one realm: under a test runner that supplies its own globals the check silently
      // returns false and every timeout would be misreported as a refused connection.
      const name = (error as { name?: unknown })?.name
      return {
        kind: 'unavailable',
        reason:
          name === 'TimeoutError' || name === 'AbortError'
            ? `optimiser did not respond within ${limitMs}ms`
            : 'optimiser unreachable',
      }
    }

    // 422 is the service telling us the request is impossible, e.g. an obligation that no
    // period can fund. That is an answer, not an outage, so it becomes a rejection the
    // user can act on.
    if (response.status === 422) {
      return { kind: 'rejected', reason: describeRejection(await response.json().catch(() => ({}))) }
    }

    if (!response.ok) {
      return { kind: 'unavailable', reason: `optimiser returned ${response.status}` }
    }

    const parsed = schema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) {
      return { kind: 'unavailable', reason: 'optimiser returned an unrecognised shape' }
    }
    return { kind: 'ok', value: parsed.data }
  }

  return {
    async plan(input) {
      const result = await call('/plan', input, planSchema, timeoutMs)
      return result.kind === 'ok' ? { kind: 'planned', plan: result.value } : result
    },

    async baseline(input) {
      const result = await call('/baseline', input, planSchema, timeoutMs)
      return result.kind === 'ok' ? { kind: 'planned', plan: result.value } : result
    },

    async saving(input, historicalRates, options = {}) {
      const result = await call(
        '/saving',
        {
          plan: input,
          historical_rates: historicalRates,
          paths: options.paths ?? 40,
          confidence: options.confidence ?? 0.95,
        },
        savingSchema,
        savingTimeoutMs,
      )
      return result.kind === 'ok' ? { kind: 'estimated', saving: result.value } : result
    },

    async healthy() {
      try {
        const response = await fetch(new URL('/health', baseUrl), { signal: AbortSignal.timeout(2_000) })
        return response.ok
      } catch {
        return false
      }
    },
  }
}

/**
 * FastAPI reports a 422 two ways: a string `detail` from an explicit HTTPException, or a
 * list of validation errors when the request body itself is invalid. Stringifying the
 * list would show a person "[object Object]".
 */
function describeRejection(body: unknown): string {
  const detail = (body as { detail?: unknown })?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const message = (detail[0] as { msg?: unknown })?.msg
    if (typeof message === 'string') return message
  }
  return 'request rejected'
}
