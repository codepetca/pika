#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${ATOMIC_BLUEPRINT_DB_CONTAINER:-$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)}"
DATABASE_NAME="${ATOMIC_BLUEPRINT_DATABASE_NAME:-postgres}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

insert into public.users (id, email, role)
values ('10000000-0000-4000-8000-000000000001', 'blueprint-contract@example.test', 'teacher');

do $contract$
declare
  v_teacher_id constant uuid := '10000000-0000-4000-8000-000000000001';
  v_failed_create_operation constant uuid := '20000000-0000-4000-8000-000000000001';
  v_create_operation constant uuid := '20000000-0000-4000-8000-000000000002';
  v_failed_instantiate_operation constant uuid := '20000000-0000-4000-8000-000000000003';
  v_instantiate_operation constant uuid := '20000000-0000-4000-8000-000000000004';
  v_stale_capture_operation constant uuid := '20000000-0000-4000-8000-000000000005';
  v_malformed_operation constant uuid := '20000000-0000-4000-8000-000000000006';
  v_source_classroom_id constant uuid := '30000000-0000-4000-8000-000000000005';
  v_result jsonb;
  v_replay jsonb;
  v_blueprint_id uuid;
  v_blueprint_revision bigint;
  v_source_revision bigint;
  v_changed_source_revision bigint;
  v_classroom_id uuid;
  v_count integer;
  v_create_plan jsonb;
  v_instantiation_plan jsonb;
