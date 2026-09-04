-- Teacher-entered Gradebook marks that take precedence over calculated scores.

create table public.gradebook_score_overrides (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  assessment_type text not null check (assessment_type in ('assignment', 'test', 'final')),
  assessment_id uuid not null,
  earned numeric(8,1) not null check (earned >= 0),
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (classroom_id, student_id, assessment_type, assessment_id),
  check (assessment_type <> 'final' or assessment_id = classroom_id),
  foreign key (classroom_id, student_id)
    references public.classroom_enrollments (classroom_id, student_id)
    on delete no action
    deferrable initially deferred
);

create index idx_gradebook_score_overrides_student
  on public.gradebook_score_overrides (student_id);

create or replace function public.update_gradebook_score_overrides_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger update_gradebook_score_overrides_updated_at
  before update on public.gradebook_score_overrides
  for each row execute function public.update_gradebook_score_overrides_updated_at();

-- Score overrides are portable classroom state. Add them after enrollments so
-- their deferred enrollment reference is also satisfied by ordinary restores.
do $$
declare
  v_position integer;
begin
  select export_position into strict v_position
  from public.classroom_archive_resource_contract_versions
  where format_version = 2 and table_name = 'classroom_enrollments';

  update public.classroom_archive_resource_contract_versions
  set export_position = export_position + 1000
  where format_version = 2 and export_position > v_position;

  update public.classroom_archive_resource_contract_versions
  set export_position = export_position - 999
  where format_version = 2 and export_position > v_position + 1000;

  insert into public.classroom_archive_resource_contract_versions (
    format_version,
    table_name,
    primary_key_columns,
    parent_table,
    parent_column,
    actor_columns,
    restore_after,
    export_position
  ) values (
    2,
    'gradebook_score_overrides',
    array['id'],
    'classrooms',
    'classroom_id',
    array['student_id', 'created_by'],
    array['classrooms', 'classroom_enrollments'],
    v_position + 1
  );
end;
$$;

do $$
declare
  v_position integer;
begin
  select export_position into strict v_position
  from public.classroom_archive_resource_contract
  where table_name = 'classroom_enrollments';

  update public.classroom_archive_resource_contract
  set export_position = export_position + 1000
  where export_position > v_position;

  update public.classroom_archive_resource_contract
  set export_position = export_position - 999
  where export_position > v_position + 1000;

  insert into public.classroom_archive_resource_contract (
    table_name,
    primary_key_columns,
    parent_table,
    parent_column,
    actor_columns,
    restore_after,
    export_position
  ) values (
    'gradebook_score_overrides',
    array['id'],
    'classrooms',
    'classroom_id',
    array['student_id', 'created_by'],
    array['classrooms', 'classroom_enrollments'],
    v_position + 1
  );
end;
$$;

create trigger car_gradebook_score_overrides
  before insert or delete or update on public.gradebook_score_overrides
  for each row execute function public.bump_classroom_archive_revision_from_resource(
    'classrooms',
    'classroom_id'
  );

create trigger classroom_purge_fence_gradebook_score_overrides
  before insert or delete or update on public.gradebook_score_overrides
  for each row execute function public.reject_classroom_resource_change_during_purge(
    'classrooms',
    'classroom_id'
  );

-- Add score rows to the exact student-purge inventory. The existing finalizer
-- deletes staged resources by their stable UUID id and includes them in impact counts.
alter function public.student_purge_inventory_resources(uuid, uuid)
  rename to student_purge_inventory_resources_without_gradebook_overrides_v157;

