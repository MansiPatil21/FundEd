import { z } from 'zod'

/**
 * Environment, parsed once at boot.
 *
 * Validating here rather than reading process.env at each use site means a missing
 * or malformed variable fails immediately with a readable message, instead of
 * surfacing as `undefined` somewhere deep in a request three hours later.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6380'),
  OPTIMIZER_URL: z.string().url().default('http://localhost:5000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
})

export type Env = z.infer<typeof schema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment:\n${detail}`)
  }
  return parsed.data
}
