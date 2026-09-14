select
    id as user_id,
    doc ->> 'homeCurrency' as home_currency,
    doc ->> 'localCurrency' as local_currency,
    (doc ->> 'weeklyHourCap')::int as weekly_hour_cap,
    (doc ->> 'createdAt')::timestamptz as created_at,
    (doc ->> 'onboardedAt')::timestamptz as onboarded_at,
    (doc ->> 'onboardedAt') is not null as is_onboarded,
    extracted_at
from {{ source('raw', 'app_users') }}
