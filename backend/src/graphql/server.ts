import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@as-integrations/express5'
import type { Express } from 'express'
import { typeDefs } from './schema.js'
import { resolvers, type GraphContext } from './resolvers.js'
import type { TokenService } from '../auth/tokens.js'

export interface GraphDeps extends Omit<GraphContext, 'userId'> {
  tokens: TokenService
  introspection: boolean
}

/**
 * Mounts /graphql.
 *
 * Authentication is resolved per request into the context rather than guarded by
 * middleware, because a GraphQL request is one HTTP call that may touch several
 * resources. Rejecting at the transport would be all-or-nothing; resolving identity
 * into context lets each resolver decide, and makes an unauthenticated query fail
 * with a typed UNAUTHENTICATED error rather than a bare 401 the client cannot read.
 */
export async function attachGraphql(
  app: Express,
  deps: GraphDeps,
): Promise<ApolloServer<GraphContext>> {
  const server = new ApolloServer<GraphContext>({
    typeDefs,
    resolvers,
    // Off in production: the schema is a map of everything the API can do, and
    // there is no reason to publish it to anyone who asks.
    introspection: deps.introspection,
  })

  await server.start()

  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: async ({ req }) => {
        const header = req.header('authorization')
        let userId: string | null = null

        if (header?.startsWith('Bearer ')) {
          try {
            userId = deps.tokens.verify(header.slice('Bearer '.length).trim()).sub
          } catch {
            // Left null. An expired token is not a transport failure; the query
            // fails with UNAUTHENTICATED, which a client can act on by refreshing.
          }
        }

        return {
          userId,
          db: deps.db,
          shifts: deps.shifts,
          obligations: deps.obligations,
          fx: deps.fx,
        }
      },
    }),
  )

  return server
}
