select
    id as obligation_id,
    doc ->> 'userId' as user_id,
    (doc ->> 'amountMinor')::bigint as amount_minor,
    doc ->> 'currency' as currency,
    doc ->> 'cadence' as cadence,
    (doc ->> 'nextDueOn')::timestamptz as next_due_on,
    (doc ->> 'createdAt')::timestamptz as created_at
from {{ source('raw', 'app_obligations') }}
