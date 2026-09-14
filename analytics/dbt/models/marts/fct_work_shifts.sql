-- Grain: one row per work shift. A shift is counted in the week it starts, matching how the
-- app's own weekly cap is reported.
select
    shift_id,
    user_id,
    started_at,
    ended_at,
    started_at::date as shift_date,
    date_trunc('week', started_at)::date as week_start,
    on_campus,
    hours_worked
from {{ ref('stg_shifts') }}
