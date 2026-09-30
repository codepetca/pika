#!/usr/bin/env bash
set -euo pipefail

DEFAULT_DB_CONTAINER="$(docker ps --filter 'name=supabase_db_pika' --format '{{.Names}}' | head -n 1)"
if [[ -z "$DEFAULT_DB_CONTAINER" ]]; then
  DEFAULT_DB_CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)"
fi
DB_CONTAINER="${CLASSROOM_GUIDED_DRAFT_DB_CONTAINER:-$DEFAULT_DB_CONTAINER}"
DATABASE_NAME="${CLASSROOM_GUIDED_DRAFT_DATABASE_NAME:-postgres}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DATABASE_NAME" \
  -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

do $contract$
declare
  v_owner constant uuid := 'c1900000-0000-4000-8000-000000000001';
  v_other constant uuid := 'c1900000-0000-4000-8000-000000000002';
  v_blueprint constant uuid := 'c1900000-0000-4000-8000-000000000003';
  v_version constant uuid := 'c1900000-0000-4000-8000-000000000004';
  v_classroom constant uuid := 'c1900000-0000-4000-8000-000000000005';
  v_unit constant uuid := 'c1900000-0000-4000-8000-000000000006';
  v_next constant uuid := 'c1900000-0000-4000-8000-000000000007';
  v_foreign constant uuid := 'c1900000-0000-4000-8000-000000000008';
  v_restored constant uuid := 'c1900000-0000-4000-8000-000000000009';
  v_revision bigint;
  v_source_revision bigint;
  v_before jsonb;
  v_lessons_before jsonb;
  v_questions_before jsonb;
  v_inventory text;
  v_row jsonb;
  v_rules text;
  v_operation uuid := gen_random_uuid();
  v_created jsonb;
