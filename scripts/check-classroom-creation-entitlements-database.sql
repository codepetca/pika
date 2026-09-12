-- Rollback-only migrations 166-167 behavioral fixture. The wrapper verifies
-- the exact local Supabase target and that both migrations are already applied.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $contract$
declare
  v_setter text := 'public.set_effective_feature_entitlement_v1(uuid,uuid,text,text,boolean,timestamp with time zone,timestamp with time zone,integer,text,text,bigint)';
  v_reader text := 'public.get_classroom_creation_access_v1(uuid,timestamp with time zone)';
  v_assert text := 'public.assert_classroom_creation_allowed_v1(uuid,uuid,timestamp with time zone)';
  v_create text := 'public.create_classroom_atomic_v1(uuid,uuid,text,text,text,text,text)';
  v_blueprint text := 'public.instantiate_course_blueprint_atomic_v2(uuid,uuid,uuid,uuid,text,bigint,jsonb)';
  v_blueprint_inner text := 'public.instantiate_course_blueprint_atomic_v2_pre_create_entitlement(uuid,uuid,uuid,uuid,text,bigint,jsonb)';
begin
  if to_regprocedure(v_setter) is null
    or to_regprocedure(v_reader) is null
    or to_regprocedure(v_assert) is null
    or to_regprocedure(v_create) is null
    or to_regprocedure(v_blueprint) is null
    or to_regprocedure(v_blueprint_inner) is null
  then
    raise exception 'Migrations 166-167 are required; this fixture never applies them';
  end if;

  if has_table_privilege('anon', 'public.effective_feature_entitlements', 'select')
    or has_table_privilege('authenticated', 'public.effective_feature_entitlements', 'select')
    or not has_table_privilege('service_role', 'public.effective_feature_entitlements', 'select')
    or has_table_privilege('service_role', 'public.effective_feature_entitlements', 'insert')
    or has_table_privilege('service_role', 'public.effective_feature_entitlement_audit', 'insert')
    or has_function_privilege('anon', v_setter, 'execute')
    or has_function_privilege('authenticated', v_setter, 'execute')
    or not has_function_privilege('service_role', v_setter, 'execute')
    or has_function_privilege('anon', v_reader, 'execute')
    or has_function_privilege('authenticated', v_reader, 'execute')
    or not has_function_privilege('service_role', v_reader, 'execute')
    or has_function_privilege('service_role', v_assert, 'execute')
    or has_table_privilege('anon', 'public.classroom_creation_operations', 'select')
    or has_table_privilege('authenticated', 'public.classroom_creation_operations', 'select')
    or not has_table_privilege('service_role', 'public.classroom_creation_operations', 'select')
    or has_table_privilege('service_role', 'public.classroom_creation_operations', 'insert')
    or has_function_privilege('anon', v_create, 'execute')
    or has_function_privilege('authenticated', v_create, 'execute')
    or not has_function_privilege('service_role', v_create, 'execute')
    or has_function_privilege('service_role', v_blueprint_inner, 'execute')
    or not has_function_privilege('service_role', v_blueprint, 'execute')
  then
    raise exception 'Classroom creation entitlement privileges are incorrect';
  end if;

  if not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    join pg_roles owner on owner.oid = procedure.proowner
    where procedure.oid in (
      to_regprocedure(v_setter),
      to_regprocedure(v_reader),
      to_regprocedure(v_assert),
      to_regprocedure(v_create),
      to_regprocedure(v_blueprint)
    )
    group by owner.rolname
    having owner.rolname = 'postgres'
      and bool_and(procedure.prosecdef)
      and bool_and(procedure.proconfig @> array['search_path=""']::text[])
      and count(*) = 5
  ) then
    raise exception 'Classroom creation entitlement function security metadata is incorrect';
  end if;

  if position('assert_classroom_creation_allowed_v1' in pg_get_functiondef(
    to_regprocedure(v_blueprint)
  )) = 0 then
    raise exception 'Blueprint materialization does not enforce classroom creation access';
  end if;
end;
$contract$;

insert into public.users (id, email, role) values
  ('e1660000-0000-4000-8000-000000000001', 'legacy-166@example.invalid', 'teacher'),
  ('e1660000-0000-4000-8000-000000000002', 'free-166@example.invalid', 'teacher'),
  ('e1660000-0000-4000-8000-000000000003', 'access-166@example.invalid', 'teacher'),
  ('e1660000-0000-4000-8000-000000000004', 'future-166@example.invalid', 'teacher'),
  ('e1660000-0000-4000-8000-000000000005', 'expired-166@example.invalid', 'teacher'),
  ('e1660000-0000-4000-8000-000000000006', 'existing-166@example.invalid', 'teacher'),
  ('e1660000-0000-4000-8000-000000000007', 'unavailable-166@example.invalid', 'teacher'),
  ('e1670000-0000-4000-8000-000000000001', 'retry-167@example.invalid', 'teacher');

