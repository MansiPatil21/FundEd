-- A continuous calendar covering every date any fact refers to, so weeks with no activity
-- still appear as zero rather than vanishing from a report.
with referenced as (
    select rate_date as day from {{ ref('stg_fx_rates') }}
    union all
    select created_at::date from {{ ref('stg_fx_alerts') }}
    union all
    select triggered_at::date from {{ ref('stg_fx_alerts') }} where triggered_at is not null
    union all
    select started_at::date from {{ ref('stg_shifts') }}
),

bounds as (
    select min(day) as first_day, max(day) as last_day from referenced
)

select
    day::date as date_day,
    date_trunc('week', day)::date as week_start,
    date_trunc('month', day)::date as month_start,
    extract(isodow from day)::int as iso_day_of_week,
    extract(isodow from day) in (6, 7) as is_weekend
from bounds
cross join lateral generate_series(bounds.first_day, bounds.last_day, interval '1 day') as day
