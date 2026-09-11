import express, { Router } from 'express'
import { z } from 'zod'
import { currentUser } from '../auth/middleware.js'
import type { FxService } from './service.js'
import { ratePushSchema, signatureIsValid } from './webhook.js'
import type { PrismaClient } from '@prisma/client'

const newAlertSchema = z.object({
  baseCurrency: z.string().length(3),
  quoteCurrency: z.string().length(3),
  targetRate: z.number().positive(),
  direction: z.enum(['AT_OR_ABOVE', 'AT_OR_BELOW']),
})

/** Authenticated routes: a student's own alerts. */
export function fxRouter(db: PrismaClient, fx: FxService): Router {
  const router = Router()

  router.post('/alerts', async (req, res) => {
    const user = currentUser(req)
    const alert = newAlertSchema.parse(req.body)
    const created = await db.fxAlert.create({ data: { userId: user.sub, ...alert } })
    res.status(201).json(created)
  })

  router.get('/alerts', async (req, res) => {
    const user = currentUser(req)
    res.json({
      alerts: await db.fxAlert.findMany({ where: { userId: user.sub }, orderBy: { createdAt: 'desc' } }),
    })
  })

  router.get('/rate/:base/:quote', async (req, res) => {
    const rate = await fx.latest(req.params.base!.toUpperCase(), req.params.quote!.toUpperCase())
    if (!rate) {
      res.status(404).json({ error: 'no_observation' })
      return
    }
    res.json(rate)
  })

  return router
}

/**
 * The provider's webhook. Public, so the signature is the whole security boundary.
 *
 * express.raw rather than express.json: the signature covers the bytes that arrived,
 * and re-serialising the parsed object produces different bytes.
 */
export function fxWebhookRouter(fx: FxService, secret: string): Router {
  const router = Router()

  router.post('/rates', express.raw({ type: '*/*', limit: '16kb' }), async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : ''
    const signature = req.header('x-provider-signature') ?? ''

    if (!signatureIsValid(raw, signature, secret)) {
      res.status(401).json({ error: 'bad_signature' })
      return
    }

    const parsed = ratePushSchema.safeParse(safeJson(raw))
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_payload' })
      return
    }

    const fired = await fx.record({
      baseCurrency: parsed.data.base.toUpperCase(),
      quoteCurrency: parsed.data.quote.toUpperCase(),
      rate: parsed.data.rate,
      observedAt: parsed.data.observed_at,
    })

    // 202: accepted and processed. The provider does not care who was notified.
    res.status(202).json({ alertsTriggered: fired.length })
  })

  return router
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
