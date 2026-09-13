# FundEd optimiser

Remittance timing as a mixed-integer program, solved with OR-Tools CP-SAT.

## The question

A student owes fixed amounts back home on fixed dates. They can send on any day,
paying a flat fee plus a percentage, at whatever the rate is that day. Send early and
you pay today's rate and hold less cash; send late and you risk a worse one. Send
often and you multiply the flat fee. Most people decide this by feel.

## The model

For each period `t`: `x[t]` local minor units sent, `y[t]` whether a transfer happens.

```
minimise   sum_t  x[t] * (1 + variable_bps/10000)  +  fixed_fee * y[t]

subject to (1) cumulative home currency received by each due date covers
               cumulative obligations due by then
           (2) the running local balance never falls below the buffer
           (3) x[t] > 0 implies y[t] = 1, and x[t] >= the provider's floor
```

The exchange rate appears **only in constraint (1)**, never in the objective. Because
a better rate means a smaller `x` covers the same obligation, minimising local outlay
pushes transfers toward favourable days on its own. That is the part worth
understanding.

## Measured result

One academic year: 240 daily decision points, 8 monthly obligations of INR 25,000, a
fee of $4.99 plus 0.6%, a $500 minimum balance and a $100 provider floor.

| | Transfers | Fees | Total cost |
| --- | --- | --- | --- |
| Monthly baseline | 7 | $54.27 | $3,284.94 |
| Optimiser | 2 | $28.74 | $3,155.88 |

**$129.06 saved on that path, 3.9% of the baseline.**

One path proves nothing, so `/saving` resamples rate paths from historical daily log
returns and reports a bootstrap confidence interval on the paired difference:

```
60 feasible paths of 60
  mean saving   $101.58
  median        $94.90
  95% CI        $94.16 to $109.51
  significant   True   (the interval excludes zero)
```

## What this does not claim

**The optimiser sees the whole rate path in advance.** A real student does not. The
saving is therefore an **upper bound on what perfect timing is worth**, not a forecast
of user savings. It answers "how much is timing worth if you timed it perfectly",
which is the right first question and an honest one to bound.

The API returns that caveat in the response body rather than leaving it in the docs.

## Running it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest tests/ -q          # 23 tests
.venv/bin/uvicorn app.main:app --port 5050   # macOS reserves 5000 for AirPlay
```

## Endpoints

| | |
| --- | --- |
| `POST /plan` | the optimal schedule |
| `POST /baseline` | what fixed monthly transfers would cost |
| `POST /saving` | the difference, with a bootstrap confidence interval |
| `GET /health` | liveness |
