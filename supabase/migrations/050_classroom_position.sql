alter table public.classrooms
add column if not exists position integer not null default 0;

with ranked_classrooms as (
  select
    id,
    row_number() over (
      partition by teacher_id
      order by updated_at desc, created_at desc, id asc
    ) - 1 as new_position
  from public.classrooms
  where archived_at is null
)
update public.classrooms as classrooms
set position = ranked_classrooms.new_position
from ranked_classrooms
where classrooms.id = ranked_classrooms.id;

create index if not exists classrooms_teacher_position_idx
on public.classrooms (teacher_id, position);
