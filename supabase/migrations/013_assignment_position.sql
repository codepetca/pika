-- Add explicit ordering for assignments (teacher-controlled per classroom)

alter table public.assignments
add column if not exists position integer not null default 0;

-- Backfill positions based on creation time within each classroom.
with ranked as (
  select
    id,
    row_number() over (partition by classroom_id order by created_at asc, id asc) - 1 as new_position
  from public.assignments
)
update public.assignments a
set position = r.new_position
from ranked r
where a.id = r.id;

create index if not exists assignments_classroom_position_idx
on public.assignments (classroom_id, position);

