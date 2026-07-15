-- Keep archive-restore GUCs scoped to the restore RPC, including failures.

create schema if not exists private;
revoke all on schema private from public;

create or replace function public.is_classroom_archive_maintenance_mode(p_mode text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('postgres', 'service_role', 'supabase_admin')
    and case p_mode
      when 'restore'
        then current_setting('pika.classroom_archive_restore', true) = 'on'
      when 'compaction'
        then current_setting('pika.classroom_archive_compaction', true) = 'on'
      else false
    end;
$$;
grant execute on function public.is_classroom_archive_maintenance_mode(text) to public;

create or replace function public.bump_classroom_blueprint_source_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_classroom_archive_maintenance_mode('restore') then
    return new;
  end if;
  if new.blueprint_source_revision = old.blueprint_source_revision then
    new.blueprint_source_revision := old.blueprint_source_revision + 1;
  end if;
  return new;
end;
$$;

create or replace function public.bump_classroom_archive_revision_from_classroom()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_classroom_archive_maintenance_mode('restore') then
    if tg_op = 'INSERT' then
      insert into public.classroom_archive_revisions (classroom_id, revision)
      values (
        new.id,
        current_setting('pika.classroom_archive_source_revision', true)::bigint
      )
      on conflict (classroom_id) do update
      set revision = excluded.revision, updated_at = now();
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into public.classroom_archive_revisions (classroom_id)
    values (new.id)
    on conflict (classroom_id) do nothing;
    return new;
  end if;
  if tg_op = 'DELETE' then
    delete from public.classroom_archive_revisions where classroom_id = old.id;
    return old;
  end if;
  update public.classroom_archive_revisions
  set revision = revision + 1, updated_at = now()
  where classroom_id = old.id;
  return new;
end;
$$;

create or replace function public.bump_classroom_archive_revision_from_resource()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent_table text := tg_argv[0];
  v_parent_column text := tg_argv[1];
  v_old_parent_id uuid;
  v_new_parent_id uuid;
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction')
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then
    v_old_parent_id := nullif(to_jsonb(old)->>v_parent_column, '')::uuid;
    v_old_classroom_id := public.resolve_classroom_archive_resource_classroom_id(
      v_parent_table, v_old_parent_id
    );
  end if;
  if tg_op <> 'DELETE' then
    v_new_parent_id := nullif(to_jsonb(new)->>v_parent_column, '')::uuid;
    v_new_classroom_id := public.resolve_classroom_archive_resource_classroom_id(
      v_parent_table, v_new_parent_id
    );
  end if;
  update public.classroom_archive_revisions
  set revision = revision + 1, updated_at = now()
  where classroom_id = v_old_classroom_id;
  if v_new_classroom_id is distinct from v_old_classroom_id then
    update public.classroom_archive_revisions
    set revision = revision + 1, updated_at = now()
    where classroom_id = v_new_classroom_id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.touch_classroom_blueprint_source_revision()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction')
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then v_old_classroom_id := old.classroom_id; end if;
  if tg_op <> 'DELETE' then v_new_classroom_id := new.classroom_id; end if;
  update public.classrooms
  set blueprint_source_revision = blueprint_source_revision + 1
  where id = v_old_classroom_id;
  if v_new_classroom_id is distinct from v_old_classroom_id then
    update public.classrooms
    set blueprint_source_revision = blueprint_source_revision + 1
    where id = v_new_classroom_id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.touch_classroom_blueprint_source_from_test_question()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction')
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then
    select classroom_id into v_old_classroom_id from public.tests where id = old.test_id;
  end if;
  if tg_op <> 'DELETE' then
    select classroom_id into v_new_classroom_id from public.tests where id = new.test_id;
  end if;
  update public.classrooms
  set blueprint_source_revision = blueprint_source_revision + 1
  where id = v_old_classroom_id;
  if v_new_classroom_id is distinct from v_old_classroom_id then
    update public.classrooms
    set blueprint_source_revision = blueprint_source_revision + 1
    where id = v_new_classroom_id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.touch_classroom_blueprint_source_from_requirement()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction')
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then
    select classroom_id into v_old_classroom_id
    from public.assignments where id = old.assignment_id;
  end if;
  if tg_op <> 'DELETE' then
    select classroom_id into v_new_classroom_id
    from public.assignments where id = new.assignment_id;
  end if;
  update public.classrooms
  set blueprint_source_revision = blueprint_source_revision + 1
  where id = v_old_classroom_id;
  if v_new_classroom_id is distinct from v_old_classroom_id then
    update public.classrooms
    set blueprint_source_revision = blueprint_source_revision + 1
    where id = v_new_classroom_id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

alter function public.complete_classroom_archive_restore(uuid, uuid, jsonb)
  set schema private;
revoke all on function private.complete_classroom_archive_restore(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.complete_classroom_archive_restore(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_verification jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prior_restore_mode text := current_setting('pika.classroom_archive_restore', true);
  v_prior_source_revision text := current_setting(
    'pika.classroom_archive_source_revision',
    true
  );
  v_result jsonb;
begin
  begin
    v_result := private.complete_classroom_archive_restore(
      p_operation_id,
      p_teacher_id,
      p_verification
    );
  exception when others then
    perform set_config(
      'pika.classroom_archive_restore',
      coalesce(v_prior_restore_mode, 'off'),
      true
    );
    perform set_config(
      'pika.classroom_archive_source_revision',
      coalesce(v_prior_source_revision, ''),
      true
    );
    raise;
  end;

  perform set_config(
    'pika.classroom_archive_restore',
    coalesce(v_prior_restore_mode, 'off'),
    true
  );
  perform set_config(
    'pika.classroom_archive_source_revision',
    coalesce(v_prior_source_revision, ''),
    true
  );
  return v_result;
end;
$$;

revoke all on function public.complete_classroom_archive_restore(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_classroom_archive_restore(uuid, uuid, jsonb)
  to service_role;
