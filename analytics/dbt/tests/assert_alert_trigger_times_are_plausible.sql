-- `triggered_at` is the observation time of the rate that satisfied an alert (see fct_fx_alerts),
-- so it can precede the alert's creation, but only by the age of the newest published rate. The
-- ECB never goes more than four days without publishing, across a weekend plus a holiday, so an
-- older trigger means an alert was stamped with the wrong rate. A trigger later than the moment
-- the data was extracted is impossible.
select alert_id, created_at, triggered_at, extracted_at
from {{ ref('stg_fx_alerts') }}
where triggered_at < created_at - interval '5 days'
   or triggered_at > extracted_at
