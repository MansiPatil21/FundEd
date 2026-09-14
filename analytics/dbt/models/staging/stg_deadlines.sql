select
    id as deadline_id,
    doc ->> 'userId' as user_id,
    doc ->> 'kind' as kind,
    (doc ->> 'dueOn')::timestamptz as due_on,
    (doc ->> 'completedAt')::timestamptz as completed_at,
    (doc ->> 'completedAt') is not null as is_completed
from {{ source('raw', 'app_deadlines') }}
