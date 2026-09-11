import type { Server as HttpServer } from 'node:http'
import { Server as SocketServer } from 'socket.io'
import type { Notifier } from '../fx/service.js'
import type { Trigger } from '../fx/alerts.js'
import type { TokenService } from '../auth/tokens.js'

/**
 * Socket.IO push for FX alerts.
 *
 * An alert is worth nothing an hour late, and polling for something that fires
 * perhaps twice a month is wasteful on a phone. This is the one part of the product
 * where a push genuinely beats a request.
 *
 * Each connection is authenticated during the handshake and joined to a room named
 * after the user. Emitting to a room rather than broadcasting means another user's
 * financial target never reaches the wrong socket, which a broadcast-and-filter
 * approach would leave to the client to get right.
 */

export interface RealtimeNotifier extends Notifier {
  close(): Promise<void>
  connectedSockets(): number
}

export function attachRealtime(
  server: HttpServer,
  tokens: TokenService,
  corsOrigin: string,
): RealtimeNotifier {
  const io = new SocketServer(server, {
    cors: { origin: corsOrigin, credentials: true },
  })

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
    if (typeof token !== 'string') {
      next(new Error('missing_token'))
      return
    }
    try {
      const claims = tokens.verify(token)
      socket.data.userId = claims.sub
      next()
    } catch {
      // Deliberately vague. A handshake is a fine place to enumerate valid tokens
      // if the server explains precisely what was wrong with each attempt.
      next(new Error('unauthorised'))
    }
  })

  io.on('connection', (socket) => {
    void socket.join(`user:${socket.data.userId}`)
  })

  return {
    alertTriggered(trigger: Trigger) {
      io.to(`user:${trigger.alert.userId}`).emit('fx:alert', {
        alertId: trigger.alert.id,
        pair: `${trigger.alert.baseCurrency}/${trigger.alert.quoteCurrency}`,
        targetRate: trigger.alert.targetRate,
        direction: trigger.alert.direction,
        rate: trigger.rate,
        observedAt: trigger.observedAt.toISOString(),
      })
    },

    connectedSockets() {
      return io.sockets.sockets.size
    },

    async close() {
      await io.close()
    },
  }
}

/** Used where no socket server exists, such as in tests and the job worker. */
export function silentNotifier(): Notifier {
  return { alertTriggered() {} }
}
