# ADR 0001: MongoDB with Prisma, not PostgreSQL

**Status:** accepted · 2026-09-11

## Context

The previous project in this portfolio (CoreBank) uses PostgreSQL with Hibernate, and
that was the right call there: a double-entry ledger is relational by nature and needs
transactional guarantees across rows.

This product's shape is different. A student's financial profile nests deeply and varies
by origin: the obligations a student from India carries home are structured differently
from one from Nigeria or Brazil, institutions express fee schedules differently, and the
set of tax documents differs by province and employment type.

## Decision

MongoDB as the primary store, with Prisma as the ORM.

## Consequences

**What this buys.** Documents that vary in shape without a migration per variant, and
embedded types (`StudyPermit`, `PlannedTransfer`) that are always read with their parent
and have no independent identity. Prisma gives back the type safety that dropping a
relational schema would otherwise cost: the client is generated from the schema, so a
model change becomes a compile error rather than a runtime surprise.

**What it costs.** No foreign keys enforced by the database. Referential integrity is the
application's job, which is a real risk worth naming rather than hiding. Prisma on MongoDB
also requires a replica set for transactions, so even local development runs a single-node
replica set rather than a plain `mongod`.

**Rejected: PostgreSQL.** It would model the fixed parts well and the variable parts as
JSONB, which is the worst of both: relational ceremony plus unvalidated blobs.

**Rejected: Mongoose.** Schema-in-JavaScript with types layered on afterwards, rather than
types generated from one declared schema. Prisma also closes a real gap in the author's
experience, which is a secondary but honest reason.
