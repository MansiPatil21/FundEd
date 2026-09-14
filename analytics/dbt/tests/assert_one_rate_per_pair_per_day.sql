-- Two rates for one pair on one day would double-count every volatility and planning figure.
select currency_pair, rate_date, count(*) as rows_for_day
from {{ ref('stg_fx_rates') }}
group by currency_pair, rate_date
having count(*) > 1