begin
  insert into public.users (id, email, role) values
    (v_owner, 'guided-draft-owner@example.test', 'teacher'),
    (v_other, 'guided-draft-other@example.test', 'teacher');
  insert into public.course_blueprints (id, teacher_id, title)
  values (v_blueprint, v_owner, 'Guided contract');
  insert into public.classrooms (id, teacher_id, title, class_code, source_blueprint_id)
  values (v_classroom, v_owner, 'Guided contract', 'CGDC01', v_blueprint);
  insert into public.course_blueprint_versions (
    id, course_blueprint_id, version_number, source_draft_revision,
    snapshot_schema_version, snapshot_json, snapshot_sha256, created_by
  ) values (
    v_version, v_blueprint, 2, 7, 3,
    jsonb_build_object('authoring_guidance', jsonb_build_object(
      'course_expectations_markdown', E'\nUse taught vocabulary.\t',
      'assignment_guidance_markdown', 'State a deliverable.',
      'test_guidance_markdown', 'Short prompts.',
      'unit_exceptions', jsonb_build_array(jsonb_build_object(
        'id', upper(v_unit::text),
        'unit_label', E'\nLoops\t',
        'assignment_guidance_markdown', 'Use a loop.',
        'test_guidance_markdown', 'Use iteration.'
      ))
    )), repeat('a', 64), v_owner
  );
  update public.classrooms set source_blueprint_version_id = v_version
  where id = v_classroom;


  insert into public.course_blueprints (id,teacher_id,title) values(v_foreign,v_other,'Other Blueprint');
  select content_revision into v_revision from public.course_blueprints where id=v_blueprint;
  insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_schema_version,snapshot_json,snapshot_sha256,created_by)
  values(v_next,v_blueprint,4,v_revision,3,
    '{"authoring_guidance":{"course_expectations_markdown":"Revised rules","assignment_guidance_markdown":"","test_guidance_markdown":"Instructions first","unit_exceptions":[]}}',repeat('b',64),v_owner);
  insert into public.tests(classroom_id,title,created_by,status,source_blueprint_version_id)
    values(v_classroom,'Existing closed Test',v_owner,'closed',v_version);
  insert into public.tests(classroom_id,title,created_by,status)
    values(v_classroom,'Untracked Test',v_owner,'draft');
  insert into public.lesson_plans(classroom_id,date,content)
    values(v_classroom,'2030-01-01','{"type":"doc","content":[]}');
  insert into public.test_questions(test_id,question_text,question_type,points,position,source_blueprint_version_id)
    select id,'Preserve this prompt','open_response',5,0,v_version from public.tests
    where classroom_id=v_classroom and title='Existing closed Test';
  select jsonb_agg(to_jsonb(l) order by l.id) into v_lessons_before from public.lesson_plans l where classroom_id=v_classroom;
  select jsonb_agg(to_jsonb(q) order by q.id) into v_questions_before from public.test_questions q
    where test_id in (select id from public.tests where classroom_id=v_classroom);
  select jsonb_agg(to_jsonb(t) order by t.id) into v_before from public.tests t where classroom_id=v_classroom;
  select blueprint_source_revision into v_source_revision from public.classrooms where id=v_classroom;
  v_inventory := public.get_course_blueprint_purge_inventory(v_owner,v_blueprint)->>'inventory_sha256';

  begin
    perform public.adopt_classroom_authoring_guidance_v1(v_other,v_classroom,v_blueprint,v_version,v_version,v_revision,v_next);
    raise exception 'Wrong actor accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.adopt_classroom_authoring_guidance_v1(v_owner,v_classroom,v_foreign,v_version,v_version,v_revision,v_next);
    raise exception 'Wrong Blueprint accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.adopt_classroom_authoring_guidance_v1(v_owner,v_classroom,v_blueprint,v_version,v_version,v_revision+1,v_next);
    raise exception 'Stale Draft accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.adopt_classroom_authoring_guidance_v1(v_owner,v_classroom,v_blueprint,v_next,v_version,v_revision,v_next);
    raise exception 'Stale content Version accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.adopt_classroom_authoring_guidance_v1(v_owner,v_classroom,v_blueprint,v_version,v_next,v_revision,v_next);
    raise exception 'Stale guidance accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.adopt_classroom_authoring_guidance_v1(v_owner,v_classroom,v_blueprint,v_version,v_version,v_revision,gen_random_uuid());
    raise exception 'Missing Version accepted';
  exception when serialization_failure then null; end;

  insert into public.course_blueprint_purge_operations(id,course_blueprint_id,teacher_id,request_sha256,inventory_sha256,finalization_sha256,source_revision,status)
    values(v_operation,v_blueprint,v_owner,repeat('a',64),repeat('a',64),repeat('a',64),v_revision,'inventorying');
  insert into public.course_blueprint_purge_fences(course_blueprint_id,operation_id) values(v_blueprint,v_operation);
  begin
    perform public.adopt_classroom_authoring_guidance_v1(v_owner,v_classroom,v_blueprint,v_version,v_version,v_revision,v_next);
    raise exception 'Purging Blueprint accepted';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    update public.classrooms set authoring_guidance_version_id=null where id=v_classroom;
    raise exception 'Guidance reference removal bypassed Blueprint purge fence';
  exception when object_not_in_prerequisite_state then null; end;
  delete from public.course_blueprint_purge_fences where operation_id=v_operation;
  delete from public.course_blueprint_purge_operations where id=v_operation;
  insert into public.classroom_purge_operations(id,classroom_id,teacher_id,request_sha256,source_revision,impact_summary)
    values(v_operation,v_classroom,v_owner,repeat('a',64),1,'{}');
  insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values(v_classroom,v_operation,v_owner);
  begin
    perform public.adopt_classroom_authoring_guidance_v1(v_owner,v_classroom,v_blueprint,v_version,v_version,v_revision,v_next);
    raise exception 'Purging classroom accepted';
  exception when object_not_in_prerequisite_state then null; end;
  delete from public.classroom_purge_fences where operation_id=v_operation;
  delete from public.classroom_purge_operations where id=v_operation;

  perform public.adopt_classroom_authoring_guidance_v1(v_owner,v_classroom,v_blueprint,v_version,v_version,v_revision,v_next);
  if (select authoring_guidance_version_id from public.classrooms where id=v_classroom) is distinct from v_next
    or (select source_blueprint_version_id from public.classrooms where id=v_classroom) is distinct from v_version
    or (select blueprint_source_revision from public.classrooms where id=v_classroom) is distinct from v_source_revision
    or (select jsonb_agg(to_jsonb(t) order by t.id) from public.tests t where classroom_id=v_classroom) is distinct from v_before
    or (select jsonb_agg(to_jsonb(l) order by l.id) from public.lesson_plans l where classroom_id=v_classroom) is distinct from v_lessons_before
    or (select jsonb_agg(to_jsonb(q) order by q.id) from public.test_questions q where test_id in (select id from public.tests where classroom_id=v_classroom)) is distinct from v_questions_before
  then raise exception 'Adoption changed structural content or lineage'; end if;
  if public.get_course_blueprint_purge_inventory(v_owner,v_blueprint)->>'inventory_sha256' is not distinct from v_inventory then
    raise exception 'Purge inventory omitted guidance pointer'; end if;

  begin
    perform public.assert_classroom_guided_draft_context_v1(v_owner,v_classroom,v_version,null,'tests','');
    raise exception 'Old signed preview accepted';
  exception when serialization_failure then null; end;
  v_rules := public.resolve_classroom_guided_rules_v1((select snapshot_json->'authoring_guidance' from public.course_blueprint_versions where id=v_next),'assignments',null)->>'rules_markdown';
  v_created := public.create_guided_assignment_for_owner_v1(v_owner,v_classroom,v_next,null,gen_random_uuid(),
    'New guided assignment','Body','Body','{}','2030-01-01','[]',10,v_rules,repeat('c',64),v_version);
  if v_created->'provenance'->>'content_version_id' is distinct from v_version::text
    or v_created->'provenance'->>'source_blueprint_version_id' is distinct from v_next::text
    or v_created->'provenance'->>'rules_markdown' is distinct from v_rules
    or v_created->'assignment'->>'source_blueprint_version_id' is not null
  then raise exception 'Adopted guidance was not retained atomically'; end if;

  -- Insertion, used by archive restore, preserves both version pointers.
  insert into public.classrooms(id,teacher_id,title,class_code,source_blueprint_id,source_blueprint_version_id,authoring_guidance_version_id)
    values(v_restored,v_owner,'Restored','CGRST1',v_blueprint,v_version,v_next);
  if (select authoring_guidance_version_id from public.classrooms where id=v_restored) is distinct from v_next then
    raise exception 'Restore INSERT discarded guidance'; end if;
  v_row := public.normalize_classroom_archive_restore_row(v_operation,'classrooms','{}');
  if not (v_row ? 'authoring_guidance_version_id') or v_row->>'authoring_guidance_version_id' is not null then
    raise exception 'Old archive default failed'; end if;
  v_row := public.normalize_classroom_archive_restore_row(v_operation,'classrooms',jsonb_build_object('authoring_guidance_version_id',v_next));
  if v_row->>'authoring_guidance_version_id' is distinct from v_next::text then raise exception 'Archive normalization discarded guidance'; end if;

  update public.classrooms set archived_at=now() where id=v_classroom;
  begin
    perform public.adopt_classroom_authoring_guidance_v1(v_owner,v_classroom,v_blueprint,v_version,v_next,v_revision,v_next);
    raise exception 'Archived classroom accepted';
  exception when object_not_in_prerequisite_state then null; end;
  perform public.begin_classroom_archive_export_v2(v_operation,v_owner,v_classroom,repeat('d',64),
    '107_classroom_archive_v2_direct_source','abcdef1','{"mode":"teacher_managed","delete_after":null}',2,2);
  if not exists(select 1 from public.classroom_archive_snapshot_resources where operation_id=v_operation
    and table_name='classrooms' and row_id=v_classroom
    and (select authoring_guidance_version_id from public.classrooms where id=v_classroom)=v_next) then
    raise exception 'Archive snapshot omitted guidance pointer'; end if;

  -- An explicit full application of the same Content Version also resets guidance.
  update public.classrooms set source_blueprint_version_id=v_version where id=v_restored;
  if (select authoring_guidance_version_id from public.classrooms where id=v_restored) is not null then
    raise exception 'Same-Version full content application retained override'; end if;
  update public.classrooms set authoring_guidance_version_id=v_next where id=v_restored;
  -- A structural update clears an explicit guidance selection.
  update public.classrooms set source_blueprint_version_id=v_next where id=v_restored;
  if (select authoring_guidance_version_id from public.classrooms where id=v_restored) is not null then
    raise exception 'Content update retained old override'; end if;
  update public.classrooms set authoring_guidance_version_id=v_next where id=v_restored;
  begin
    perform public.assert_classroom_guided_draft_context_v1(v_owner,v_restored,v_next,null,'assignments',v_rules,v_version);
    raise exception 'Changed structural context with same effective guidance accepted';
  exception when serialization_failure then null; end;
  -- Blueprint finalization severs structural source; its existing write also clears guidance.
  perform set_config('pika.course_blueprint_purge_finalize','on',true);
  update public.classrooms set source_blueprint_id=null,source_blueprint_version_id=null where id=v_restored;
  if (select authoring_guidance_version_id from public.classrooms where id=v_restored) is not null then
    raise exception 'Purge retained guidance reference'; end if;
  perform set_config('pika.course_blueprint_purge_finalize','off',true);
  if has_function_privilege('authenticated','public.adopt_classroom_authoring_guidance_v1(uuid,uuid,uuid,uuid,uuid,bigint,uuid)','EXECUTE')
    or has_function_privilege('anon','public.adopt_classroom_authoring_guidance_v1(uuid,uuid,uuid,uuid,uuid,bigint,uuid)','EXECUTE') then
    raise exception 'Adoption RPC is browser accessible'; end if;
