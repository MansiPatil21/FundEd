with codes as (
    select base_currency as currency_code from {{ ref('stg_fx_rates') }}
    union
    select quote_currency from {{ ref('stg_fx_rates') }}
    union
    select home_currency from {{ ref('stg_users') }}
    union
    select local_currency from {{ ref('stg_users') }}
    union
    select currency from {{ ref('stg_obligations') }}
)

select
    currency_code,
    currency_code in (select quote_currency from {{ ref('stg_fx_rates') }}) as has_rates
from codes
where currency_code is not null
