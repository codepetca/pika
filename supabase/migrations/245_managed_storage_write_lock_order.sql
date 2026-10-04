-- Existing identities: protocol -> managed UUIDs (ascending) -> exact paths.
-- Absent identities: take the path, then only perform a nonlocking existence
-- recheck. A newly committed identity requires a transaction retry; never take
-- its row lock (or an ON CONFLICT row lock) after already taking the path.
-- No schema/API shape, lifecycle status, lease, rollout, or owner changes.


create or replace function public.begin_managed_storage_upload(
  p_object_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_classroom_id uuid,
  p_course_blueprint_id uuid,
  p_provisional_owner_id uuid,
  p_purpose text,
  p_created_by_user_id uuid,
  p_data_subject_user_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_content_type text,
  p_byte_size bigint
)
returns public.managed_storage_objects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object public.managed_storage_objects;
begin
  perform public.lock_managed_storage_protocol();
  if p_object_id is null or p_created_by_user_id is null
    or num_nonnulls(p_classroom_id, p_course_blueprint_id, p_provisional_owner_id) <> 1
  then
    raise exception using errcode = '22023', message = 'managed_storage_owner_required';
  end if;
  select * into v_object from public.managed_storage_objects
  where id = p_object_id for update;
  if found and (
    v_object.storage_bucket is distinct from p_storage_bucket
    or v_object.storage_path is distinct from p_storage_path
  ) then
    raise exception using errcode = '23505', message = 'managed_storage_reservation_conflict';
  elsif not found then
    select * into v_object from public.managed_storage_objects
    where storage_bucket = p_storage_bucket and storage_path = p_storage_path
    for update;
    if found and v_object.id is distinct from p_object_id then
      raise exception using errcode = '23505', message = 'managed_storage_reservation_conflict';
    end if;
  end if;
  perform public.managed_storage_exact_lock(p_storage_bucket, p_storage_path);
  if v_object.id is null and exists (
    select 1 from public.managed_storage_objects object
    where object.id = p_object_id
      or (object.storage_bucket = p_storage_bucket
        and object.storage_path = p_storage_path)
  ) then
    raise exception using errcode = '40001', message = 'managed_storage_write_retry';
  end if;

  -- A deterministic Blueprint copy may be retried after its caller queued the
  -- verified bytes because a later atomic step failed. Cancel only that exact,
  -- still-provisional cleanup intent; active leases, deleted tombstones, and
  -- every non-Blueprint producer remain non-resumable here.
  if v_object.id is not null
    and v_object.status = 'cleanup_pending'
    and v_object.provisional_owner_id is not distinct from p_provisional_owner_id
    and p_provisional_owner_id is not null
    and v_object.resource_type = 'course_blueprint_operation'
    and v_object.resource_id is not distinct from p_resource_id
    and v_object.created_by_user_id is not distinct from p_created_by_user_id
    and v_object.data_subject_user_id is not distinct from p_data_subject_user_id
    and v_object.purpose is not distinct from p_purpose
    and v_object.content_type is not distinct from nullif(btrim(p_content_type), '')
    and v_object.byte_size is not distinct from p_byte_size
  then
    update public.managed_storage_objects object
    set status = case
          when object.verified_at is not null and exists (
            select 1 from storage.objects stored
            where stored.bucket_id = object.storage_bucket
              and stored.name = object.storage_path
          ) then 'verified'
          else 'reserved'
        end,
        verified_at = case
          when object.verified_at is not null and exists (
            select 1 from storage.objects stored
            where stored.bucket_id = object.storage_bucket
              and stored.name = object.storage_path
          ) then object.verified_at
          else null
        end,
        ready_at = null,
        reservation_expires_at = clock_timestamp() + interval '1 hour',
        cleanup_reason_code = null,
        next_attempt_at = clock_timestamp(),
        lease_token = null,
        lease_expires_at = null,
        last_error_code = null,
        updated_at = clock_timestamp()
    where object.id = v_object.id
    returning * into v_object;
    return v_object;
  end if;

  insert into public.managed_storage_objects (
    id, storage_bucket, storage_path, classroom_id, course_blueprint_id,
    provisional_owner_id, purpose, created_by_user_id, data_subject_user_id,
    resource_type, resource_id, content_type, byte_size, reservation_expires_at
  ) values (
    p_object_id, p_storage_bucket, p_storage_path, p_classroom_id,
    p_course_blueprint_id, p_provisional_owner_id, p_purpose,
    p_created_by_user_id, p_data_subject_user_id, nullif(btrim(p_resource_type), ''),
    p_resource_id, nullif(btrim(p_content_type), ''), p_byte_size,
    clock_timestamp() + interval '1 hour'
  )
  on conflict (id) do update set updated_at = clock_timestamp()
  where managed_storage_objects.storage_bucket = excluded.storage_bucket
    and managed_storage_objects.storage_path = excluded.storage_path
    and managed_storage_objects.classroom_id is not distinct from excluded.classroom_id
    and managed_storage_objects.course_blueprint_id is not distinct from excluded.course_blueprint_id
    and managed_storage_objects.provisional_owner_id is not distinct from excluded.provisional_owner_id
    and managed_storage_objects.purpose = excluded.purpose
    and managed_storage_objects.status in ('reserved', 'verified', 'ready')
  returning * into v_object;

  if v_object.id is null then
    raise exception using errcode = '23505', message = 'managed_storage_reservation_conflict';
  end if;

  return v_object;