end;
$contract$;
rollback;
SQL
echo "Classroom guidance adoption contracts passed."

# Hold each lifecycle lock from a second connection. Adoption must fail promptly,
# before row reads or writes, rather than wait behind a concurrent purge.
for LOCK_KIND in classroom blueprint; do
  LOCK_LOG="$(mktemp)"
  if [[ "$LOCK_KIND" = classroom ]]; then
    LOCK_SQL="select pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:c1900000-0000-4000-8000-000000000005',0));"
  else
    LOCK_SQL="select pg_advisory_xact_lock(hashtextextended(jsonb_build_array('course_blueprint_purge','c1900000-0000-4000-8000-000000000003'::uuid)::text,0));"
  fi
  docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 > "$LOCK_LOG" <<SQL &
begin;
set application_name = 'pika_guidance_adoption_lock';
$LOCK_SQL
select pg_sleep(4);
rollback;
SQL
  LOCK_PID=$!
  for ((attempt = 0; attempt < 40; attempt++)); do
    READY="$(docker exec "$DB_CONTAINER" psql -U postgres -d "$DATABASE_NAME" -X -Atc "select count(*) from pg_stat_activity where application_name='pika_guidance_adoption_lock' and wait_event='PgSleep'")"
    if [[ "$READY" = 1 ]]; then break; fi
    sleep 0.1
  done
  if [[ "$READY" != 1 ]]; then
    wait "$LOCK_PID"
    cat "$LOCK_LOG"
    rm -f "$LOCK_LOG"
    echo "Concurrent guidance lock was not established" >&2
    exit 1
  fi
  docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 <<'SQL'
do $race$
begin
  perform public.adopt_classroom_authoring_guidance_v1(
    'c1900000-0000-4000-8000-000000000001','c1900000-0000-4000-8000-000000000005',
    'c1900000-0000-4000-8000-000000000003','c1900000-0000-4000-8000-000000000004',
    'c1900000-0000-4000-8000-000000000004',1,'c1900000-0000-4000-8000-000000000007');
  raise exception 'Adoption bypassed concurrent lifecycle lock';
exception when serialization_failure then null;
end;
$race$;
SQL
  wait "$LOCK_PID"
  rm -f "$LOCK_LOG"
done
echo "Concurrent guidance adoption lifecycle locks passed."
