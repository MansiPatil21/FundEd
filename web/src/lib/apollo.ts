'use client'

import { ApolloClient, HttpLink, InMemoryCache, from } from '@apollo/client'
import { setContext } from '@apollo/client/link/context'

/**
 * Apollo client for the dashboard query.
 *
 * The token is read per request rather than captured once, so a sign-in or a refresh
 * takes effect on the next query instead of requiring a page reload.
 */
export const TOKEN_KEY = 'funded.token'

export function readToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    // Storage can throw in a private window or with cookies blocked. Treat it as
    // signed out rather than crashing the app.
    return null
  }
}

export function writeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Nothing to do; the session simply will not survive a reload.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    // As above.
  }
}

export function createApolloClient(apiBase: string) {
  const auth = setContext((_operation, { headers }) => {
    const token = readToken()
    return { headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) } }
  })

  return new ApolloClient({
    link: from([auth, new HttpLink({ uri: `${apiBase}/graphql` })]),
    cache: new InMemoryCache(),
  })
}
