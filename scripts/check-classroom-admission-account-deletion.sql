-- Rollback-only regression against a fresh, disposable Pika database.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

insert into public.users (id, email, role, email_verified_at)
select ('e3300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'admission-deletion-' || n || '@example.invalid', 'student', now()
from generate_series(1, 72) n;

do $test$
declare
  bootstrap_users uuid[] := array(
    select ('e3300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
    from generate_series(1, 70) n
  );
  protected_user uuid := 'e3300000-0000-4000-8000-000000000071';
  automatic_user uuid := 'e3300000-0000-4000-8000-000000000072';
  empty_set uuid[] := '{}';
  bootstrap_digest text;
  batch_before jsonb;
  grant_operation uuid;
  hot_classroom uuid := gen_random_uuid();
  cold_classroom uuid := gen_random_uuid();
  export_operation uuid := gen_random_uuid();
  cold_archive uuid := gen_random_uuid();
  storage_object uuid := gen_random_uuid();
  storage_path text := 'synthetic/330-cold-classroom.tar.gz';
  stamp timestamptz := clock_timestamp();
begin
  bootstrap_digest := private.classroom_experience_admission_manifest_v2(
    'bootstrap', bootstrap_users, array[protected_user]
  );
  perform public.commit_classroom_experience_admission_batch_v2(
    gen_random_uuid(), 0, 'bootstrap', bootstrap_users, array[protected_user],
    bootstrap_digest, 'synthetic-deletion'
  );
  perform public.commit_classroom_experience_admission_batch_v2(
    gen_random_uuid(), 1, 'growth_on', empty_set, empty_set,
    private.classroom_experience_admission_manifest_v2('growth_on', empty_set, empty_set),
    'synthetic-deletion'
  );
  perform public.set_classroom_auto_admission_enabled_v1(true);
  if public.ensure_verified_classroom_admission_v1(automatic_user, bootstrap_digest)->>'outcome'
     is distinct from 'admitted' then
    raise exception 'Synthetic automatic admission failed';
  end if;

  select origin_operation_id into strict grant_operation
    from private.classroom_experience_admission_grants where user_id = automatic_user;
  batch_before := public.read_classroom_experience_admission_operation_v2(grant_operation);

  begin
    update private.classroom_experience_admission_grants
      set admitted_at = admitted_at + interval '1 second' where user_id = automatic_user;
    raise exception 'Admission grant update was accepted';
  exception when sqlstate '55000' then null;
  end;

  begin
    delete from private.classroom_experience_admission_grants where user_id = automatic_user;
    raise exception 'Direct removal of a live grant was accepted';
  exception when sqlstate '55000' then null;
  end;

  begin
    delete from public.users where id = protected_user;
    raise exception 'Protected exclusion did not prevent account removal';
  exception when foreign_key_violation then null;
  end;

  insert into public.classrooms (id, teacher_id, title, class_code)
  values
    (hot_classroom, bootstrap_users[3], 'Synthetic retained classroom', 'R330TE'),
    (cold_classroom, bootstrap_users[4], 'Synthetic pre-compaction classroom', 'R330CO');
  insert into public.classroom_enrollments (classroom_id, student_id)
  values (hot_classroom, bootstrap_users[5]), (hot_classroom, automatic_user);

  -- Simulate a retained historical tombstone without an actor ledger.
  insert into public.managed_storage_objects (
    id, storage_bucket, storage_path, classroom_id, purpose, status,
    created_by_user_id, resource_type, resource_id, content_type, byte_size,
    content_sha256, verified_at, ready_at
  ) values (
    storage_object, 'classroom-archives', storage_path, cold_classroom, 'classroom_archive',
    'ready', bootstrap_users[4], 'classroom_archive_operation', export_operation,
    'application/gzip', 1, repeat('e', 64), stamp, stamp
  );
  insert into public.classroom_archive_operations (
    id, teacher_id, classroom_id, operation_type, request_sha256, status, source_revision,
    source_schema_migration, source_app_commit, retention, snapshot_created_at,
    snapshot_expires_at, completed_at, storage_bucket, storage_path, managed_object_id
  ) values (
    export_operation, bootstrap_users[4], cold_classroom, 'export', repeat('b', 64), 'completed',
    1, '330_classroom_admission_account_deletion', repeat('c', 40), '{}', stamp,
    stamp + interval '1 hour', stamp, 'classroom-archives', storage_path, storage_object
  );
  insert into public.classroom_archives (
    id, operation_id, classroom_id, teacher_id, format, format_version, source_revision,
    source_schema_migration, source_app_commit, storage_bucket, storage_path,
    artifact_sha256, content_sha256, compressed_byte_size, uncompressed_byte_size,
    resource_counts, storage_object_counts, verification, retention, created_at, verified_at
  ) values (
    cold_archive, export_operation, cold_classroom, bootstrap_users[4], 'pika.classroom-archive',
    1, 1, '330_classroom_admission_account_deletion', repeat('c', 40), 'classroom-archives',
    storage_path, repeat('d', 64), repeat('e', 64), 1, 1, '{}', '{}', '{}', '{}', stamp, stamp
  );
  delete from public.classrooms where id = cold_classroom;
  insert into public.classroom_cold_tombstones (
    classroom_id, teacher_id, archive_id, title, archived_at, compacted_at, source_revision
  ) values (
    cold_classroom, bootstrap_users[4], cold_archive, 'Synthetic retained archive', stamp, stamp, 1
  );

  set local role service_role;
  for owner_index in 3..4 loop
    begin
      delete from public.users where id = bootstrap_users[owner_index];
      raise exception 'Admitted classroom owner deletion was accepted';
    exception when sqlstate '55000' then
      if sqlerrm <> 'admitted_account_owns_classrooms' then raise; end if;
    end;
  end loop;
  delete from public.users where id in (automatic_user, bootstrap_users[1]);
  reset role;

  if exists(select from public.users where id in (automatic_user, bootstrap_users[1]))
    or exists(select from private.classroom_experience_admission_grants
      where user_id in (automatic_user, bootstrap_users[1]))
    or exists(select from public.classroom_enrollments where student_id = automatic_user)
    or public.read_classroom_experience_admission_v2(automatic_user)->>'admitted'
       is distinct from 'false'
    or public.read_classroom_experience_admission_v2(bootstrap_users[2])->>'bootstrap_member'
       is distinct from 'true'
    or public.read_classroom_experience_admission_operation_v2(grant_operation)
       is distinct from batch_before then
    raise exception 'Account removal changed unrelated access or admission history';
  end if;

  if public.ensure_verified_classroom_admission_v1(automatic_user, bootstrap_digest)->>'outcome'
     is distinct from 'unverified' then
    raise exception 'Deleted account could recreate its grant';
  end if;
  if not exists(select from public.classrooms where id = hot_classroom and teacher_id = bootstrap_users[3])
    or not exists(select from public.classroom_enrollments
      where classroom_id = hot_classroom and student_id = bootstrap_users[5])
    or not exists(select from public.classroom_cold_tombstones
      where classroom_id = cold_classroom and teacher_id = bootstrap_users[4]) then
    raise exception 'Account deletion damaged an owned classroom';
  end if;

  if (select registry_revision from private.classroom_experience_admission_policy) <> 3
    or (select count(*) from private.classroom_experience_admission_grants) <> 69
    or (select count(*) from private.classroom_experience_admission_exclusions) <> 1 then
    raise exception 'Account removal changed the policy or protected exclusion';
  end if;
end
$test$;

rollback;
