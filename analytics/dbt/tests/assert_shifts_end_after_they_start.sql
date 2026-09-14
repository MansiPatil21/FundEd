-- A shift ending before it starts would subtract hours from a student's weekly total and hide a
-- breach of their permit's cap.
select shift_id, started_at, ended_at
from {{ ref('stg_shifts') }}
where ended_at <= started_at
