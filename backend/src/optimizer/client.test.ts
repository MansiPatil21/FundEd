import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { createServer, type Server } from 'node:http'
import { createOptimiserClient } from './client.js'

/**
 * These run against a real HTTP server rather than a mocked fetch.
 *
 * The behaviour worth testing is what happens to a socket: a connection refused, a
 * server that never answers, a body that is not the shape we expect. A mocked fetch
 * would only test that the mock was called.
 */

let server: Server
let baseUrl: string

const startServer = (handler: (req: unknown, res: any) => void): Promise<void> =>
  new Promise((resolve) => {
    server = createServer(handler as never)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
      resolve()
    })
  })

const input = {
  periods: [{ on: '2027-01-01', rate: 60 }],
  obligations: [{ label: 'rent', due_on: '2027-01-01', amount_minor: 60_000 }],
  fees: { fixed_minor: 0, variable_bps: 0 },
  opening_balance_minor: 100_000,
}

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()))
})

describe('optimiser client', () => {
  it('returns the plan when the service answers correctly', async () => {
    await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'OPTIMAL',
          transfers: [
            { send_on: '2027-01-01', amount_minor: 1_000, fee_minor: 0, rate: 60, received_home_minor: 60_000 },
          ],
          total_sent_minor: 1_000,
          total_fees_minor: 0,
          total_cost_minor: 1_000,
          closing_balance_minor: 99_000,
        }),
      )
    })

    const outcome = await createOptimiserClient(baseUrl).plan(input)

    expect(outcome.kind).toBe('planned')
    if (outcome.kind === 'planned') {
      expect(outcome.plan.status).toBe('OPTIMAL')
      expect(outcome.plan.transfers).toHaveLength(1)
    }
  })

  it('reports a 422 as a rejection the user can act on, not an outage', async () => {
    await startServer((_req, res) => {
      res.writeHead(422, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ detail: 'no period can fund "tuition"' }))
    })

    const outcome = await createOptimiserClient(baseUrl).plan(input)

    expect(outcome.kind).toBe('rejected')
    if (outcome.kind === 'rejected') {
      expect(outcome.reason).toContain('tuition')
    }
  })

  it('reports unavailable when nothing is listening, rather than throwing', async () => {
    await startServer((_req, res) => res.end())
    const dead = `http://127.0.0.1:${1}` // port 1: nothing will be there

    const outcome = await createOptimiserClient(dead, 1_000).plan(input)

    expect(outcome.kind).toBe('unavailable')
  })

  it('reports unavailable when the service hangs past the timeout', async () => {
    await startServer(() => {
      // Never responds.
    })

    const outcome = await createOptimiserClient(baseUrl, 200).plan(input)

    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind === 'unavailable') {
      expect(outcome.reason).toContain('200ms')
    }
  })

  it('reports unavailable when the service returns a 500', async () => {
    await startServer((_req, res) => {
      res.writeHead(500)
      res.end('boom')
    })

    const outcome = await createOptimiserClient(baseUrl).plan(input)
    expect(outcome.kind).toBe('unavailable')
  })

  // NFR-3: a separately deployed service can change shape underneath us. Parsing
  // rather than trusting is what stops that becoming a wrong number on a dashboard.
  it('refuses a well-formed response whose shape is wrong', async () => {
    await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'OPTIMAL', transfers: 'not-an-array' }))
    })

    const outcome = await createOptimiserClient(baseUrl).plan(input)

    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind === 'unavailable') {
      expect(outcome.reason).toContain('unrecognised shape')
    }
  })

  it('reports the service unhealthy when health does not answer', async () => {
    await startServer((_req, res) => {
      res.writeHead(503)
      res.end()
    })

    expect(await createOptimiserClient(baseUrl).healthy()).toBe(false)
  })
})

