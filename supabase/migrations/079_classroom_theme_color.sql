alter table public.classrooms
  add column if not exists theme_color text;

with ordered_classrooms as (
  select
    id,
    row_number() over (
      partition by teacher_id
      order by position asc nulls last, updated_at desc nulls last, created_at asc, id asc
    ) as theme_position
  from public.classrooms
  where theme_color is null
)
update public.classrooms as classrooms
set theme_color = (
  array['blue', 'teal', 'green', 'amber', 'rose', 'violet', 'cyan', 'slate']
)[((ordered_classrooms.theme_position - 1) % 8) + 1]
from ordered_classrooms
where classrooms.id = ordered_classrooms.id;

alter table public.classrooms
  alter column theme_color set default 'blue',
  alter column theme_color set not null;

alter table public.classrooms
  drop constraint if exists classrooms_theme_color_check,
  add constraint classrooms_theme_color_check
    check (theme_color in ('blue', 'teal', 'green', 'amber', 'rose', 'violet', 'cyan', 'slate'));
