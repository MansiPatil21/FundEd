# ADR 0002: The optimiser is a separate Python service

**Status:** accepted · 2026-09-11

## Context

Remittance timing is a scheduling problem with a genuine optimum: choose transfer
dates and amounts to minimise fees plus exchange loss, subject to covering each
obligation on time and never dropping below a local cash buffer. Solving it by hand
or by heuristic leaves money on the table.

The rest of the product is a Node and Express API, and adding a second language and a
second deployment unit is a real cost that needs a real reason.

## Decision

A small FastAPI service in Python, running Google OR-Tools CP-SAT, called over HTTP
by the Node API.

## Consequences

**Why it is justified.** OR-Tools has no equivalent in the Node ecosystem. The
alternatives were a hand-rolled heuristic, which would be wrong in ways nobody could
prove, or a JavaScript LP library, none of which handle the integer variables this
model needs. A constraint solve is also CPU-bound work measured in seconds, which has
no business occupying an event loop whose entire job is I/O.

**Why it is not just microservices for their own sake.** The split follows a real
boundary: a different language, a different workload profile, and a different scaling
story. One is I/O-bound and scales with connections; the other is CPU-bound and scales
with cores.

**What it costs.** A second runtime, a second dependency tree, a second container, and
an HTTP hop on a path that used to be a function call. The Node side must handle the
optimiser being unavailable (NFR-5) and degrade rather than fail.

**Why CP-SAT rather than a linear-programming solver.** The model needs binary
variables: whether a transfer happens on a day at all, because the flat fee is charged
per transfer rather than per dollar. That makes it a mixed-integer program, not a
linear one. CP-SAT also takes only integer coefficients, which suits a domain where
money is already integer minor units, and removes a class of floating-point
disagreement between what the solver optimised and what the application reports.

**Rejected: solving it in the Node process with a heuristic.** Cheaper to build and
impossible to defend. "Send on the best rate in each month" is not optimal whenever a
flat fee makes bundling worthwhile, which is most of the time.