describe('optimiser client: comparison and uncertainty', () => {
  const planBody = {
    status: 'BASELINE',
    transfers: [{ send_on: '2027-01-01', amount_minor: 1_000, fee_minor: 399, rate: 60, received_home_minor: 60_000 }],
    total_sent_minor: 1_000,
    total_fees_minor: 399,
    total_cost_minor: 1_399,
    closing_balance_minor: 99_000,
  }

  const savingBody = {
    paths: 40,
    feasible_paths: 40,
    mean_saving_minor: 5650.9,
    median_saving_minor: 5600.1,
    ci_low_minor: 4971.3,
    ci_high_minor: 6354.4,
    confidence: 0.95,
    significant: true,
    caveat: 'upper bound',
  }

  const json = (res: any, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  it('asks /baseline for the monthly comparison', async () => {
    let path = ''
    await startServer((req: any, res) => {
      path = req.url
      json(res, 200, planBody)
    })

    const outcome = await createOptimiserClient(baseUrl).baseline(input)

    expect(path).toBe('/baseline')
    expect(outcome.kind).toBe('planned')
  })

  it('sends the rate history and path count for the uncertainty estimate', async () => {
    let received: { url: string; body: any } | undefined
    await startServer((req: any, res) => {
      let raw = ''
      req.on('data', (chunk: Buffer) => (raw += chunk))
      req.on('end', () => {
        received = { url: req.url, body: JSON.parse(raw) }
        json(res, 200, savingBody)
      })
    })

    const outcome = await createOptimiserClient(baseUrl).saving(input, [60, 60.5, 61], { paths: 40 })

    expect(received?.url).toBe('/saving')
    expect(received?.body.historical_rates).toEqual([60, 60.5, 61])
    expect(received?.body.paths).toBe(40)
    expect(outcome.kind).toBe('estimated')
  })

  it('refuses an uncertainty estimate whose shape is wrong', async () => {
    await startServer((_req, res) => json(res, 200, { ...savingBody, mean_saving_minor: 'lots' }))

    const outcome = await createOptimiserClient(baseUrl).saving(input, [60, 60.5, 61])

    expect(outcome.kind).toBe('unavailable')
  })

  // FastAPI sends body-validation failures as a list, and stringifying it shows "[object Object]".
  it('reads the first message out of a FastAPI validation list', async () => {
    await startServer((_req, res) =>
      json(res, 422, { detail: [{ msg: 'need at least 3 historical observations', loc: ['body'] }] }),
    )

    const outcome = await createOptimiserClient(baseUrl).saving(input, [60, 61, 62])

    expect(outcome.kind).toBe('rejected')
    if (outcome.kind === 'rejected') {
      expect(outcome.reason).toContain('need at least 3')
    }
  })

  it('gives the uncertainty estimate its own, longer timeout', async () => {
    await startServer(() => {
      // Never responds.
    })

    const outcome = await createOptimiserClient(baseUrl, 50, 400).saving(input, [60, 61, 62])

    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind === 'unavailable') {
      expect(outcome.reason).toContain('400ms')
    }
  })
})

describe('optimiser client API key', () => {
  const planBody = {
    status: 'OPTIMAL',
    transfers: [],
    total_sent_minor: 0,
    total_fees_minor: 0,
    total_cost_minor: 0,
    closing_balance_minor: 100_000,
  }

  it('sends the key as x-api-key when one is configured', async () => {
    let received: string | undefined
    await startServer((req, res) => {
      received = (req as { headers: Record<string, string | undefined> }).headers['x-api-key']
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(planBody))
    })

    const outcome = await createOptimiserClient(baseUrl, undefined, undefined, 'k'.repeat(40)).plan(input)

    expect(outcome.kind).toBe('planned')
    expect(received).toBe('k'.repeat(40))
  })

  it('sends no key header when none is configured', async () => {
    let headers: Record<string, string | undefined> = {}
    await startServer((req, res) => {
      headers = (req as { headers: Record<string, string | undefined> }).headers
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(planBody))
    })

    await createOptimiserClient(baseUrl).plan(input)

    expect(headers['x-api-key']).toBeUndefined()
  })

  it('reports a rejected key as unavailable rather than throwing', async () => {
    await startServer((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ detail: 'invalid or missing API key' }))
    })

    const outcome = await createOptimiserClient(baseUrl, undefined, undefined, 'wrong-key-wrong-key').plan(input)

    expect(outcome).toEqual({ kind: 'unavailable', reason: 'optimiser returned 401' })
  })
})
