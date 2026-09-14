-- `triggered_at` keeps the app's meaning: when the rate that satisfied the alert was observed,
-- not when the alert fired. fct_fx_alerts derives the firing time. See its header.
select
    id as alert_id,
    doc ->> 'userId' as user_id,
    doc ->> 'baseCurrency' as base_currency,
    doc ->> 'quoteCurrency' as quote_currency,
    (doc ->> 'baseCurrency') || '/' || (doc ->> 'quoteCurrency') as currency_pair,
    (doc ->> 'targetRate')::numeric(20, 8) as target_rate,
    doc ->> 'direction' as direction,
    (doc ->> 'createdAt')::timestamptz as created_at,
    (doc ->> 'triggeredAt')::timestamptz as triggered_at,
    (doc ->> 'triggeredAt') is not null as has_fired,
    extracted_at
from {{ source('raw', 'app_fx_alerts') }}
