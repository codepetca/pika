-- Keep Classroom and Blueprint purge finalization safe and recoverable.
-- Allow the durable hot-Classroom purge to remove Test questions after it has
-- fenced and snapshotted the whole Classroom. Normal Test edits remain frozen
-- once student work exists, and Blueprint deletion may still change provenance
-- only through its existing exact-column exception.

create or replace function public.lock_test_parent_for_child_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_classroom_ids uuid[];
  v_test_id uuid;
  v_test_ids uuid[];
begin
  if tg_op = 'DELETE' then
    v_test_id := old.test_id;
  else
    v_test_id := new.test_id;
  end if;

  -- Parent cascades already own the Test row and must remain recoverable.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  -- The owner-run Classroom finalizer already holds the Classroom lifecycle
  -- lock and verifies the snapshotted deletion membership. Its direct reverse-
  -- graph delete reaches questions before attempts, so permit that exact
  -- operation without weakening the student-work freeze for ordinary callers.
  if tg_op = 'DELETE'
    and current_user = 'postgres'
    and coalesce(
      current_setting('pika.classroom_purge_finalize', true),
      'off'
    ) = 'on'
  then
    return old;
  end if;

  -- Generated AI references are operational cache data, not authored Test
  -- content. They remain reusable after student work exists and do not belong
  -- in Blueprint revisions. Compare the complete records minus that explicit
  -- allowlist (and the automatic timestamp) so every current or future
  -- authored/identity field remains frozen by default.
  if tg_table_name = 'test_questions'
    and tg_op = 'UPDATE'
    and (
      to_jsonb(new) - array[
        'ai_reference_cache_key',
        'ai_reference_cache_answers',
        'ai_reference_cache_model',
        'ai_reference_cache_generated_at',
        'updated_at'
      ]::text[]
    ) is not distinct from (
      to_jsonb(old) - array[
        'ai_reference_cache_key',
        'ai_reference_cache_answers',
        'ai_reference_cache_model',
        'ai_reference_cache_generated_at',
        'updated_at'
      ]::text[]
    )
  then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.test_id is distinct from new.test_id then
    v_test_ids := array[old.test_id, new.test_id];
  else
    v_test_ids := array[v_test_id];
  end if;

  select array_agg(test.classroom_id order by test.classroom_id)
  into v_classroom_ids
  from public.tests test
  where test.id = any(v_test_ids);

  perform 1
  from public.classrooms classroom
  where classroom.id = any(v_classroom_ids)
  order by classroom.id
  for update;

  perform 1
  from public.tests test
  where test.id = any(v_test_ids)
  order by test.id
  for update;

  -- Blueprint capture records immutable Version membership on the source
  -- question; it does not change authored Test content or student work. Permit
  -- that provenance-only write after taking the normal parent locks, but only
  -- inside the owner-run identity-mapping or Blueprint-purge finalization
  -- routines. An API caller can set a custom GUC, so the owner check and the
  -- exact changed-column allowlist are both part of this trust boundary.
  if tg_table_name = 'test_questions'
    and tg_op = 'UPDATE'
    and current_user = 'postgres'
    and (
      coalesce(
        current_setting('pika.identity_mapping', true),
        'off'
      ) = 'on'
      or coalesce(
        current_setting('pika.course_blueprint_purge_finalize', true),
        'off'
      ) = 'on'
    )
    and (
      to_jsonb(new) - array[
        'source_blueprint_version_id',
        'updated_at'
      ]::text[]
    ) is not distinct from (
      to_jsonb(old) - array[
        'source_blueprint_version_id',
        'updated_at'
      ]::text[]
    )
  then
    return new;
  end if;

  if tg_table_name = 'test_questions'
    and exists (
      select 1
      from public.tests test
      where test.id = any(v_test_ids)
        and test.status in ('active', 'closed')
        and (
          exists (
            select 1
            from public.test_attempts attempt
            where attempt.test_id = test.id
          )
          or exists (
            select 1
            from public.test_responses response
            where response.test_id = test.id
          )
        )
    )
  then
    raise exception using
      errcode = '55000',
      message = 'test_questions_locked: Test questions cannot be changed after student work exists';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Deletion workflows can share lineage rows, but they must not start together.
-- Keep the established conflict matrices intact behind private implementations
-- and add the missing cross-purge ordering check at the public boundary.
alter function public.classroom_purge_conflict(uuid)
  rename to classroom_purge_conflict_pre_cross_purge_order;
alter function public.classroom_purge_conflict_pre_cross_purge_order(uuid)
  set schema private;

