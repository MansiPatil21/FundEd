-- Off-campus hours per student per week against their permit's cap: the compliance question the
-- app answers for one student, asked across all of them.
select
    shifts.user_id,
    shifts.week_start,
    round(sum(case when not shifts.on_campus then shifts.hours_worked else 0 end), 2) as off_campus_hours,
    round(sum(case when shifts.on_campus then shifts.hours_worked else 0 end), 2) as on_campus_hours,
    users.weekly_hour_cap,
    coalesce(sum(case when not shifts.on_campus then shifts.hours_worked else 0 end) > users.weekly_hour_cap, false) as over_cap
from {{ ref('fct_work_shifts') }} as shifts
join {{ ref('stg_users') }} as users on users.user_id = shifts.user_id
group by shifts.user_id, shifts.week_start, users.weekly_hour_cap
