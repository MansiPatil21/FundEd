# Northbound — requirements

A financial companion for international students in Canada.

## The problem

An international student manages money under constraints a domestic student does not
have. Their permit caps how much they may work. Their obligations are in one currency
and their costs in another. Sending money home at the wrong moment costs real money in
fees and exchange rate. Missing a tuition or permit date has consequences beyond a late
fee. No single tool holds all of this, so it lives in a spreadsheet or in someone's head.

## Functional requirements

**FR-1 Work-hour compliance.** Record shifts and report hours used per week against the
permit cap. On-campus hours are tracked but excluded from the cap.

**FR-2 Week attribution.** A shift crossing a week boundary counts toward both weeks,
split at the boundary. Attributing it wholly to its start week would let an overnight
Sunday shift escape the cap.

**FR-3 Pre-commitment check.** Before accepting a shift, answer whether it would breach
the cap in any week it touches.

**FR-4 Dual-currency budget.** Track local costs and home-currency obligations together.

**FR-5 Obligations.** Recurring commitments in the home currency with a cadence and a
next due date.

**FR-6 FX watch.** Record a target rate and direction; notify once when it is crossed.

**FR-7 Remittance optimisation.** Given obligations, fee structure, a rate forecast and a
minimum local balance, choose transfer dates and amounts minimising total cost.

**FR-8 Baseline comparison.** Every plan is scored against naive fixed monthly transfers,
and the difference is reported with a confidence interval rather than as a point estimate.

**FR-9 Deadlines.** Tuition, GIC release, permit expiry and tax filing dates, with reminders.

**FR-10 Cost-of-living comparison.** Public, per-city, server rendered.

**FR-11 Tax-slip checklist.** What is needed before filing, and what has arrived.

## Non-functional requirements

**NFR-1 Money is never a float.** All amounts are integer minor units with an explicit
currency. Rates are floats; amounts are not.

**NFR-2 Compliance answers are defensible.** The hour calculation must be reproducible
from the shift records, because a breach is a permit matter.

**NFR-3 External data is validated at the boundary.** Every third-party response is parsed
before use. An FX provider changing its shape must fail loudly, not silently corrupt a plan.

**NFR-4 The cache is never authoritative.** Rates are cached for speed; correctness must
not depend on cache state.

**NFR-5 Degrade rather than fail.** If the optimiser or the FX provider is unavailable,
the rest of the product still works and says what is missing.

## Out of scope

No connection to real bank accounts. No money actually moves. No tax advice: the checklist
lists documents, it does not compute a return. Immigration rules are encoded as a
configurable cap, not as legal guidance.
