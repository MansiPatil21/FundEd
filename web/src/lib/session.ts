'use client'

import { clearToken, readToken } from './apollo'

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000'

export interface Permit {
  institution: string
  programEndsOn: string
  expiresOn: string
  weeklyHourCap: number
  permitNumber?: string | null
}

export interface Budget {
  monthlyIncomeMinor: number
  monthlySpendingMinor: number
  minimumBufferMinor: number
}

export interface Profile {
  id: string
  email: string
  displayName: string
  homeCurrency: string
  localCurrency: string
  permit: Permit | null
  budget: Budget | null
  onboarded: boolean
}

/** The session is gone or never existed. The caller sends the person to /login. */
export class UnauthorizedError extends Error {
  constructor() {
    super('Your session has ended. Sign in again.')
    this.name = 'UnauthorizedError'
  }
}

/** Any other failed request, carrying a message fit to show a person. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Every REST call goes through here, so token handling, JSON and error messages are
 * decided once rather than differently on each page.
 */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = readToken()
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    })
  } catch {
    // fetch rejects both for a network failure and for a CORS rejection, and JavaScript
    // cannot tell them apart. The old message confidently said the API was not running
    // when it was; this one does not claim to know which happened.
    throw new ApiError(0, 'Could not connect to FundEd. Check your connection and try again.')
  }

  if (response.status === 401) {
    clearToken()
    throw new UnauthorizedError()
  }
  if (response.status === 204) return undefined as T

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, messageFrom(body, response.status))
  return body as T
}

function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const record = body as { message?: unknown; issues?: Array<{ message?: unknown }> }
    if (typeof record.message === 'string') return record.message
    const first = record.issues?.[0]?.message
    if (typeof first === 'string') return first
  }
  return status >= 500
    ? 'Something went wrong on our side. Try again in a moment.'
    : `That request was not accepted (${status}).`
}

export function signOut(): void {
  clearToken()
  // A full navigation rather than router.push, so the Apollo cache and all in-memory state
  // from this session are discarded rather than merely hidden.
  window.location.assign('/login')
}