-- Missing rows preserve the current application-controlled behavior.
insert into public.classrooms (id, teacher_id, title, class_code) values (
  'e1660000-0000-4000-8000-000000000011',
  'e1660000-0000-4000-8000-000000000001',
  'Legacy compatible',
  'E166LEG'
);

-- Existing classrooms are grandfathered even when the account is already over
-- its newly assigned limit. Ordinary edits remain available.
insert into public.classrooms (id, teacher_id, title, class_code) values
  ('e1660000-0000-4000-8000-000000000061', 'e1660000-0000-4000-8000-000000000006', 'Existing one', 'E166EX1'),
  ('e1660000-0000-4000-8000-000000000062', 'e1660000-0000-4000-8000-000000000006', 'Existing two', 'E166EX2');

-- Simulate an impossible-through-the-setter missing live snapshot. Audit
-- history must make this fail closed instead of silently restoring legacy mode.
insert into public.effective_feature_entitlement_audit (
  operation_id,
  subject_user_id,
  feature_key,
  new_source,
  new_enabled,
  new_starts_at,
  new_quota_limit,
  entitlement_revision,
  actor_ref,
  reason_code,
  request_fingerprint
) values (
  'e1660000-0000-4000-8000-000000000107',
  'e1660000-0000-4000-8000-000000000007',
  'classrooms.create',
  'manual',
  true,
  '2026-09-01T00:00:00Z',
  1,
  1,
  'test:migration-166',
  'missing_live_snapshot_fixture',
  repeat('a', 32)
);

set local role service_role;

do $behavior$
declare
  v_result jsonb;
  v_replay jsonb;
