# ADR 0004: On MongoDB, "missing" and "null" are different, and Prisma preserves it

**Status:** accepted · 2026-09-11

## Context

`FxAlert.triggeredAt` is `DateTime?`. An alert that has not fired has no value there,
and the query for open alerts was the obvious one:

```ts
db.fxAlert.findMany({ where: { triggeredAt: null } })
```

It matched nothing. Every alert failed to fire, silently, with no error anywhere: the
webhook returned 202, the rate was stored, the notification never went out.

The cause is that Prisma's MongoDB connector does not write a field that was never
given a value, so the document has **no `triggeredAt` key at all**. That is not the
same as a key whose value is `null`, and a `null` filter matches only the latter.
Prisma exposes both through the same optional TypeScript type, so nothing in the
types hints at the distinction.

This is the second time the same family of difference has bitten this schema. ADR
0003 records the first: a nullable unique index behaving differently than on
PostgreSQL.

## Decision

Any query for "this optional field has no value" must cover both states:

```ts
const NOT_YET_TRIGGERED = [{ triggeredAt: null }, { triggeredAt: { isSet: false } }]
db.fxAlert.findMany({ where: { OR: NOT_YET_TRIGGERED } })
```

The constant is defined once and used by both the read and the conditional update
that claims an alert, so the two cannot drift.

## Consequences

**What this costs.** Every such query is noisier, and a reader who has not met the
problem will think the `OR` is redundant. The comment above the constant explains
why it is not, because the failure mode is invisible: the wrong version returns an
empty array rather than an error.

**The alternative considered.** Always writing an explicit `null` on create would
make the field present everywhere and let a plain `null` filter work. Rejected
because it only holds while every write path remembers to do it; one `create` that
omits the field silently reintroduces the bug, and nothing would fail until an alert
quietly did not fire.

**General rule for this schema.** An optional field on MongoDB has three states, not
two: present with a value, present and null, and absent. Treat the third as real.
