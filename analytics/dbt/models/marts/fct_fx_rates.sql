-- Grain: one row per currency pair per publication day, with the move from the previous
-- publication. "Previous" is the previous row, not the previous calendar day, because the ECB
-- does not publish on weekends.
select
    md5(rate_date::text || '|' || currency_pair) as fx_rate_key,
    rate_date,
    base_currency,
    quote_currency,
    currency_pair,
    rate,
    lag(rate) over pair_history as previous_rate,
    round(((rate / nullif(lag(rate) over pair_history, 0)) - 1) * 100, 4) as change_pct
from {{ ref('stg_fx_rates') }}
window pair_history as (partition by currency_pair order by rate_date)