begin
  -- Ordinary creation stores exactly one result and replays it even when
  -- server-derived values are regenerated after a lost HTTP response.
  v_result := public.create_classroom_atomic_v1(
    'e1670000-0000-4000-8000-000000000101',
    'e1670000-0000-4000-8000-000000000001',
    repeat('a', 64),
    'Retry-safe classroom',
    'E167ONE',
    null,
    'blue'
  );
  v_replay := public.create_classroom_atomic_v1(
    'e1670000-0000-4000-8000-000000000101',
    'e1670000-0000-4000-8000-000000000001',
    repeat('a', 64),
    'Retry-safe classroom',
    'E167TWO',
    null,
    'rose'
  );
  if not (v_result->>'ok')::boolean
    or (v_result->>'replayed')::boolean
    or not (v_replay->>'ok')::boolean
    or not (v_replay->>'replayed')::boolean
    or v_result->'classroom'->>'id' <> v_replay->'classroom'->>'id'
    or v_replay->'classroom'->>'class_code' <> 'E167ONE'
    or (
      select count(*)
      from public.classrooms
      where teacher_id = 'e1670000-0000-4000-8000-000000000001'
    ) <> 1
  then
    raise exception 'Ordinary classroom creation replay is invalid: %, %', v_result, v_replay;
  end if;

  v_replay := public.create_classroom_atomic_v1(
    'e1670000-0000-4000-8000-000000000101',
    'e1670000-0000-4000-8000-000000000001',
    repeat('b', 64),
    'Changed classroom',
    'E167NEW',
    null,
    'teal'
  );
  if v_replay->>'error_code' <> 'classroom_creation_idempotency_conflict' then
    raise exception 'Ordinary classroom creation conflict is invalid: %', v_replay;
  end if;

  delete from public.classrooms
  where id = (v_result->'classroom'->>'id')::uuid;
  v_replay := public.create_classroom_atomic_v1(
    'e1670000-0000-4000-8000-000000000101',
    'e1670000-0000-4000-8000-000000000001',
    repeat('a', 64),
    'Retry-safe classroom',
    'E167THR',
    null,
    'amber'
  );
  if v_replay->>'error_code' <> 'classroom_creation_result_unavailable' then
    raise exception 'Missing classroom creation result was recreated: %', v_replay;
  end if;

  begin
    insert into public.classrooms (id, teacher_id, title, class_code) values (
      'e1660000-0000-4000-8000-000000000071',
      'e1660000-0000-4000-8000-000000000007',
      'Unavailable denied',
      'E166UNAV'
    );
    raise exception 'Previously managed account fell back to legacy creation';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'classroom_creation_entitlement_unavailable' then raise; end if;
  end;

  -- Free is join-only: a managed disabled snapshot denies creation.
  v_result := public.set_effective_feature_entitlement_v1(
    'e1660000-0000-4000-8000-000000000101',
    'e1660000-0000-4000-8000-000000000002',
    'classrooms.create', 'plan', false,
    '2026-09-01T00:00:00Z', null, 0,
    'test:migration-166', 'free_join_only', 0
  );
  if (v_result->>'revision')::integer <> 1 or (v_result->>'duplicate')::boolean then
    raise exception 'Initial Free entitlement result is invalid: %', v_result;
  end if;
  begin
    insert into public.classrooms (id, teacher_id, title, class_code) values (
      'e1660000-0000-4000-8000-000000000021',
      'e1660000-0000-4000-8000-000000000002',
      'Free denied',
      'E166FREE'
    );
    raise exception 'Free account created a classroom';
  exception when insufficient_privilege then
    if sqlerrm <> 'classroom_creation_entitlement_disabled' then raise; end if;
  end;

  -- Access grants exactly one active classroom. Archiving releases capacity;
  -- restoring the prior classroom consumes it again and is denied while full.
  v_result := public.set_effective_feature_entitlement_v1(
    'e1660000-0000-4000-8000-000000000102',
    'e1660000-0000-4000-8000-000000000003',
    'classrooms.create', 'manual', true,
    '2026-09-01T00:00:00Z', null, 1,
    'test:migration-166', 'initial_access_grant', 0
  );
  v_replay := public.set_effective_feature_entitlement_v1(
    'e1660000-0000-4000-8000-000000000102',
    'e1660000-0000-4000-8000-000000000003',
    'classrooms.create', 'manual', true,
    '2026-09-01T00:00:00Z', null, 1,
    'test:migration-166', 'initial_access_grant', 0
  );
  if not (v_replay->>'duplicate')::boolean
    or (v_replay->>'revision')::integer <> 1
  then
    raise exception 'Entitlement operation replay was not idempotent: %', v_replay;
  end if;

  insert into public.classrooms (id, teacher_id, title, class_code) values (
    'e1660000-0000-4000-8000-000000000031',
    'e1660000-0000-4000-8000-000000000003',
    'Access one',
    'E166ACC1'
  );

  insert into public.course_blueprint_operations (
    id,
    teacher_id,
    operation_type,
    request_sha256,
    status,
    source_blueprint_id,
    result_classroom_id,
    result,
    completed_at
  ) values (
    'e1660000-0000-4000-8000-000000000130',
    'e1660000-0000-4000-8000-000000000003',
    'instantiate',
    repeat('a', 64),
    'completed',
    'e1660000-0000-4000-8000-000000000131',
    'e1660000-0000-4000-8000-000000000031',
    jsonb_build_object(
      'ok', true,
      'status', 201,
      'operation_id', 'e1660000-0000-4000-8000-000000000130',
      'operation_type', 'instantiate',
      'replayed', false,
      'classroom_id', 'e1660000-0000-4000-8000-000000000031'
    ),
    clock_timestamp()
  );
  v_result := public.instantiate_course_blueprint_atomic_v2(
    'e1660000-0000-4000-8000-000000000130',
    'e1660000-0000-4000-8000-000000000003',
    'e1660000-0000-4000-8000-000000000131',
    'e1660000-0000-4000-8000-000000000132',
    repeat('a', 64),
    1,
    '{}'::jsonb
  );
  if not (v_result->>'ok')::boolean
    or not (v_result->>'replayed')::boolean
    or v_result->>'classroom_id' <> 'e1660000-0000-4000-8000-000000000031'
  then
    raise exception 'Completed Blueprint replay consumed new capacity: %', v_result;
  end if;
  v_result := public.instantiate_course_blueprint_atomic_v2(
    'e1660000-0000-4000-8000-000000000130',
    'e1660000-0000-4000-8000-000000000003',
    'e1660000-0000-4000-8000-000000000131',
    'e1660000-0000-4000-8000-000000000132',
    repeat('b', 64),
    1,
    '{}'::jsonb
  );
  if v_result->>'error_code' <> 'idempotency_conflict' then
    raise exception 'Blueprint idempotency conflict was hidden by the active limit: %', v_result;
  end if;

  begin
    insert into public.classrooms (id, teacher_id, title, class_code) values (
      'e1660000-0000-4000-8000-000000000032',
      'e1660000-0000-4000-8000-000000000003',
      'Access two denied',
      'E166ACC2'
    );
    raise exception 'Access account exceeded its active classroom limit';
  exception when check_violation then
    if sqlerrm <> 'classroom_creation_active_limit_reached' then raise; end if;
  end;
  update public.classrooms
  set archived_at = clock_timestamp()
  where id = 'e1660000-0000-4000-8000-000000000031';
  insert into public.classrooms (id, teacher_id, title, class_code) values (
    'e1660000-0000-4000-8000-000000000032',
    'e1660000-0000-4000-8000-000000000003',
    'Access replacement',
    'E166ACC2'
  );
  begin
    update public.classrooms
    set archived_at = null
    where id = 'e1660000-0000-4000-8000-000000000031';
    raise exception 'Access account restored above its active classroom limit';
  exception when check_violation then
    if sqlerrm <> 'classroom_creation_active_limit_reached' then raise; end if;
  end;

  -- Exact start and expiry windows fail closed.
  perform public.set_effective_feature_entitlement_v1(
    'e1660000-0000-4000-8000-000000000103',
    'e1660000-0000-4000-8000-000000000004',
    'classrooms.create', 'trial', true,
    '2099-01-01T00:00:00Z', '2099-01-02T00:00:00Z', 1,
    'test:migration-166', 'future_trial_fixture', 0
  );
  begin
    insert into public.classrooms (id, teacher_id, title, class_code) values (
      'e1660000-0000-4000-8000-000000000041',
      'e1660000-0000-4000-8000-000000000004',
      'Future denied',
      'E166FUT'
    );
    raise exception 'Not-started entitlement created a classroom';
  exception when insufficient_privilege then
    if sqlerrm <> 'classroom_creation_entitlement_not_started' then raise; end if;
  end;

  perform public.set_effective_feature_entitlement_v1(
    'e1660000-0000-4000-8000-000000000104',
    'e1660000-0000-4000-8000-000000000005',
    'classrooms.create', 'trial', true,
    '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z', 1,
    'test:migration-166', 'expired_trial_fixture', 0
  );
  begin
    insert into public.classrooms (id, teacher_id, title, class_code) values (
      'e1660000-0000-4000-8000-000000000051',
      'e1660000-0000-4000-8000-000000000005',
      'Expired denied',
      'E166EXP'
    );
    raise exception 'Expired entitlement created a classroom';
  exception when insufficient_privilege then
    if sqlerrm <> 'classroom_creation_entitlement_expired' then raise; end if;
  end;

  perform public.set_effective_feature_entitlement_v1(
    'e1660000-0000-4000-8000-000000000105',
    'e1660000-0000-4000-8000-000000000006',
    'classrooms.create', 'manual', true,
    '2026-09-01T00:00:00Z', null, 1,
    'test:migration-166', 'grandfather_existing', 0
  );
  update public.classrooms
  set title = 'Existing one remains editable'
  where id = 'e1660000-0000-4000-8000-000000000061';
  begin
    insert into public.classrooms (id, teacher_id, title, class_code) values (
      'e1660000-0000-4000-8000-000000000063',
      'e1660000-0000-4000-8000-000000000006',
      'Grandfathered extra denied',
      'E166EX3'
    );
    raise exception 'Grandfathered account created above its limit';
  exception when check_violation then
    if sqlerrm <> 'classroom_creation_active_limit_reached' then raise; end if;
  end;

  v_result := public.get_classroom_creation_access_v1(
    'e1660000-0000-4000-8000-000000000003',
    '2026-09-12T12:00:00Z'
  );
  if (v_result->>'managed')::boolean is not true
    or (v_result->>'allowed')::boolean is not false
    or v_result->>'reason' <> 'active_limit_reached'
    or (v_result->>'quota_limit')::integer <> 1
    or (v_result->>'active_count')::integer <> 1
  then
    raise exception 'Classroom creation access read contract is invalid: %', v_result;
  end if;

  begin
    perform public.set_effective_feature_entitlement_v1(
      'e1660000-0000-4000-8000-000000000106',
      'e1660000-0000-4000-8000-000000000003',
      'classrooms.create', 'manual', true,
      '2026-09-01T00:00:00Z', null, 2,
      'test:migration-166', 'stale_revision_fixture', 0
    );
    raise exception 'Stale entitlement revision was accepted';
  exception when serialization_failure then
    if sqlerrm <> 'feature_entitlement_revision_conflict' then raise; end if;
  end;

  if (select count(*) from public.effective_feature_entitlement_audit) <> 6 then
    raise exception 'Entitlement audit count is invalid';
  end if;
end;
$behavior$;

rollback;