revoke all on function public.student_purge_inventory_resources_without_gradebook_overrides_v157(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.student_purge_inventory_resources(
  p_classroom_id uuid,
  p_student_id uuid
)
returns table(table_name text, row_id uuid, disposition text)
language sql
stable
set search_path = ''
as $$
  select *
  from public.student_purge_inventory_resources_without_gradebook_overrides_v157(
    p_classroom_id,
    p_student_id
  )
  union all
  select 'gradebook_score_overrides', override.id, 'delete'
  from public.gradebook_score_overrides as override
  where override.classroom_id = p_classroom_id
    and override.student_id = p_student_id
$$;

revoke all on function public.student_purge_inventory_resources(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Direct writes for the target pair cannot race an active student purge.
create function public.reject_gradebook_override_change_during_student_purge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.gradebook_score_overrides;
begin
  if current_setting('pika.student_purge_finalize', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' and (
    new.classroom_id is distinct from old.classroom_id
    or new.student_id is distinct from old.student_id
    or new.assessment_type is distinct from old.assessment_type
    or new.assessment_id is distinct from old.assessment_id
  ) then
    raise exception using errcode = '55000', message = 'gradebook_override_identity_immutable';
  end if;

  v_row := case when tg_op = 'DELETE' then old else new end;
  perform public.student_purge_lock(v_row.classroom_id, v_row.student_id);
  if exists (
    select 1
    from public.student_purge_fences as fence
    where fence.classroom_id = v_row.classroom_id
      and fence.student_id = v_row.student_id
  ) then
    raise exception using errcode = '55000', message = 'student_purge_active';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger student_purge_guard_gradebook_score_overrides
  before insert or update or delete on public.gradebook_score_overrides
  for each row execute function public.reject_gradebook_override_change_during_student_purge();

revoke all on function public.reject_gradebook_override_change_during_student_purge()
  from public, anon, authenticated, service_role;

-- Ordinary roster removal also deletes these grades atomically. The deferred
-- enrollment reference prevents a late save from recreating a removed student's row.
alter function public.remove_classroom_roster_entries_atomic(uuid, uuid[])
  rename to remove_classroom_roster_entries_without_gradebook_overrides_v157;

revoke all on function public.remove_classroom_roster_entries_without_gradebook_overrides_v157(uuid, uuid[])
  from public, anon, authenticated, service_role;

create function public.remove_classroom_roster_entries_atomic(
  p_classroom_id uuid,
  p_roster_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_ids uuid[] := array[]::uuid[];
  v_result jsonb;
  v_deleted_overrides integer := 0;
begin
  perform 1
  from public.classrooms as classroom
  where classroom.id = p_classroom_id
  for update;

  with requested as (
    select distinct roster_id
    from unnest(coalesce(p_roster_ids, array[]::uuid[])) as requested(roster_id)
  ),
  target_roster as materialized (
    select roster.id, roster.email
    from public.classroom_roster as roster
    join requested on requested.roster_id = roster.id
    where roster.classroom_id = p_classroom_id
    for update of roster
  )
  select coalesce(array_agg(coalesce(binding.student_id, student.id)) filter (
    where coalesce(binding.student_id, student.id) is not null
  ), array[]::uuid[])
  into v_student_ids
  from target_roster as roster
  left join public.classroom_roster_student_bindings as binding
    on binding.roster_id = roster.id
  left join public.users as student
    on lower(btrim(student.email)) = lower(btrim(roster.email))
    and student.role = 'student';

  v_result := public.remove_classroom_roster_entries_without_gradebook_overrides_v157(
    p_classroom_id,
    p_roster_ids
  );

  if coalesce(array_length(v_student_ids, 1), 0) > 0 then
    delete from public.gradebook_score_overrides
    where classroom_id = p_classroom_id
      and student_id = any(v_student_ids);
    get diagnostics v_deleted_overrides = row_count;
  end if;

  return v_result || jsonb_build_object(
    'deleted_gradebook_score_overrides',
    v_deleted_overrides
  );
end;
$$;

revoke all on function public.remove_classroom_roster_entries_atomic(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.remove_classroom_roster_entries_atomic(uuid, uuid[])
  to service_role;

alter table public.gradebook_score_overrides enable row level security;

create policy "No direct access to gradebook_score_overrides"
  on public.gradebook_score_overrides
  for all
  using (false)
  with check (false);

revoke all on table public.gradebook_score_overrides from anon, authenticated;

comment on table public.gradebook_score_overrides is
  'Teacher-entered assessment and Final marks that override calculated Gradebook scores.';
