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
  // 5050 locally because macOS reserves port 5000 for AirPlay Receiver. In compose the
  // service is reached by name on its own network, so this default is not used there.
  OPTIMIZER_URL: z.string().url().default('http://localhost:5050'),
  // Required only when the optimiser is deployed with a key, as on Azure Container Apps.
  OPTIMIZER_API_KEY: z.string().min(16).optional(),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // No default. A signing secret that falls back to a known string is worse than
  // one that is missing, because the missing one fails loudly at boot.
  JWT_SECRET: z.string().min(24),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  FX_WEBHOOK_SECRET: z.string().min(16),
  // Scheduled rate polling. Off unless asked for, so tests and a bare checkout never make
  // outbound calls.
  FX_POLL_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  FX_PAIRS: z.string().default('CAD:INR'),
  FX_POLL_EVERY_MINUTES: z.coerce.number().int().min(1).default(360),
  FX_SOURCE_URL: z.string().url().default('https://api.frankfurter.dev/v1'),
  // Email-only sign-in is for development and is refused in production unless explicitly
  // allowed. The switch exists so the production images can be run locally; never set it on a
  // deployment reachable from the internet.
  ALLOW_LOCAL_SIGN_IN: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
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