end;
$$;

create or replace function public.register_legacy_managed_storage_object(
  p_object_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_classroom_id uuid,
  p_course_blueprint_id uuid,
  p_purpose text,
  p_created_by_user_id uuid,
  p_data_subject_user_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_content_type text,
  p_byte_size bigint,
  p_content_sha256 text default null
)
returns public.managed_storage_objects
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_object public.managed_storage_objects;
begin
  perform public.lock_managed_storage_protocol();
  if p_object_id is null
    or p_object_id is distinct from public.managed_storage_legacy_object_id(
      p_storage_bucket, p_storage_path
    )
    or num_nonnulls(p_classroom_id, p_course_blueprint_id) <> 1
  then
    raise exception using errcode = '22023', message = 'legacy_managed_owner_required';
  end if;
  select * into v_object from public.managed_storage_objects
  where id = p_object_id for update;
  if found and (
    v_object.storage_bucket is distinct from p_storage_bucket
    or v_object.storage_path is distinct from p_storage_path
  ) then
    raise exception using errcode = '23505', message = 'legacy_managed_storage_ambiguous';
  elsif not found then
    select * into v_object from public.managed_storage_objects
    where storage_bucket = p_storage_bucket and storage_path = p_storage_path
    for update;
    if found and v_object.id is distinct from p_object_id then
      raise exception using errcode = '23505', message = 'legacy_managed_storage_ambiguous';
    end if;
  end if;
  perform public.managed_storage_exact_lock(p_storage_bucket, p_storage_path);
  if v_object.id is null and exists (
    select 1 from public.managed_storage_objects object
    where object.id = p_object_id
      or (object.storage_bucket = p_storage_bucket
        and object.storage_path = p_storage_path)
  ) then
    raise exception using errcode = '40001', message = 'managed_storage_write_retry';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = p_storage_bucket and object.name = p_storage_path
  ) then
    raise exception using errcode = '55000', message = 'legacy_managed_storage_object_missing';
  end if;

  insert into public.managed_storage_objects (
    id, storage_bucket, storage_path, classroom_id, course_blueprint_id,
    purpose, status, created_by_user_id, data_subject_user_id, resource_type,
    resource_id, content_type, byte_size, content_sha256,
    reservation_expires_at, verified_at, ready_at
  ) values (
    p_object_id, p_storage_bucket, p_storage_path, p_classroom_id,
    p_course_blueprint_id, p_purpose, 'ready', p_created_by_user_id,
    p_data_subject_user_id, nullif(btrim(p_resource_type), ''), p_resource_id,
    nullif(btrim(p_content_type), ''), p_byte_size, p_content_sha256,
    null, clock_timestamp(), clock_timestamp()
  )
  on conflict (id) do update set updated_at = clock_timestamp()
  where managed_storage_objects.storage_bucket = excluded.storage_bucket
    and managed_storage_objects.storage_path = excluded.storage_path
    and managed_storage_objects.classroom_id is not distinct from excluded.classroom_id
    and managed_storage_objects.course_blueprint_id is not distinct from excluded.course_blueprint_id
    and managed_storage_objects.provisional_owner_id is null
    and managed_storage_objects.purpose = excluded.purpose
    and managed_storage_objects.created_by_user_id
      is not distinct from excluded.created_by_user_id
    and managed_storage_objects.data_subject_user_id
      is not distinct from excluded.data_subject_user_id
    and managed_storage_objects.resource_type
      is not distinct from excluded.resource_type
    and managed_storage_objects.resource_id
      is not distinct from excluded.resource_id
    and managed_storage_objects.content_type
      is not distinct from excluded.content_type
    and managed_storage_objects.byte_size
      is not distinct from excluded.byte_size
    and managed_storage_objects.content_sha256
      is not distinct from excluded.content_sha256
    and managed_storage_objects.status = 'ready'
  returning * into v_object;

  if v_object.id is null then
    raise exception using errcode = '23505', message = 'legacy_managed_storage_ambiguous';
  end if;
  return v_object;
