'use client'

import { useEffect, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { readToken } from './apollo'

export interface LiveAlert {
  alertId: string
  pair: string
  targetRate: number
  direction: string
  rate: number
  observedAt: string
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000'

/**
 * Subscribes to alerts pushed over the socket.
 *
 * The socket is opened in an effect and closed on unmount. Without the cleanup, a
 * navigation away and back would leave the previous connection open and every alert
 * would arrive twice, then three times.
 */
export function useFxAlerts(): LiveAlert[] {
  const [alerts, setAlerts] = useState<LiveAlert[]>([])

  useEffect(() => {
    const token = readToken()
    if (!token) return

    // An empty API base means same origin, as behind the compose Nginx.
    const socket: Socket = io(API_BASE || window.location.origin, {
      auth: { token },
      transports: ['websocket'],
      // A failed handshake means the token is stale; retrying forever would hammer
      // the server for a condition that will not fix itself.
      reconnectionAttempts: 3,
    })

    socket.on('fx:alert', (alert: LiveAlert) => {
      setAlerts((current) => [alert, ...current].slice(0, 5))
    })

    return () => {
      socket.close()
    }
  }, [])

  return alerts
}
