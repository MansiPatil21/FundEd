-- Monthly movement per currency pair: the context a student needs before timing a transfer.
select
    currency_pair,
    date_trunc('month', rate_date)::date as month_start,
    count(*) as publication_days,
    min(rate) as lowest_rate,
    max(rate) as highest_rate,
    round(((max(rate) / nullif(min(rate), 0)) - 1) * 100, 4) as range_pct,
    round(stddev_samp(change_pct), 4) as daily_change_stddev_pct
from {{ ref('fct_fx_rates') }}
group by 1, 2