end;
$$;

create or replace function public.resolve_managed_storage_blueprint_copy_source(
  p_teacher_id uuid,
  p_storage_path text,
  p_classroom_id uuid,
  p_course_blueprint_id uuid,
  p_managed_object_id uuid default null
)
returns public.managed_storage_objects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enforced boolean;
  v_object public.managed_storage_objects;
  v_resource_id uuid;
  v_resource_type text;
begin
  v_enforced := public.lock_managed_storage_protocol();
  if p_teacher_id is null
    or p_storage_path is null or p_storage_path = ''
    or num_nonnulls(p_classroom_id, p_course_blueprint_id) <> 1
    or (p_classroom_id is not null and not exists (
      select 1 from public.classrooms classroom
      where classroom.id = p_classroom_id and classroom.teacher_id = p_teacher_id
    ))
    or (p_course_blueprint_id is not null and not exists (
      select 1 from public.course_blueprints blueprint
      where blueprint.id = p_course_blueprint_id and blueprint.teacher_id = p_teacher_id
    ))
  then
    raise exception using errcode = '55000',
      message = 'managed_storage_blueprint_copy_source_invalid';
  end if;

  if p_managed_object_id is not null then
    select * into v_object from public.managed_storage_objects object
    where object.id = p_managed_object_id for update;
  else
    select * into v_object from public.managed_storage_objects object
    where object.storage_bucket = 'test-documents'
      and object.storage_path = p_storage_path
    for update;
  end if;

  if found and p_managed_object_id is not null and (
    v_object.storage_bucket <> 'test-documents'
    or v_object.storage_path is distinct from p_storage_path
  ) then
    raise exception using errcode = '55000',
      message = 'managed_storage_blueprint_copy_source_invalid';
  end if;

  if not found then
    if p_managed_object_id is not null or v_enforced then
      raise exception using errcode = '55000',
        message = 'managed_storage_blueprint_copy_source_invalid';
    end if;
    perform public.managed_storage_exact_lock('test-documents', p_storage_path);
    -- The initial lookup found no row. Do not invert row -> path if an
    -- identity committed while this transaction waited for the exact path.
    if exists (
      select 1 from public.managed_storage_objects object
      where object.storage_bucket = 'test-documents'
        and object.storage_path = p_storage_path
    ) then
      raise exception using errcode = '40001', message = 'managed_storage_write_retry';
    end if;
    if v_object.id is null then
      if p_classroom_id is not null then
        select test.id into v_resource_id
        from public.tests test
        where test.classroom_id = p_classroom_id
          and exists (
            select 1
            from public.managed_storage_payload_raw_references(test.documents) reference
            where reference.managed_object_id is null
              and reference.storage_bucket = 'test-documents'
              and reference.storage_path = p_storage_path
          )
        order by test.id limit 1;
        v_resource_type := 'test';
      else
        select assessment.id into v_resource_id
        from public.course_blueprint_assessments assessment
        where assessment.course_blueprint_id = p_course_blueprint_id
          and exists (
            select 1
            from public.managed_storage_payload_raw_references(assessment.documents) reference
            where reference.managed_object_id is null
              and reference.storage_bucket = 'test-documents'
              and reference.storage_path = p_storage_path
          )
        order by assessment.id limit 1;
        v_resource_type := 'course_blueprint_assessment';
      end if;
      if v_resource_id is null or exists (
        select 1
        from (
          select test.classroom_id, null::uuid course_blueprint_id,
            test.documents payload from public.tests test
          union all
          select assignment.classroom_id, null::uuid, document.content
            from public.assignment_docs document
            join public.assignments assignment on assignment.id = document.assignment_id
          union all
          select assignment.classroom_id, null::uuid,
            coalesce(history.snapshot, history.patch)
            from public.assignment_doc_history history
            join public.assignment_docs document on document.id = history.assignment_doc_id
            join public.assignments assignment on assignment.id = document.assignment_id
          union all
          select null::uuid, assessment.course_blueprint_id, assessment.documents
            from public.course_blueprint_assessments assessment
          union all
          select null::uuid, version.course_blueprint_id, version.snapshot_json
            from public.course_blueprint_versions version
          union all
          select null::uuid, proposal.course_blueprint_id, proposal.operations_json
            from public.course_blueprint_change_proposals proposal
        ) host
        cross join lateral public.managed_storage_payload_raw_references(host.payload) reference
        where reference.storage_bucket = 'test-documents'
          and reference.storage_path = p_storage_path
          and (
            host.classroom_id is distinct from p_classroom_id
            or host.course_blueprint_id is distinct from p_course_blueprint_id
          )
      ) then
        raise exception using errcode = '55000',
          message = 'managed_storage_blueprint_copy_source_ambiguous';
      end if;
      v_object := public.register_legacy_managed_storage_object(
        public.managed_storage_legacy_object_id('test-documents', p_storage_path),
        'test-documents', p_storage_path,
        p_classroom_id, p_course_blueprint_id,
        'teacher_test_material', p_teacher_id, null,
        v_resource_type, v_resource_id, null, null, null
      );
      return v_object;
    end if;
  end if;

  perform public.managed_storage_exact_lock('test-documents', p_storage_path);
  if v_object.storage_bucket <> 'test-documents'
    or v_object.storage_path is distinct from p_storage_path
    or v_object.status <> 'ready'
    or v_object.provisional_owner_id is not null
    or v_object.classroom_id is distinct from p_classroom_id
    or v_object.course_blueprint_id is distinct from p_course_blueprint_id
  then
    raise exception using errcode = '55000',
      message = 'managed_storage_blueprint_copy_source_invalid';
  end if;
  return v_object;
