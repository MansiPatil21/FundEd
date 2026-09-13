import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals'
import request from 'supertest'
import { testDatabase } from '../testing/database.js'
import { createApp } from '../http/app.js'
import { loadEnv } from '../config/env.js'
import { createTokenService } from '../auth/tokens.js'

const db = testDatabase('deadlines')
const tokens = createTokenService('deadlines-test-secret-long-enough', 3600)
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'mongodb://localhost:27017/funded_test_deadlines',
  JWT_SECRET: 'a-secret-long-enough-to-pass-validation',
  FX_WEBHOOK_SECRET: 'webhook-secret-16+',
} as NodeJS.ProcessEnv)

let app: Awaited<ReturnType<typeof createApp>>

beforeAll(async () => {
  app = await createApp({ env, checkHealth: async () => ({ mongo: 'up' }), db, tokens })
})

beforeEach(async () => {
  await db.deadline.deleteMany()
  await db.user.deleteMany()
})

afterAll(async () => {
  await db.$disconnect()
})

const signIn = async (email = 'deadlines@example.com') =>
  (await request(app).post('/api/auth/local').send({ email })).body.token as string

const inDays = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(12, 0, 0, 0)
  return date.toISOString()
}

const add = (token: string, body: object) =>
  request(app).post('/api/deadlines').set('Authorization', `Bearer ${token}`).send(body)

describe('deadlines', () => {
  it('stores a deadline and reports where it stands today', async () => {
    const token = await signIn()
    const created = await add(token, { label: 'Winter tuition', kind: 'TUITION', dueOn: inDays(5) })

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ label: 'Winter tuition', daysLeft: 5, status: 'DUE_SOON', completedAt: null })
  })

  it('lists soonest first, for the owner only', async () => {
    const mine = await signIn('mine@example.com')
    const theirs = await signIn('theirs@example.com')
    await add(mine, { label: 'later', kind: 'OTHER', dueOn: inDays(60) })
    await add(mine, { label: 'sooner', kind: 'OTHER', dueOn: inDays(2) })

    const ours = await request(app).get('/api/deadlines').set('Authorization', `Bearer ${mine}`)
    const others = await request(app).get('/api/deadlines').set('Authorization', `Bearer ${theirs}`)

    expect(ours.body.deadlines.map((deadline: { label: string }) => deadline.label)).toEqual(['sooner', 'later'])
    expect(others.body.deadlines).toHaveLength(0)
  })

  it('rejects a kind it does not know', async () => {
    const response = await add(await signIn(), { label: 'x', kind: 'BIRTHDAY', dueOn: inDays(3) })
    expect(response.status).toBe(400)
  })

  it('marks a deadline done and back again', async () => {
    const token = await signIn()
    const { body } = await add(token, { label: 'Tax filing', kind: 'TAX_FILING', dueOn: inDays(-3) })
    expect(body.status).toBe('OVERDUE')

    const done = await request(app).patch(`/api/deadlines/${body.id}`).set('Authorization', `Bearer ${token}`).send({ completed: true })
    expect(done.status).toBe(200)
    expect(done.body.status).toBe('DONE')
    expect(done.body.completedAt).not.toBeNull()

    const reopened = await request(app).patch(`/api/deadlines/${body.id}`).set('Authorization', `Bearer ${token}`).send({ completed: false })
    expect(reopened.body.status).toBe('OVERDUE')
    expect(reopened.body.completedAt).toBeNull()
  })

  it("will not complete or delete another student's deadline", async () => {
    const mine = await signIn('mine@example.com')
    const theirs = await signIn('theirs@example.com')
    const { body } = await add(mine, { label: 'Permit', kind: 'PERMIT_EXPIRY', dueOn: inDays(30) })

    const patch = await request(app).patch(`/api/deadlines/${body.id}`).set('Authorization', `Bearer ${theirs}`).send({ completed: true })
    const remove = await request(app).delete(`/api/deadlines/${body.id}`).set('Authorization', `Bearer ${theirs}`)

    expect(patch.status).toBe(404)
    expect(remove.status).toBe(404)
    expect(await db.deadline.count()).toBe(1)
  })

  // Prisma throws on an id that cannot be an ObjectId; unguarded, that becomes a 500.
  it('answers 404, not 500, for an id that is not an ObjectId', async () => {
    const token = await signIn()
    const patch = await request(app).patch('/api/deadlines/not-an-id').set('Authorization', `Bearer ${token}`).send({ completed: true })
    const remove = await request(app).delete('/api/deadlines/not-an-id').set('Authorization', `Bearer ${token}`)
    expect(patch.status).toBe(404)
    expect(remove.status).toBe(404)
  })

  it('deletes a deadline', async () => {
    const token = await signIn()
    const { body } = await add(token, { label: 'GIC', kind: 'GIC_RELEASE', dueOn: inDays(10) })
    const removed = await request(app).delete(`/api/deadlines/${body.id}`).set('Authorization', `Bearer ${token}`)
    expect(removed.status).toBe(204)
    expect(await db.deadline.count()).toBe(0)
  })
})
