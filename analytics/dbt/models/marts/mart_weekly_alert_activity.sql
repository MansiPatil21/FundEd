-- How rate alerts are used, week by week: created, fired, how many were already met when created,
-- and how long the rest took to fire.
with weeks as (
    select distinct week_start from {{ ref('dim_date') }}
),

created as (
    select date_trunc('week', created_at)::date as week_start, count(*) as alerts_created
    from {{ ref('fct_fx_alerts') }}
    group by 1
),

fired as (
    select
        date_trunc('week', fired_at)::date as week_start,
        count(*) as alerts_fired,
        count(*) filter (where fired_on_first_check) as alerts_fired_on_first_check,
        round(avg(days_to_fire), 2) as avg_days_to_fire
    from {{ ref('fct_fx_alerts') }}
    where has_fired
    group by 1
)

select
    weeks.week_start,
    coalesce(created.alerts_created, 0) as alerts_created,
    coalesce(fired.alerts_fired, 0) as alerts_fired,
    coalesce(fired.alerts_fired_on_first_check, 0) as alerts_fired_on_first_check,
    fired.avg_days_to_fire
from weeks
left join created on created.week_start = weeks.week_start
left join fired on fired.week_start = weeks.week_start
order by weeks.week_start
