select
    rate_date,
    base_currency::text as base_currency,
    quote_currency::text as quote_currency,
    base_currency || '/' || quote_currency as currency_pair,
    rate,
    loaded_at
from {{ source('raw', 'fx_rates') }}
