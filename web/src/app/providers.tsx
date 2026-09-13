'use client'

import { useRef } from 'react'
import { Provider } from 'react-redux'
import { ApolloProvider } from '@apollo/client/react'
import { makeStore, type AppStore } from '@/store'
import { createApolloClient } from '@/lib/apollo'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000'

/**
 * Both clients are created once per browser session and held in a ref.
 *
 * Creating them during render would build a fresh store on every re-render and throw
 * away the wizard's state. Creating them at module scope would share one store
 * across every request on the server, which leaks one user's data into another's
 * render. A ref is the shape that is correct in both places.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const store = useRef<AppStore>(undefined)
  const client = useRef<ReturnType<typeof createApolloClient>>(undefined)

  store.current ??= makeStore()
  client.current ??= createApolloClient(API_BASE)

  return (
    <Provider store={store.current}>
      <ApolloProvider client={client.current}>{children}</ApolloProvider>
    </Provider>
  )
}
