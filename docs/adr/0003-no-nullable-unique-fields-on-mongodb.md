# ADR 0003: No nullable unique fields on MongoDB

**Status:** accepted · 2026-09-11

## Context

`User.googleId` began life as `String? @unique`, expressing what looks like an
obvious rule: a Google account may be linked to at most one user, and most users have
not linked one.

On PostgreSQL that works. Every `NULL` is distinct from every other `NULL`, so a
unique index permits any number of rows without a value.

MongoDB does not behave that way. A unique index treats a missing field as `null` and
counts nulls toward uniqueness, so the index permits exactly **one** document without
a `googleId`. The first local sign-up succeeded and the second failed with Prisma
`P2002`.

The failure surfaced as an integration test seeing `401` where it expected `404`: the
second sign-in never returned a token, so the subsequent request was unauthenticated.
The stated error was three steps away from the cause, which is the part worth
remembering.

## Decision

No nullable unique fields on this schema. `googleId` keeps its index off, and the
"one Google account, one user" rule is enforced in the code path that links an
account rather than by the database.

## Consequences

**What this costs.** A rule that used to be guaranteed by the storage engine is now
guaranteed by application code, which can be bypassed by a bug or by a direct write.
That is a genuine downgrade and is recorded here rather than glossed over.

**Why not a sparse or partial index.** MongoDB does support one, and it is the right
tool: `{ googleId: 1 }, { unique: true, sparse: true }`. Prisma's MongoDB connector
does not express sparse indexes in the schema, so it would have to be created out of
band by a migration script that Prisma neither manages nor validates. A rule enforced
by an index Prisma does not know about is worse than one enforced in code where a
reader can see it.

**Wider rule.** Any future optional identifier on this schema gets the same treatment.
The general lesson is that `@unique` on an optional field means different things on
different databases, and the ORM makes them look identical.
