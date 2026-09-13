import { afterEach, describe, expect, it } from '@jest/globals'
import { createServer, type Server } from 'node:http'
import { createFrankfurterSource } from './frankfurter.js'

/** Against a real local HTTP server, so the test exercises fetch, not a mock of it. */

let server: Server | undefined
const serve = (status: number, body: unknown): Promise<string> =>
  new Promise((resolve) => {
    server = createServer((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`)
    })
  })

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = undefined
})

describe('Frankfurter rate source', () => {
  it('reads the rate for the pair and stamps the publication date at a fixed time', async () => {
    const url = await serve(200, { amount: 1, base: 'CAD', date: '2026-09-11', rates: { INR: 61.73 } })
    const observation = await createFrankfurterSource(url).fetch('CAD', 'INR')
    expect(observation.rate).toBe(61.73)
    expect(observation.observedAt.toISOString()).toBe('2026-09-11T15:00:00.000Z')
  })

  it('throws when the pair is missing, rather than inventing a rate', async () => {
    const url = await serve(200, { amount: 1, base: 'CAD', date: '2026-09-11', rates: { USD: 0.73 } })
    await expect(createFrankfurterSource(url).fetch('CAD', 'INR')).rejects.toThrow('no CAD/INR rate')
  })

  it('throws on an error status', async () => {
    const url = await serve(503, {})
    await expect(createFrankfurterSource(url).fetch('CAD', 'INR')).rejects.toThrow('returned 503')
  })

  it('throws on a response whose shape has changed', async () => {
    const url = await serve(200, { base: 'CAD', rates: 'soon' })
    await expect(createFrankfurterSource(url).fetch('CAD', 'INR')).rejects.toThrow('unrecognised shape')
  })
})
