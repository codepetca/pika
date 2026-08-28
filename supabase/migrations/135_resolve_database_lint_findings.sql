-- Resolve the two error-level database lint findings present after migration 134.
--
-- The student-purge failure RPC had a real UPDATE ... FROM ambiguity because
-- both joined tables expose attempt_count. The archive export finding was a
-- plpgsql_check limitation: its transaction-local actor table is created before
-- use, and the database archive regression executes that path successfully.
-- Resolve the latter references dynamically after creation, explicitly through
-- pg_temp, so runtime behavior and actor-snapshot isolation remain unchanged.

CREATE OR REPLACE FUNCTION public.fail_student_purge_object(p_operation_id uuid, p_teacher_id uuid, p_object_id uuid, p_lease_token uuid, p_error_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_attempt integer;
begin
  update public.student_purge_objects object set status = 'failed', lease_token = null,
    lease_expires_at = null, last_error_code = left(coalesce(p_error_code, 'storage_delete_failed'), 200),
    next_attempt_at = clock_timestamp() + make_interval(secs => least(300, (2 ^ least(object.attempt_count, 8))::integer)),
    updated_at = clock_timestamp()
  from public.student_purge_operations operation
  where object.id = p_object_id and object.operation_id = p_operation_id
    and operation.id = object.operation_id and operation.teacher_id = p_teacher_id
    and object.status = 'processing' and object.lease_token = p_lease_token
  returning object.attempt_count into v_attempt;
  if not found then return jsonb_build_object('ok', false, 'status', 409,
    'error_code', 'student_purge_object_lease_lost', 'error', 'Storage deletion lease expired', 'retryable', true); end if;
  update public.student_purge_operations set status = 'failed', retryable = v_attempt < 12,
    error_code = 'student_purge_storage_delete_failed', updated_at = clock_timestamp()
  where id = p_operation_id;
  return jsonb_build_object('ok', true, 'status', 202, 'operation_id', p_operation_id,
    'operation_status', 'failed', 'retryable', v_attempt < 12);
end;
$function$;

CREATE OR REPLACE FUNCTION private.begin_classroom_archive_export_v082(p_operation_id uuid, p_teacher_id uuid, p_classroom_id uuid, p_request_sha256 text, p_source_schema_migration text, p_source_app_commit text, p_retention jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_operation public.classroom_archive_operations;
  v_resource record;
  v_actor_column text;
  v_actor_relation text;
  v_teacher_id uuid;
  v_archived_at timestamptz;
  v_revision bigint;
  v_counts jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_request_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid classroom archive request hash'
      using errcode = '22023';
  end if;
  if p_source_schema_migration !~ '^\d{3}(?:_[a-z0-9_]+)?$'
    or p_source_app_commit !~ '^[a-f0-9]{7,40}$'
  then
    raise exception 'Invalid classroom archive source version'
      using errcode = '22023';
  end if;
  if p_retention is null
    or jsonb_typeof(p_retention) <> 'object'
    or coalesce(p_retention->>'mode', '') not in ('teacher_managed', 'scheduled')
    or p_retention - 'mode' - 'delete_after' <> '{}'::jsonb
    or (
      p_retention->>'mode' = 'teacher_managed'
      and p_retention->'delete_after' is distinct from 'null'::jsonb
    )
    or (
      p_retention->>'mode' = 'scheduled'
      and (
        jsonb_typeof(p_retention->'delete_after') is distinct from 'string'
        or (p_retention->>'delete_after')::timestamptz <= v_now
      )
    )
  then
    raise exception 'Invalid classroom archive retention policy'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));

  select *
  into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;

  if found then
    if v_operation.teacher_id <> p_teacher_id
      or v_operation.classroom_id <> p_classroom_id
      or v_operation.operation_type <> 'export'
      or v_operation.request_sha256 <> p_request_sha256
    then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', 'idempotency_conflict',
        'error', 'Idempotency key was already used for a different archive request',
        'retryable', false
      );
    end if;

    if v_operation.status = 'completed' then
      return jsonb_build_object(
        'ok', true,
        'status', 200,
        'operation_id', p_operation_id,
        'archive_id', v_operation.archive_id,
        'operation_status', 'completed',
        'replayed', true,
        'snapshot_created_at', v_operation.snapshot_created_at,
        'snapshot_expires_at', v_operation.snapshot_expires_at,
        'source_revision', v_operation.source_revision,
        'resource_counts', v_operation.resource_counts,
        'storage_bucket', v_operation.storage_bucket,
        'storage_path', v_operation.storage_path,
        'artifact_sha256', v_operation.artifact_sha256,
        'content_sha256', v_operation.content_sha256,
        'compressed_byte_size', v_operation.compressed_byte_size,
        'uncompressed_byte_size', v_operation.uncompressed_byte_size,
        'storage_object_counts', v_operation.storage_object_counts,
        'verification', v_operation.verification
      );
    end if;

    if v_operation.status = 'failed' and v_operation.retryable is false then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', v_operation.error_code,
        'error', 'Archive operation failed and requires a new idempotency key',
        'retryable', false
      );
    end if;

    if v_operation.snapshot_expires_at > v_now
      and exists (
        select 1
        from public.classroom_archive_snapshot_resources
        where operation_id = p_operation_id
      )
    then
      update public.classroom_archive_operations
      set
        status = 'snapshot_ready',
        attempt_count = case
          when status = 'failed' then attempt_count + 1
          else attempt_count
        end,
        error_code = null,
        retryable = null,
        updated_at = v_now
      where id = p_operation_id
      returning * into v_operation;

      return jsonb_build_object(
        'ok', true,
        'status', 202,
        'operation_id', p_operation_id,
        'archive_id', p_operation_id,
        'operation_status', 'snapshot_ready',
        'replayed', true,
        'snapshot_created_at', v_operation.snapshot_created_at,
        'snapshot_expires_at', v_operation.snapshot_expires_at,
        'source_revision', v_operation.source_revision,
        'resource_counts', v_operation.resource_counts
      );
    end if;
  end if;

  select classroom.teacher_id, classroom.archived_at, revision.revision
  into v_teacher_id, v_archived_at, v_revision
  from public.classrooms classroom
  join public.classroom_archive_revisions revision
    on revision.classroom_id = classroom.id
  where classroom.id = p_classroom_id
  for share of revision;

  if v_teacher_id is null then
    return jsonb_build_object(
      'ok', false,
      'status', 404,
      'operation_id', p_operation_id,
      'error_code', 'classroom_not_found',
      'error', 'Classroom not found',
      'retryable', false
    );
  end if;
  if v_teacher_id <> p_teacher_id then
    return jsonb_build_object(
      'ok', false,
      'status', 403,
      'operation_id', p_operation_id,
      'error_code', 'classroom_forbidden',
      'error', 'Forbidden',
      'retryable', false
    );
  end if;
  if v_archived_at is null then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_not_archived',
      'error', 'Classroom must be archived before export',
      'retryable', false
    );
  end if;

  if v_operation.id is null then
    insert into public.classroom_archive_operations (
      id,
      teacher_id,
      classroom_id,
      operation_type,
      request_sha256,
      status,
      source_revision,
      source_schema_migration,
      source_app_commit,
      retention,
      archive_id,
      snapshot_created_at,
      snapshot_expires_at
    )
    values (
      p_operation_id,
      p_teacher_id,
      p_classroom_id,
      'export',
      p_request_sha256,
      'snapshot_ready',
      v_revision,
      p_source_schema_migration,
      p_source_app_commit,
      p_retention,
      p_operation_id,
      v_now,
      v_now + interval '24 hours'
    )
    on conflict (id) do nothing;

    select *
    into v_operation
    from public.classroom_archive_operations
    where id = p_operation_id
    for update;

    if v_operation.teacher_id <> p_teacher_id
      or v_operation.classroom_id <> p_classroom_id
      or v_operation.operation_type <> 'export'
      or v_operation.request_sha256 <> p_request_sha256
    then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', 'idempotency_conflict',
        'error', 'Idempotency key was already used for a different archive request',
        'retryable', false
      );
    end if;
  else
    delete from public.classroom_archive_snapshot_resources
    where operation_id = p_operation_id;
    delete from public.classroom_archive_snapshot_actors
    where operation_id = p_operation_id;

    update public.classroom_archive_operations
    set
      status = 'snapshot_ready',
      attempt_count = attempt_count + 1,
      source_revision = v_revision,
      source_schema_migration = p_source_schema_migration,
      source_app_commit = p_source_app_commit,
      retention = p_retention,
      resource_counts = '{}'::jsonb,
      storage_object_counts = '{}'::jsonb,
      storage_bucket = null,
      storage_path = null,
      artifact_sha256 = null,
      content_sha256 = null,
      compressed_byte_size = null,
      uncompressed_byte_size = null,
      verification = null,
      error_code = null,
      retryable = null,
      snapshot_created_at = v_now,
      snapshot_expires_at = v_now + interval '24 hours',
      completed_at = null,
      updated_at = v_now
    where id = p_operation_id
    returning * into v_operation;
  end if;

  insert into public.classroom_archive_snapshot_resources (
    operation_id,
    table_name,
    row_id
  )
  values (p_operation_id, 'classrooms', p_classroom_id);

  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column, parent_table, parent_column
    from public.classroom_archive_resource_contract
    where table_name <> 'classrooms'
    order by export_position
  loop
    execute format(
      'insert into public.classroom_archive_snapshot_resources (operation_id, table_name, row_id)
       select $1, $2, child.%I
       from public.%I child
       join public.classroom_archive_snapshot_resources parent
         on parent.operation_id = $1
        and parent.table_name = $3
        and child.%I = parent.row_id
       on conflict do nothing',
      v_resource.primary_key_column,
      v_resource.table_name,
      v_resource.parent_column
    )
    using p_operation_id, v_resource.table_name, v_resource.parent_table;
  end loop;

  create temporary table if not exists classroom_archive_actor_ids (
    actor_id uuid primary key
  ) on commit drop;
  -- plpgsql_check cannot model this function-local relation. Keep its safely
  -- formatted name runtime-bound so every reference resolves after creation.
  v_actor_relation := format('%I.%I', 'pg_temp', 'classroom_archive_actor_ids');
  execute 'truncate table ' || v_actor_relation;
  execute
    'insert into ' || v_actor_relation || ' (actor_id)
     values ($1)
     on conflict do nothing'
  using p_teacher_id;

  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column, actor_columns
    from public.classroom_archive_resource_contract
    where cardinality(actor_columns) > 0
    order by export_position
  loop
    foreach v_actor_column in array v_resource.actor_columns
    loop
      execute format(
        'insert into %s (actor_id)
         select distinct actor.id
         from public.classroom_archive_snapshot_resources snapshot
         join public.%I source on source.%I = snapshot.row_id
         join public.users actor on actor.id = source.%I
         where snapshot.operation_id = $1
           and snapshot.table_name = $2
         on conflict do nothing',
        v_actor_relation,
        v_resource.table_name,
        v_resource.primary_key_column,
        v_actor_column
      )
      using p_operation_id, v_resource.table_name;
    end loop;
  end loop;

  execute format($archive_actor_snapshot$
    insert into public.classroom_archive_snapshot_actors (
      operation_id,
      actor_id,
      snapshot
    )
    select
      $1,
      actor.id,
      jsonb_build_object(
        'id', actor.id,
        'email', actor.email,
        'role', actor.role,
        'profile', case
          when profile.id is null then null
          else jsonb_build_object(
            'id', profile.id,
            'user_id', profile.user_id,
            'student_number', profile.student_number,
            'first_name', profile.first_name,
            'last_name', profile.last_name,
            'created_at', profile.created_at
          )
        end
      )
    from %s selected_actor
    join public.users actor on actor.id = selected_actor.actor_id
    left join public.student_profiles profile on profile.user_id = actor.id
    order by actor.id
  $archive_actor_snapshot$, v_actor_relation)
  using p_operation_id;

  select jsonb_object_agg(
    contract.table_name,
    coalesce(resource_count.row_count, 0)
    order by contract.export_position
  )
  into v_counts
  from public.classroom_archive_resource_contract contract
  left join (
    select table_name, count(*)::integer as row_count
    from public.classroom_archive_snapshot_resources
    where operation_id = p_operation_id
    group by table_name
  ) resource_count on resource_count.table_name = contract.table_name;

  update public.classroom_archive_operations
  set resource_counts = v_counts, updated_at = clock_timestamp()
  where id = p_operation_id
  returning * into v_operation;

  return jsonb_build_object(
    'ok', true,
    'status', 202,
    'operation_id', p_operation_id,
    'archive_id', p_operation_id,
    'operation_status', 'snapshot_ready',
    'replayed', false,
    'snapshot_created_at', v_operation.snapshot_created_at,
    'snapshot_expires_at', v_operation.snapshot_expires_at,
    'source_revision', v_operation.source_revision,
    'resource_counts', v_operation.resource_counts
  );
end;
$function$;