end;
$$;

create or replace function public.enforce_managed_storage_object_write()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_enforced boolean;
  v_object public.managed_storage_objects;
  v_object_id uuid;
  v_locked_object_ids uuid[] := array[]::uuid[];
  v_identity record;
  v_old_bucket text;
  v_old_path text;
begin
  if tg_op = 'UPDATE' then
    v_old_bucket := old.bucket_id;
    v_old_path := old.name;
  end if;
  if new.bucket_id not in (
    'assignment-artifacts', 'submission-images', 'test-documents',
    'classroom-archives', 'gradex-analytics-extracts'
  ) and coalesce(v_old_bucket not in (
    'assignment-artifacts', 'submission-images', 'test-documents',
    'classroom-archives', 'gradex-analytics-extracts'
  ), true) then return new; end if;
  v_enforced := public.lock_managed_storage_protocol();

  -- Include the old identity even when the target bucket is unmanaged.
  -- Enforced managed identities cannot move out of their reserved path.
  if v_enforced and tg_op = 'UPDATE'
    and (old.bucket_id, old.name) is distinct from (new.bucket_id, new.name)
  then
    raise exception using errcode = '55000', message = 'managed_storage_identity_immutable';
  end if;

  -- Match the UUID order used by relational/JSON reference writers. All rows
  -- for a compatibility rename are acquired before either exact-path lock.
  for v_object_id in
    select object.id from public.managed_storage_objects object
    where (object.storage_bucket = new.bucket_id and object.storage_path = new.name)
      or (object.storage_bucket = v_old_bucket and object.storage_path = v_old_path)
    order by object.id
    for update
  loop
    v_locked_object_ids := array_append(v_locked_object_ids, v_object_id);
  end loop;

  for v_identity in
    select distinct identity.storage_bucket, identity.storage_path
    from (values (new.bucket_id, new.name), (v_old_bucket, v_old_path))
      identity(storage_bucket, storage_path)
    where identity.storage_bucket in (
      'assignment-artifacts', 'submission-images', 'test-documents',
      'classroom-archives', 'gradex-analytics-extracts'
    )
    order by identity.storage_bucket, identity.storage_path
  loop
    perform public.managed_storage_exact_lock(
      v_identity.storage_bucket, v_identity.storage_path
    );
    -- Nonlocking recheck: a row appearing after the prelock cannot be safely
    -- locked here. Retry from UUID prelocking instead of waiting path -> row.
    if exists (
      select 1 from public.managed_storage_objects object
      where object.storage_bucket = v_identity.storage_bucket
        and object.storage_path = v_identity.storage_path
        and not (object.id = any(v_locked_object_ids))
    ) then
      raise exception using errcode = '40001', message = 'managed_storage_write_retry';
    end if;
    if exists (
      select 1 from public.classroom_purge_objects purge_object
      where purge_object.storage_bucket = v_identity.storage_bucket
        and purge_object.storage_path_sha256 = public.managed_storage_identity_sha256(
          v_identity.storage_bucket, v_identity.storage_path
        )
    ) then
      raise exception using errcode = '55000', message = 'classroom_purge_path_reserved';
    end if;
    -- Moving an old path must not bypass its active cleanup/tombstone fence.
    if exists (
      select 1 from public.managed_storage_objects object
      where object.storage_bucket = v_identity.storage_bucket
        and object.storage_path = v_identity.storage_path
        and object.status in ('cleanup_pending', 'cleanup_processing', 'deleted')
    ) then
      raise exception using errcode = '55000', message = 'managed_storage_cleanup_in_progress';
    end if;
  end loop;

  select * into v_object from public.managed_storage_objects
  where storage_bucket = new.bucket_id and storage_path = new.name;
  if not v_enforced then return new; end if;
  if v_object.id is null or v_object.status not in ('reserved', 'verified', 'ready') then
    raise exception using errcode = '55000', message = 'managed_storage_reservation_required';
  end if;
  return new;
end;
$$;

-- CREATE OR REPLACE preserves existing ownership and ACLs. Restate the public
-- RPC boundary explicitly; the existing trigger ACL is left unchanged.
revoke all on function public.begin_managed_storage_upload(
  uuid, text, text, uuid, uuid, uuid, text, uuid, uuid, text, uuid, text, bigint
), public.register_legacy_managed_storage_object(
  uuid, text, text, uuid, uuid, text, uuid, uuid, text, uuid, text, bigint, text
), public.resolve_managed_storage_blueprint_copy_source(uuid, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_managed_storage_upload(
  uuid, text, text, uuid, uuid, uuid, text, uuid, uuid, text, uuid, text, bigint
), public.register_legacy_managed_storage_object(
  uuid, text, text, uuid, uuid, text, uuid, uuid, text, uuid, text, bigint, text
), public.resolve_managed_storage_blueprint_copy_source(uuid, text, uuid, uuid, uuid)
  to service_role;