begin
  v_result := public.create_course_blueprint_atomic(
    v_malformed_operation,
    v_teacher_id,
    'import',
    repeat('f', 64),
    null,
    null,
    '{}'::jsonb
  );
  if coalesce((v_result->>'ok')::boolean, true)
    or v_result->>'error_code' <> 'invalid_blueprint_plan'
  then
    raise exception 'Expected malformed plan to fail through the operation contract: %', v_result;
  end if;
  if not exists (
    select 1 from public.course_blueprint_operations
    where id = v_malformed_operation
      and status = 'failed'
      and error_code = 'invalid_blueprint_plan'
  ) then
    raise exception 'Malformed-plan failure was not retained in the ledger';
  end if;

  v_create_plan := jsonb_build_object(
    'blueprint', jsonb_build_object(
      'title', 'Rollback blueprint',
      'subject', '',
      'grade_level', '',
      'course_code', '',
      'term_template', '',
      'overview_markdown', '',
      'outline_markdown', '',
      'resources_markdown', '',
      'planned_site_slug', null,
      'planned_site_published', false,
      'planned_site_config', jsonb_build_object(
        'overview', true,
        'outline', true,
        'resources', true,
        'assignments', true,
        'tests', true,
        'lesson_plans', true
      )
    ),
    'assignments', jsonb_build_array(jsonb_build_object(
      'title', 'Invalid weight',
      'instructions_markdown', '',
      'submission_requirements_json', '[]'::jsonb,
      'default_due_days', 1,
      'default_due_time', '23:59',
      'points_possible', 10,
      'gradebook_weight', -1,
      'include_in_final', true,
      'is_draft', true,
      'position', 0
    )),
    'assessments', '[]'::jsonb,
    'lesson_templates', '[]'::jsonb,
    'manifest_version', '3',
    'source_package_exported_at', null
  );

  v_result := public.create_course_blueprint_atomic(
    v_failed_create_operation,
    v_teacher_id,
    'import',
    repeat('a', 64),
    null,
    null,
    v_create_plan
  );

  if coalesce((v_result->>'ok')::boolean, true) then
    raise exception 'Expected invalid blueprint child row to fail';
  end if;
  select count(*) into v_count
  from public.course_blueprints
  where teacher_id = v_teacher_id and title = 'Rollback blueprint';
  if v_count <> 0 then
    raise exception 'Failed blueprint operation left domain rows behind';
  end if;
  if not exists (
    select 1 from public.course_blueprint_operations
    where id = v_failed_create_operation
      and status = 'failed'
      and error_code = 'create_blueprint_assignments_failed'
  ) then
    raise exception 'Failed blueprint operation was not retained in the ledger';
  end if;

  v_create_plan := jsonb_set(v_create_plan, '{blueprint,title}', '"Atomic blueprint"'::jsonb);
  v_create_plan := jsonb_set(v_create_plan, '{assignments,0,gradebook_weight}', '25'::jsonb);
  v_result := public.create_course_blueprint_atomic(
    v_create_operation,
    v_teacher_id,
    'import',
    repeat('b', 64),
    null,
    null,
    v_create_plan
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Expected valid blueprint operation to succeed: %', v_result;
  end if;
  v_blueprint_id := (v_result->>'blueprint_id')::uuid;
  select content_revision into v_blueprint_revision
  from public.course_blueprints where id = v_blueprint_id;

  v_replay := public.create_course_blueprint_atomic(
    v_create_operation,
    v_teacher_id,
    'import',
    repeat('b', 64),
    null,
    null,
    v_create_plan
  );
  if not coalesce((v_replay->>'replayed')::boolean, false)
    or v_replay->>'blueprint_id' <> v_result->>'blueprint_id'
  then
    raise exception 'Completed blueprint operation did not replay its original result';
  end if;
  select count(*) into v_count
  from public.course_blueprints
  where teacher_id = v_teacher_id and title = 'Atomic blueprint';
  if v_count <> 1 then
    raise exception 'Blueprint replay created duplicate rows';
  end if;

  insert into public.classrooms (id, teacher_id, title, class_code)
  values (v_source_classroom_id, v_teacher_id, 'Capture source', 'SRC001');
  select blueprint_source_revision into v_source_revision
  from public.classrooms where id = v_source_classroom_id;

  insert into public.assignments (
    classroom_id,
    title,
    description,
    due_at,
    created_by
  ) values (
    v_source_classroom_id,
    'Concurrent assignment',
    '',
    '2026-09-15T23:59:00-04:00'::timestamptz,
    v_teacher_id
  );
  select blueprint_source_revision into v_changed_source_revision
  from public.classrooms where id = v_source_classroom_id;
  if v_changed_source_revision <= v_source_revision then
    raise exception 'Assignment mutation did not advance source classroom revision';
  end if;

  v_create_plan := jsonb_set(
    v_create_plan,
    '{blueprint,title}',
    '"Stale capture blueprint"'::jsonb
  );
  v_result := public.create_course_blueprint_atomic(
    v_stale_capture_operation,
    v_teacher_id,
    'capture',
    repeat('e', 64),
    v_source_classroom_id,
    v_source_revision,
    v_create_plan
  );
  if coalesce((v_result->>'ok')::boolean, true)
    or v_result->>'error_code' <> 'source_classroom_changed'
  then
    raise exception 'Expected stale classroom capture to fail: %', v_result;
  end if;
  if exists (
    select 1 from public.course_blueprints
    where teacher_id = v_teacher_id and title = 'Stale capture blueprint'
  ) then
    raise exception 'Stale classroom capture left blueprint rows behind';
  end if;
  if not exists (
    select 1 from public.course_blueprint_operations
    where id = v_stale_capture_operation
      and status = 'failed'
      and error_code = 'source_classroom_changed'
  ) then
    raise exception 'Stale capture failure was not retained in the ledger';
  end if;

  v_instantiation_plan := jsonb_build_object(
    'expected_content_revision', v_blueprint_revision,
    'manifest_version', '3',
    'classroom', jsonb_build_object(
      'title', 'Rollback classroom',
      'class_code', 'ROLLBK',
      'term_label', null,
      'theme_color', 'blue',
      'start_date', '2026-09-08',
      'end_date', '2027-01-29',
      'course_overview_markdown', '',
      'course_outline_markdown', '',
      'actual_site_config', jsonb_build_object(
        'overview', true,
        'outline', true,
        'resources', true,
        'assignments', true,
        'tests', true,
        'lesson_plans', true,
        'announcements', true,
        'lesson_plan_scope', 'current_week'
      )
    ),
    'class_days', jsonb_build_array(jsonb_build_object('date', '2026-09-08')),
    'resources_content', null,
    'assignments', '[]'::jsonb,
    'tests', jsonb_build_array(jsonb_build_object(
      'title', 'Invalid test',
      'position', 0,
      'show_results', false,
      'documents', '[]'::jsonb,
      'points_possible', 10,
      'gradebook_weight', 10,
      'include_in_final', true,
      'questions', jsonb_build_array(jsonb_build_object(
        'question_type', 'invalid',
        'question_text', 'Invalid child row',
        'options', '[]'::jsonb,
        'correct_option', null,
        'answer_key', null,
        'sample_solution', null,
        'points', 1,
        'response_max_chars', 5000,
        'response_monospace', false,
        'position', 0
      )),
      'draft_content', jsonb_build_object(
        'title', 'Invalid test',
        'show_results', false,
        'questions', '[]'::jsonb
      )
    )),
    'lesson_plans', '[]'::jsonb,
    'overflow_lesson_templates', '[]'::jsonb
  );

  v_result := public.instantiate_course_blueprint_atomic(
    v_failed_instantiate_operation,
    v_teacher_id,
    v_blueprint_id,
    repeat('c', 64),
    v_blueprint_revision,
    v_instantiation_plan
  );
  if coalesce((v_result->>'ok')::boolean, true) then
    raise exception 'Expected invalid classroom child row to fail';
  end if;
  select count(*) into v_count
  from public.classrooms
  where teacher_id = v_teacher_id and title = 'Rollback classroom';
  if v_count <> 0 then
    raise exception 'Failed instantiation left classroom rows behind';
  end if;
  if not exists (
    select 1 from public.course_blueprint_operations
    where id = v_failed_instantiate_operation
      and status = 'failed'
      and error_code = 'create_tests_failed'
  ) then
    raise exception 'Failed instantiation was not retained in the ledger';
  end if;

  v_instantiation_plan := jsonb_set(v_instantiation_plan, '{classroom,title}', '"Atomic classroom"'::jsonb);
  v_instantiation_plan := jsonb_set(v_instantiation_plan, '{classroom,class_code}', '"ATOM01"'::jsonb);
  v_instantiation_plan := jsonb_set(v_instantiation_plan, '{tests}', '[]'::jsonb);
  v_result := public.instantiate_course_blueprint_atomic(
    v_instantiate_operation,
    v_teacher_id,
    v_blueprint_id,
    repeat('d', 64),
    v_blueprint_revision,
    v_instantiation_plan
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Expected valid instantiation to succeed: %', v_result;
  end if;
  v_classroom_id := (v_result->>'classroom_id')::uuid;

  v_replay := public.instantiate_course_blueprint_atomic(
    v_instantiate_operation,
    v_teacher_id,
    v_blueprint_id,
    repeat('d', 64),
    v_blueprint_revision,
    v_instantiation_plan
  );
  if not coalesce((v_replay->>'replayed')::boolean, false)
    or v_replay->>'classroom_id' <> v_classroom_id::text
  then
    raise exception 'Completed instantiation did not replay its original result';
  end if;
  select count(*) into v_count
  from public.classrooms
  where teacher_id = v_teacher_id and title = 'Atomic classroom';
  if v_count <> 1 then
    raise exception 'Instantiation replay created duplicate classrooms';
  end if;
  select count(*) into v_count
  from public.class_days
  where classroom_id = v_classroom_id;
  if v_count <> 1 then
    raise exception 'Atomic classroom has unexpected class-day count';
  end if;
end;
$contract$;

-- Current application entrypoints: v3 capture -> saved Version -> entitled v2
-- instantiate. These additional synthetic cases retain every historical case
-- above and remain inside the same terminal rollback. Never run this script
-- against a shared database merely to obtain contextual-admission evidence.
do $current_capture_contract$
declare
  v_role text;
  v_owner uuid;
  v_other uuid;
  v_source uuid;
  v_assignment uuid;
  v_artifact uuid;
  v_operation uuid;
  v_instantiate_operation uuid;
  v_purge_operation uuid;
  v_blueprint uuid;
  v_version uuid;
  v_created uuid;
  v_revision bigint;
  v_draft_revision bigint;
  v_plan jsonb;
  v_classroom_plan jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_snapshot jsonb;
  v_before integer;
begin
  foreach v_role in array array['teacher','student'] loop
    v_owner:=gen_random_uuid(); v_other:=gen_random_uuid(); v_source:=gen_random_uuid();
    v_assignment:=gen_random_uuid(); v_artifact:=gen_random_uuid();
    v_operation:=gen_random_uuid(); v_instantiate_operation:=gen_random_uuid();
    insert into public.users(id,email,role) values
      (v_owner,'capture-owner-'||v_owner::text||'@example.test',v_role),
      (v_other,'capture-other-'||v_other::text||'@example.test',v_role);
    insert into public.effective_feature_entitlements(subject_user_id,feature_key,source,enabled,starts_at,quota_limit,revision)
      values(v_owner,'classrooms.create','manual',true,'2020-01-01',1,1)
      on conflict(subject_user_id,feature_key) do update set source='manual',enabled=true,starts_at='2020-01-01',expires_at=null,quota_limit=1;
    insert into public.classrooms(id,teacher_id,title,class_code)
      values(v_source,v_owner,'Current capture source',upper(substr(replace(v_source::text,'-',''),1,10)));
    insert into public.assignments(id,classroom_id,title,description,due_at,created_by,position)
      values(v_assignment,v_source,'Reusable assignment','Reusable instructions','2026-09-15T23:59:00-04:00',v_owner,0);
    select blueprint_source_revision into v_revision from public.classrooms where id=v_source;
    v_plan:=jsonb_build_object('blueprint',jsonb_build_object(
      'title','Current captured Blueprint','subject','','grade_level','','course_code','','term_template','',
      'overview_markdown','','outline_markdown','','resources_markdown','',
      'planned_site_slug',null,'planned_site_published',false,
      'planned_site_config',jsonb_build_object('overview',true,'outline',true,'resources',true,'assignments',true,'tests',true,'lesson_plans',true),
      'authoring_guidance',jsonb_build_object('course_expectations_markdown','Captured guidance',
        'assignment_guidance_markdown','','test_guidance_markdown','','unit_exceptions','[]'::jsonb)),
      'assignments',jsonb_build_array(jsonb_build_object('artifact_id',v_artifact,'title','Reusable assignment',
        'instructions_markdown','Reusable instructions','submission_requirements_json','[]'::jsonb,
        'default_due_days',1,'default_due_time','23:59','points_possible',10,'gradebook_weight',25,
        'include_in_final',true,'is_draft',true,'position',0)),
      'assessments','[]'::jsonb,'lesson_templates','[]'::jsonb,'materials','[]'::jsonb,'surveys','[]'::jsonb,'manifest_version','5');
    select count(*) into v_before from public.course_blueprints where teacher_id in(v_owner,v_other);

    -- Actor, source identity and revision are checked by the actual transaction.
    v_result:=public.create_course_blueprint_atomic_v3(gen_random_uuid(),v_other,'capture',repeat('1',64),v_source,v_revision,v_plan);
    if coalesce((v_result->>'ok')::boolean,true) or v_result->>'error_code' is distinct from 'source_classroom_changed' then
      raise exception 'Current % capture accepted a nonowner: %',v_role,v_result; end if;
    v_result:=public.create_course_blueprint_atomic_v3(gen_random_uuid(),v_owner,'capture',repeat('2',64),gen_random_uuid(),v_revision,v_plan);
    if coalesce((v_result->>'ok')::boolean,true) or v_result->>'error_code' is distinct from 'source_classroom_changed' then
      raise exception 'Current % capture accepted a foreign source: %',v_role,v_result; end if;
    v_result:=public.create_course_blueprint_atomic_v3(gen_random_uuid(),v_owner,'capture',repeat('3',64),v_source,v_revision+1,v_plan);
    if coalesce((v_result->>'ok')::boolean,true) or v_result->>'error_code' is distinct from 'source_classroom_changed' then
      raise exception 'Current % capture accepted a stale revision: %',v_role,v_result; end if;
    update public.classrooms set archived_at=clock_timestamp() where id=v_source;
    select blueprint_source_revision into v_revision from public.classrooms where id=v_source;
    v_result:=public.create_course_blueprint_atomic_v3(gen_random_uuid(),v_owner,'capture',repeat('4',64),v_source,v_revision,v_plan);
    if coalesce((v_result->>'ok')::boolean,true) or v_result->>'error_code' is distinct from 'source_classroom_changed' then
      raise exception 'Current % capture accepted an archived source: %',v_role,v_result; end if;
    update public.classrooms set archived_at=null where id=v_source;
    select blueprint_source_revision into v_revision from public.classrooms where id=v_source;
    v_purge_operation:=gen_random_uuid();
    begin
      insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,source_revision,impact_summary)
        values(v_purge_operation,v_owner,v_source,repeat('5',64),v_revision,'{}'::jsonb);
      insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values(v_source,v_purge_operation,v_owner);
      begin
        perform public.create_course_blueprint_atomic_v3(gen_random_uuid(),v_owner,'capture',repeat('5',64),v_source,v_revision,v_plan);
        raise exception 'Current capture ignored its purge fence';
      exception when sqlstate '55000' then
        if sqlerrm<>'classroom_purge_active' then raise; end if;
      end;
      raise exception 'synthetic capture purge rollback';
    exception when raise_exception then
      if sqlerrm<>'synthetic capture purge rollback' then raise; end if;
    end;
    if (select count(*) from public.course_blueprints where teacher_id in(v_owner,v_other))<>v_before
      or (select source_blueprint_id from public.classrooms where id=v_source) is not null then
      raise exception 'Rejected current capture left a Blueprint or source link'; end if;

    v_result:=public.create_course_blueprint_atomic_v3(v_operation,v_owner,'capture',repeat('6',64),v_source,v_revision,v_plan);
    if not coalesce((v_result->>'ok')::boolean,false) then raise exception 'Current % capture failed: %',v_role,v_result; end if;
    v_blueprint:=(v_result->>'blueprint_id')::uuid;
    v_version:=(v_result->>'source_blueprint_version_id')::uuid;
    select source_draft_revision,snapshot_json into v_draft_revision,v_snapshot
      from public.course_blueprint_versions where id=v_version and course_blueprint_id=v_blueprint;
    if v_version is null or v_draft_revision is null
      or not exists(select 1 from public.classrooms where id=v_source and source_blueprint_id=v_blueprint and source_blueprint_version_id=v_version)
      or not exists(select 1 from public.course_blueprints where id=v_blueprint and teacher_id=v_owner
        and authoring_guidance=v_plan->'blueprint'->'authoring_guidance')
      or not exists(select 1 from public.course_blueprint_assignments where course_blueprint_id=v_blueprint and artifact_id=v_artifact)
      or not exists(select 1 from public.assignments where id=v_assignment and source_artifact_id=v_artifact) then
      raise exception 'Current capture lost saved Version, owner, guidance or artifact lineage'; end if;
    v_replay:=public.create_course_blueprint_atomic_v3(v_operation,v_owner,'capture',repeat('6',64),v_source,v_revision,v_plan);
    if not coalesce((v_replay->>'replayed')::boolean,false) or v_replay->>'blueprint_id' is distinct from v_blueprint::text
      or v_replay->>'source_blueprint_version_id' is distinct from v_version::text then raise exception 'Current capture did not replay its exact result'; end if;
    v_replay:=public.create_course_blueprint_atomic_v3(v_operation,v_owner,'capture',repeat('7',64),v_source,v_revision,v_plan);
    if coalesce((v_replay->>'ok')::boolean,true) or v_replay->>'error_code' is distinct from 'idempotency_conflict' then
      raise exception 'Current capture accepted conflicting operation identity'; end if;
    v_replay:=public.create_course_blueprint_atomic_v3(v_operation,v_other,'capture',repeat('6',64),v_source,v_revision,v_plan);
    if coalesce((v_replay->>'ok')::boolean,true) or v_replay->>'error_code' is distinct from 'idempotency_conflict' then
      raise exception 'Current capture replay crossed actor ownership'; end if;
    if (select count(*) from public.course_blueprints where teacher_id=v_owner)<>1
      or (select snapshot_json from public.course_blueprint_versions where id=v_version) is distinct from v_snapshot then
      raise exception 'Current capture replay changed its immutable graph'; end if;

    v_classroom_plan:=jsonb_build_object('expected_content_revision',v_draft_revision,'manifest_version','5',
      'classroom',jsonb_build_object('title','Current instantiated classroom','class_code',upper(substr(replace(v_instantiate_operation::text,'-',''),1,10)),
        'term_label',null,'theme_color','blue','start_date','2026-09-08','end_date','2027-01-29',
        'course_overview_markdown','','course_outline_markdown','',
        'actual_site_config',jsonb_build_object('overview',true,'outline',true,'resources',true,'assignments',true,
          'tests',true,'lesson_plans',true,'announcements',true,'lesson_plan_scope','current_week')),
      'class_days',jsonb_build_array(jsonb_build_object('date','2026-09-08')),'resources_content',null,
      'assignments',jsonb_build_array(jsonb_build_object('artifact_id',v_artifact,'title','Reusable assignment',
        'description','Reusable instructions','due_at','2026-09-09T23:59:00-04:00','submission_requirements','[]'::jsonb,
        'points_possible',10,'gradebook_weight',25,'include_in_final',true,'is_draft',true,'position',0)),
      'tests','[]'::jsonb,'lesson_plans','[]'::jsonb,'materials','[]'::jsonb,'surveys','[]'::jsonb,'overflow_lesson_templates','[]'::jsonb);
    insert into public.effective_feature_entitlements(subject_user_id,feature_key,source,enabled,starts_at,quota_limit,revision)
      values(v_other,'classrooms.create','manual',true,'2020-01-01',1,1)
      on conflict(subject_user_id,feature_key) do update set source='manual',enabled=true,starts_at='2020-01-01',expires_at=null,quota_limit=1;
    v_replay:=public.instantiate_course_blueprint_atomic_v2(gen_random_uuid(),v_other,v_blueprint,v_version,repeat('9',64),v_draft_revision,v_classroom_plan);
    if coalesce((v_replay->>'ok')::boolean,true) or v_replay->>'error_code' is distinct from 'source_blueprint_changed'
      or exists(select 1 from public.classrooms where teacher_id=v_other) then
      raise exception 'Current instantiate crossed Blueprint ownership despite independent creation entitlement'; end if;
    begin
      perform public.instantiate_course_blueprint_atomic_v2(v_instantiate_operation,v_owner,v_blueprint,v_version,repeat('8',64),v_draft_revision,v_classroom_plan);
      raise exception 'Current instantiate bypassed active classroom capacity';
    exception when check_violation then
      if sqlerrm<>'classroom_creation_active_limit_reached' then raise; end if;
    end;
    if exists(select 1 from public.course_blueprint_operations where id=v_instantiate_operation) then
      raise exception 'Capacity denial started an instantiation operation'; end if;
    update public.effective_feature_entitlements set enabled=false where subject_user_id=v_owner and feature_key='classrooms.create';
    begin
      perform public.instantiate_course_blueprint_atomic_v2(v_instantiate_operation,v_owner,v_blueprint,v_version,repeat('8',64),v_draft_revision,v_classroom_plan);
      raise exception 'Current instantiate bypassed disabled entitlement';
    exception when insufficient_privilege then
      if sqlerrm<>'classroom_creation_entitlement_disabled' then raise; end if;
    end;
    if exists(select 1 from public.course_blueprint_operations where id=v_instantiate_operation) then
      raise exception 'Disabled entitlement started an instantiation operation'; end if;
    update public.effective_feature_entitlements set enabled=true,quota_limit=2 where subject_user_id=v_owner and feature_key='classrooms.create';
    v_result:=public.instantiate_course_blueprint_atomic_v2(v_instantiate_operation,v_owner,v_blueprint,v_version,repeat('8',64),v_draft_revision,v_classroom_plan);
    if not coalesce((v_result->>'ok')::boolean,false) then raise exception 'Current % instantiate failed: %',v_role,v_result; end if;
    v_created:=(v_result->>'classroom_id')::uuid;
    if not exists(select 1 from public.classrooms where id=v_created and teacher_id=v_owner and source_blueprint_version_id=v_version)
      or not exists(select 1 from public.assignments where classroom_id=v_created and source_artifact_id=v_artifact and source_blueprint_version_id=v_version)
      or (select count(*) from public.classrooms where teacher_id=v_owner and archived_at is null)<>2 then
      raise exception 'Current instantiate lost actor, Version, portable identity or capacity'; end if;
    v_replay:=public.instantiate_course_blueprint_atomic_v2(v_instantiate_operation,v_owner,v_blueprint,v_version,repeat('8',64),v_draft_revision,v_classroom_plan);
    if not coalesce((v_replay->>'replayed')::boolean,false) or v_replay->>'classroom_id' is distinct from v_created::text then
      raise exception 'Completed current instantiate failed replay at full capacity'; end if;
    if (select snapshot_json from public.course_blueprint_versions where id=v_version) is distinct from v_snapshot then
      raise exception 'Instantiation changed the captured immutable Version'; end if;
  end loop;
end;
$current_capture_contract$;

rollback;
SQL

echo "Atomic blueprint database contract passes."