revoke all on function private.classroom_purge_conflict_pre_cross_purge_order(uuid)
  from public, anon, authenticated, service_role;

create function public.classroom_purge_conflict(p_classroom_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.course_blueprint_purge_fences blueprint_fence
    where blueprint_fence.course_blueprint_id in (
      select classroom.source_blueprint_id
      from public.classrooms classroom
      where classroom.id = p_classroom_id
      union
      select proposal.course_blueprint_id
      from public.course_blueprint_change_proposals proposal
      where proposal.source_classroom_id = p_classroom_id
         or proposal.target_classroom_id = p_classroom_id
      union
      select operation.source_blueprint_id
      from public.course_blueprint_operations operation
      where operation.source_classroom_id = p_classroom_id
         or operation.result_classroom_id = p_classroom_id
      union
      select operation.result_blueprint_id
      from public.course_blueprint_operations operation
      where operation.source_classroom_id = p_classroom_id
         or operation.result_classroom_id = p_classroom_id
      union
      select session.course_blueprint_id
      from public.course_blueprint_editing_sessions session
      where session.classroom_id = p_classroom_id
    )
  ) then
    return 'linked_course_blueprint_purge_active';
  end if;

  return private.classroom_purge_conflict_pre_cross_purge_order(p_classroom_id);
end;
$$;

revoke all on function public.classroom_purge_conflict(uuid)
  from public, anon, authenticated;
grant execute on function public.classroom_purge_conflict(uuid) to service_role;

alter function public.course_blueprint_purge_conflict(uuid)
  rename to course_blueprint_purge_conflict_pre_cross_purge_order;
alter function public.course_blueprint_purge_conflict_pre_cross_purge_order(uuid)
  set schema private;

revoke all on function private.course_blueprint_purge_conflict_pre_cross_purge_order(uuid)
  from public, anon, authenticated, service_role;

create function public.course_blueprint_purge_conflict(p_blueprint_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.classroom_purge_fences classroom_fence
    where classroom_fence.classroom_id in (
      select classroom.id
      from public.classrooms classroom
      where classroom.source_blueprint_id = p_blueprint_id
      union
      select proposal.source_classroom_id
      from public.course_blueprint_change_proposals proposal
      where proposal.course_blueprint_id = p_blueprint_id
      union
      select proposal.target_classroom_id
      from public.course_blueprint_change_proposals proposal
      where proposal.course_blueprint_id = p_blueprint_id
      union
      select operation.source_classroom_id
      from public.course_blueprint_operations operation
      where operation.source_blueprint_id = p_blueprint_id
         or operation.result_blueprint_id = p_blueprint_id
      union
      select operation.result_classroom_id
      from public.course_blueprint_operations operation
      where operation.source_blueprint_id = p_blueprint_id
         or operation.result_blueprint_id = p_blueprint_id
      union
      select session.classroom_id
      from public.course_blueprint_editing_sessions session
      where session.course_blueprint_id = p_blueprint_id
    )
  ) then
    return 'linked_classroom_purge_active';
  end if;

  return private.course_blueprint_purge_conflict_pre_cross_purge_order(
    p_blueprint_id
  );
end;
$$;

revoke all on function public.course_blueprint_purge_conflict(uuid)
  from public, anon, authenticated;
grant execute on function public.course_blueprint_purge_conflict(uuid)
  to service_role;

