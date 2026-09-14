import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing with scrypt, from Node's standard library.
 *
 * scrypt rather than a fast hash because it is deliberately expensive in both time and
 * memory, so a stolen table of hashes cannot be brute-forced on GPUs at billions of
 * guesses a second. It is on OWASP's recommended list, and using the built-in avoids a
 * native dependency (argon2, bcrypt) that complicates the Docker build.
 *
 * The stored string carries its own parameters, `scrypt$N$r$p$salt$key`, so the cost can
 * be raised later: old hashes still verify, and needsRehash tells sign-in to upgrade them.
 */

export interface ScryptParams {
  N: number
  r: number
  p: number
}

/** About 32 MB and tens of milliseconds per hash on a laptop. */
export const DEFAULT_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 1 }

const KEY_LENGTH = 64
const SALT_BYTES = 16

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // NFKC so the same password typed on two keyboards (composed vs decomposed accents)
    // produces the same key.
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { ...params, maxmem: 256 * params.N * params.r }, (error, key) =>
      error ? reject(error) : resolve(key),
    )
  })
}

export async function hashPassword(password: string, params: ScryptParams = DEFAULT_PARAMS): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await derive(password, salt, params)
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$')
}

interface ParsedHash {
  params: ScryptParams
  salt: Buffer
  key: Buffer
}

function parse(stored: string): ParsedHash | null {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const [N = 0, r = 0, p = 0] = parts.slice(1, 4).map(Number)
  if (![N, r, p].every((value) => Number.isInteger(value) && value > 0)) return null
  // Bounded so a corrupted or hostile row cannot make one sign-in allocate gigabytes.
  if ((N & (N - 1)) !== 0 || N > 2 ** 20 || r > 32 || p > 16) return null
  const salt = Buffer.from(parts[4]!, 'base64')
  const key = Buffer.from(parts[5]!, 'base64')
  if (salt.length === 0 || key.length !== KEY_LENGTH) return null
  return { params: { N, r, p }, salt, key }
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored)
  if (!parsed) return false
  const key = await derive(password, parsed.salt, parsed.params)
  // Constant-time comparison, so response timing does not reveal how many bytes matched.
  return timingSafeEqual(key, parsed.key)
}

export function needsRehash(stored: string, params: ScryptParams = DEFAULT_PARAMS): boolean {
  const parsed = parse(stored)
  return !parsed || parsed.params.N !== params.N || parsed.params.r !== params.r || parsed.params.p !== params.p
}

let dummyHash: Promise<string> | undefined

/**
 * Spends the same work as a real verification, for a sign-in with an unknown email.
 *
 * Without it, "no such account" answers in a millisecond and "wrong password" in tens of
 * milliseconds, and that difference tells an attacker which emails are registered.
 */
export async function burnVerification(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'))
  await verifyPassword(password, await dummyHash)
}

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

// The handful of passwords that appear at the top of every breach list. Following NIST
// SP 800-63B: a length floor and a blocklist, and no composition rules, which push people
// toward "Password1!" rather than toward anything stronger.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', '12345678', '123456789', '1234567890',
  '87654321', '11111111', '00000000', 'qwertyui', 'qwerty123', 'qwertyuiop', 'iloveyou', 'abc12345',
  'abcd1234', 'letmein1', 'welcome1', 'welcome123', 'admin123', 'sunshine', 'football', 'baseball',
  'princess', 'trustno1', 'superman', 'starwars', 'whatever', 'computer',
])

/** Why a password is not acceptable, in words fit to show a person, or null if it is. */
export function passwordProblem(password: string, email?: string): string | null {
  const length = [...password].length
  if (length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters`
  if (length > PASSWORD_MAX_LENGTH) return `Use ${PASSWORD_MAX_LENGTH} characters or fewer`
  if (password.trim() === '') return 'Use more than just spaces'
  const lowered = password.toLowerCase()
  if (COMMON_PASSWORDS.has(lowered)) return 'That password is too common. Choose another'
  if (email) {
    const address = email.trim().toLowerCase()
    if (lowered === address || lowered === address.split('@')[0]) return 'Do not use your email address as your password'
  }
  return null
}
