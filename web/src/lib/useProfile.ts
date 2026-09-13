'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { readToken } from './apollo'
import { api, UnauthorizedError, type Profile } from './session'

type State =
  | { status: 'loading' }
  | { status: 'ready'; profile: Profile }
  | { status: 'error'; message: string }

/**
 * Loads the signed-in student's profile and enforces where they may be.
 *
 * No token goes to /login. A page that needs finished setup sends an unfinished account
 * to /onboarding. Both rules live here, so no page can forget one of them.
 */
export function useRequireProfile({ requireOnboarded }: { requireOnboarded: boolean }) {
  const router = useRouter()
  const [state, setState] = useState<State>({ status: 'loading' })

  const load = useCallback(async () => {
    if (!readToken()) {
      router.replace('/login')
      return
    }
    setState({ status: 'loading' })
    try {
      const profile = await api<Profile>('/api/me')
      if (requireOnboarded && !profile.onboarded) {
        router.replace('/onboarding')
        return
      }
      setState({ status: 'ready', profile })
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        router.replace('/login')
        return
      }
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' })
    }
  }, [requireOnboarded, router])

  useEffect(() => {
    void load()
  }, [load])

  const setProfile = useCallback((profile: Profile) => setState({ status: 'ready', profile }), [])

  return { state, reload: load, setProfile }
}
