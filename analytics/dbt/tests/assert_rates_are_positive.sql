select *
from {{ ref('stg_fx_rates') }}
where rate <= 0
