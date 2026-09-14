with typed as (
    select
        id as shift_id,
        doc ->> 'userId' as user_id,
        (doc ->> 'startedAt')::timestamptz as started_at,
        (doc ->> 'endedAt')::timestamptz as ended_at,
        (doc ->> 'onCampus')::boolean as on_campus,
        (doc ->> 'createdAt')::timestamptz as created_at
    from {{ source('raw', 'app_shifts') }}
)

select
    *,
    round((extract(epoch from ended_at - started_at) / 3600)::numeric, 2) as hours_worked
from typed
