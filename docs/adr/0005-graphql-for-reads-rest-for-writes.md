# ADR 0005: GraphQL for reads, REST for writes

**Status:** accepted · 2026-09-11

## Context

The dashboard needs the student's compliance status, their obligations, their open
alerts and the current exchange rate, all at once, usually on a phone connection.
Over REST that is four requests and four sets of latency, and the client cannot say
"only the current week" without another endpoint existing for it.

Meanwhile the write side is small and unambiguous: add a shift, add an obligation,
create an alert. Each has one shape, one validation, and one status code worth
distinguishing.

## Decision

Reads go through a single GraphQL query at `/graphql`. Writes stay on REST.

## Consequences

**Why not GraphQL for everything.** Mutations would buy nothing here. A `POST
/api/shifts` returning 201 with a Location is clearer than a mutation returning a
payload wrapper, and the HTTP status codes already carry meaning the client acts on:
401 to refresh a token, 409 on a conflict, 422 on something unsolvable. Pushing all
of that into a single 200 with an `errors` array is a downgrade.

**Why not REST for everything.** A `GET /api/dashboard` returning everything would
work, and would fetch the obligations collection and the rate cache even when the
client only wanted the week's hours. The resolvers are independently lazy, so a
narrow query does strictly less work. There is a test asserting exactly that.

**The cost is a real seam.** Two conventions in one API is a thing a new contributor
has to learn, and the boundary has to stay legible: if reads start mutating or
writes start returning graphs, the split has failed. It is documented here so the
rule is explicit rather than folklore.

**Authentication resolves into context, not middleware.** A GraphQL request is one
HTTP call that may touch several resources, so rejecting at the transport would be
all-or-nothing. Identity is resolved per request into the context and each resolver
decides, which is why an expired token produces a typed `UNAUTHENTICATED` error the
client can act on rather than a bare 401 it has to guess about.

**Introspection is off in production.** The schema is a map of everything the API can
do and there is no reason to publish it.
