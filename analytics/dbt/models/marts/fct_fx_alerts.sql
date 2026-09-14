-- Grain: one row per rate alert.
--
-- FundEd stores `triggeredAt` as the observation time of the rate that satisfied the alert, not
-- the moment the alert fired. ECB rates are stamped 15:00 UTC on their publication day, so an
-- alert created after that stamp, and already satisfied by that rate, fires on its first check
-- with a trigger time earlier than its own creation. The first run on real data found three.
-- `fired_at` is therefore the later of the two times, and `fired_on_first_check` marks the case.
select
    alert_id,
    user_id,
    currency_pair,
    direction,
    target_rate,
    created_at,
    created_at::date as created_date,
    triggered_at as trigger_rate_observed_at,
    case when has_fired then greatest(triggered_at, created_at) end as fired_at,
    case when has_fired then greatest(triggered_at, created_at)::date end as fired_date,
    has_fired,
    coalesce(has_fired and triggered_at < created_at, false) as fired_on_first_check,
    case
        when has_fired
            then round((extract(epoch from greatest(triggered_at, created_at) - created_at) / 86400)::numeric, 2)
    end as days_to_fire
from {{ ref('stg_fx_alerts') }}