-- If a Blueprint purge raced with a Classroom purge before the ordering check
-- existed, let the Blueprint worker retain a retryable wait state instead of a
-- generic terminal failure.
create or replace function public.guard_classroom_purge_lifecycle(
  p_classroom_id uuid
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_classroom_id is null then return; end if;
  if not public.classroom_purge_try_lock(p_classroom_id) then
    raise exception using errcode = '40001', message = 'classroom_operation_busy';
  end if;
  if exists (
    select 1 from public.classroom_purge_fences
    where classroom_id = p_classroom_id
  ) then
    if coalesce(
      current_setting('pika.course_blueprint_purge_finalize', true),
      'off'
    ) = 'on' then
      raise exception using errcode = '40001',
        message = 'course_blueprint_purge_waiting_for_classroom_purge';
    end if;
    raise exception using errcode = '55000', message = 'classroom_purge_active';
  end if;
end;
$$;

-- A Classroom finalizer owns only Classroom lineage on shared Blueprint
-- workflow rows. Permit those exact detachments so a legacy interleaved pair
-- can drain in Classroom-then-Blueprint order.
create or replace function public.guard_course_blueprint_purge_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_blueprint_id uuid;
begin
  if current_setting('pika.course_blueprint_purge_finalize', true) = 'on'
  then return case when tg_op = 'DELETE' then old else new end; end if;

  if current_setting('pika.classroom_purge_finalize', true) = 'on' then
    if tg_table_name = 'course_blueprint_change_proposals'
      and (
        tg_op = 'DELETE'
        or (
          tg_op = 'UPDATE'
          and (
            to_jsonb(new) - array['source_classroom_id', 'updated_at']::text[]
          ) is not distinct from (
            to_jsonb(old) - array['source_classroom_id', 'updated_at']::text[]
          )
        )
      )
    then return case when tg_op = 'DELETE' then old else new end;
    elsif tg_table_name = 'course_blueprint_editing_sessions'
      and tg_op = 'UPDATE'
      and (to_jsonb(new) - 'classroom_id')
        is not distinct from (to_jsonb(old) - 'classroom_id')
    then return new;
    elsif tg_table_name = 'course_blueprint_operations'
      and tg_op = 'UPDATE'
      and (
        to_jsonb(new) - array[
          'source_classroom_id', 'result_classroom_id'
        ]::text[]
      ) is not distinct from (
        to_jsonb(old) - array[
          'source_classroom_id', 'result_classroom_id'
        ]::text[]
      )
    then return new;
    end if;
  end if;

  if tg_table_name = 'course_blueprints' then
    if tg_op = 'DELETE' and exists (
      select 1 from public.users
      where id = nullif(v_old->>'teacher_id', '')::uuid
    ) then
      raise exception using errcode = '55000',
        message = 'course_blueprint_purge_required';
    end if;
  end if;

  for v_blueprint_id in
    select distinct candidate
    from unnest(array[
      case when tg_table_name = 'course_blueprints'
        then nullif(v_old->>'id', '')::uuid
        else nullif(v_old->>'course_blueprint_id', '')::uuid end,
      case when tg_table_name = 'course_blueprints'
        then nullif(v_new->>'id', '')::uuid
        else nullif(v_new->>'course_blueprint_id', '')::uuid end,
      nullif(v_old->>'source_blueprint_id', '')::uuid,
      nullif(v_new->>'source_blueprint_id', '')::uuid,
      nullif(v_old->>'result_blueprint_id', '')::uuid,
      nullif(v_new->>'result_blueprint_id', '')::uuid
    ]) candidate
    where candidate is not null
  loop
    perform public.guard_course_blueprint_purge_lifecycle(v_blueprint_id);
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.guard_course_blueprint_version_lineage_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_blueprint_id uuid;
begin
  if current_setting('pika.course_blueprint_purge_finalize', true) = 'on'
  then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE'
    and current_setting('pika.classroom_purge_finalize', true) = 'on'
  then return old; end if;

  for v_blueprint_id in
    select distinct candidate from (
      select nullif(v_old->>'source_blueprint_id', '')::uuid candidate
      union all select nullif(v_new->>'source_blueprint_id', '')::uuid
      union all
      select version.course_blueprint_id
      from public.course_blueprint_versions version
      where version.id in (
        nullif(v_old->>'source_blueprint_version_id', '')::uuid,
        nullif(v_new->>'source_blueprint_version_id', '')::uuid
      )
    ) candidates where candidate is not null
  loop
    perform public.guard_course_blueprint_purge_lifecycle(v_blueprint_id);
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Recover only terminal generic failures that are demonstrably paired with a
-- still-active linked Classroom purge. Their fence and inventory stay intact;
-- the original idempotency key can resume after the Classroom finishes.
update public.course_blueprint_purge_operations operation
set retryable = true,
    error_code = 'course_blueprint_purge_waiting_for_classroom_purge',
    updated_at = clock_timestamp()
where operation.status = 'failed'
  and operation.retryable is false
  and operation.error_code = 'database_finalize_failed'
  and exists (
    select 1
    from public.classroom_purge_fences classroom_fence
    where classroom_fence.classroom_id in (
      select classroom.id
      from public.classrooms classroom
      where classroom.source_blueprint_id = operation.course_blueprint_id
      union
      select proposal.source_classroom_id
      from public.course_blueprint_change_proposals proposal
      where proposal.course_blueprint_id = operation.course_blueprint_id
      union
      select proposal.target_classroom_id
      from public.course_blueprint_change_proposals proposal
      where proposal.course_blueprint_id = operation.course_blueprint_id
    )
  );
