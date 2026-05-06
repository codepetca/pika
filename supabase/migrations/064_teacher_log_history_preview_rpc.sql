create or replace function public.get_teacher_log_history_preview(
  p_classroom_id uuid,
  p_student_ids uuid[],
  p_limit integer default 5
)
returns table (
  id uuid,
  student_id uuid,
  classroom_id uuid,
  date date,
  text text,
  rich_content jsonb,
  version integer,
  minutes_reported integer,
  mood text,
  created_at timestamptz,
  updated_at timestamptz,
  on_time boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    entry.id,
    entry.student_id,
    entry.classroom_id,
    entry.date,
    entry.text,
    entry.rich_content,
    entry.version,
    entry.minutes_reported,
    entry.mood,
    entry.created_at,
    entry.updated_at,
    entry.on_time
  from unnest(coalesce(p_student_ids, array[]::uuid[])) as requested(student_id)
  cross join lateral (
    select
      entries.id,
      entries.student_id,
      entries.classroom_id,
      entries.date,
      entries.text,
      entries.rich_content,
      entries.version,
      entries.minutes_reported,
      entries.mood,
      entries.created_at,
      entries.updated_at,
      entries.on_time
    from public.entries
    where entries.classroom_id = p_classroom_id
      and entries.student_id = requested.student_id
    order by entries.date desc, entries.updated_at desc
    limit greatest(0, least(coalesce(p_limit, 5), 50))
  ) as entry
  order by requested.student_id, entry.date desc, entry.updated_at desc;
$$;

revoke all on function public.get_teacher_log_history_preview(uuid, uuid[], integer) from public;
revoke all on function public.get_teacher_log_history_preview(uuid, uuid[], integer) from anon, authenticated;
grant execute on function public.get_teacher_log_history_preview(uuid, uuid[], integer) to service_role;
