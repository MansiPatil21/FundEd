/**
 * The password rules, mirrored from the API's src/auth/passwords.ts so the form can say
 * what is wrong as the student types. The API checks again and is the one that decides.
 */

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', '12345678', '123456789', '1234567890',
  '87654321', '11111111', '00000000', 'qwertyui', 'qwerty123', 'qwertyuiop', 'iloveyou', 'abc12345',
  'abcd1234', 'letmein1', 'welcome1', 'welcome123', 'admin123', 'sunshine', 'football', 'baseball',
  'princess', 'trustno1', 'superman', 'starwars', 'whatever', 'computer',
])

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
