#!/usr/bin/env bash
set -euo pipefail

# Run only against an explicitly selected, disposable database container.
# The fixture and all assertions live in one transaction and roll back.
DB_CONTAINER="${TEST_UNPUBLICATION_DB_CONTAINER:-}"
DATABASE_NAME="${TEST_UNPUBLICATION_DATABASE_NAME:-postgres}"
if [[ -z "$DB_CONTAINER" || ! "$DB_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  echo 'Set TEST_UNPUBLICATION_DB_CONTAINER to the explicit disposable database container.' >&2
  exit 2
fi
if [[ "$DB_CONTAINER" == 'supabase_db_pika' && !( "${CI:-}" == 'true' && "${TEST_UNPUBLICATION_ALLOW_CI_DATABASE:-}" == '1' ) ]]; then
  echo 'Refusing the canonical local Pika database container; select a disposable target.' >&2
  exit 2
fi
if [[ ! "$DATABASE_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo 'TEST_UNPUBLICATION_DATABASE_NAME must be a simple PostgreSQL database name.' >&2
  exit 2
fi
if ! docker inspect --format '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null | grep -qx true; then
  echo 'Explicit Test unpublication database container is not running.' >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regprocedure('public.return_test_to_draft_atomic(uuid,uuid)') is null then
    raise exception 'Migration 255 is missing from the explicit target';
  end if;
  if has_function_privilege('anon','public.return_test_to_draft_atomic(uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.return_test_to_draft_atomic(uuid,uuid)','execute')
    or not has_function_privilege('service_role','public.return_test_to_draft_atomic(uuid,uuid)','execute') then
    raise exception 'Return Test to draft RPC privileges differ';
  end if;
end;
$guard$;

insert into public.users(id,email,role) values
 ('b2550000-0000-4000-8000-000000000001','unpublish-owner@example.test','teacher'),
 ('b2550000-0000-4000-8000-000000000002','unpublish-other@example.test','teacher'),
 ('b2550000-0000-4000-8000-000000000003','unpublish-student@example.test','student');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('b2550000-0000-4000-8000-000000000010','b2550000-0000-4000-8000-000000000001','Test unpublication rollback fixture','B255T1'),
 ('b2550000-0000-4000-8000-000000000020','b2550000-0000-4000-8000-000000000001','Polymorphic override fixture','B255T2');
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('b2550000-0000-4000-8000-000000000010','b2550000-0000-4000-8000-000000000003'),
 ('b2550000-0000-4000-8000-000000000020','b2550000-0000-4000-8000-000000000003');
insert into public.tests(id,classroom_id,title,status,show_results,points_possible,created_by,documents) values
 ('b2550000-0000-4000-8000-000000000011','b2550000-0000-4000-8000-000000000010','Current published title','closed',true,3,'b2550000-0000-4000-8000-000000000001',
  '[{"id":"source-link","source":"link","title":"Retained source","url":"https://example.invalid/lesson"}]'::jsonb),
 ('b2550000-0000-4000-8000-000000000021','b2550000-0000-4000-8000-000000000010','No retained draft','closed',false,1,'b2550000-0000-4000-8000-000000000001','[]'::jsonb),
 ('b2550000-0000-4000-8000-000000000031','b2550000-0000-4000-8000-000000000010','Rejected source','closed',false,2,'b2550000-0000-4000-8000-000000000001','[]'::jsonb);
insert into public.test_questions(id,test_id,artifact_id,source_artifact_id,question_type,question_text,options,correct_option,answer_key,points,response_max_chars,response_monospace,position) values
 ('b2550000-0000-4000-8000-000000000101','b2550000-0000-4000-8000-000000000011','b2550000-0000-4000-8000-000000000111',null,'multiple_choice','Current choice','["Yes","No"]',0,null,1,5000,false,0),
 ('b2550000-0000-4000-8000-000000000102','b2550000-0000-4000-8000-000000000011','b2550000-0000-4000-8000-000000000112','b2550000-0000-4000-8000-000000000122','open_response','Current prompt','[]',null,'Current key',2,5000,true,1),
 ('b2550000-0000-4000-8000-000000000201','b2550000-0000-4000-8000-000000000021','b2550000-0000-4000-8000-000000000211',null,'open_response','No draft prompt','[]',null,'Key',1,5000,false,0),
 ('b2550000-0000-4000-8000-000000000301','b2550000-0000-4000-8000-000000000031','b2550000-0000-4000-8000-000000000311',null,'multiple_choice','Reject prompt one','["A","B"]',0,null,1,5000,false,0),
 ('b2550000-0000-4000-8000-000000000302','b2550000-0000-4000-8000-000000000031','b2550000-0000-4000-8000-000000000312',null,'multiple_choice','Reject prompt two','["A","B"]',0,null,1,5000,false,1);
insert into public.assessment_drafts(id,assessment_type,assessment_id,classroom_id,content,version,created_by,updated_by) values
 ('b2550000-0000-4000-8000-000000000012','test','b2550000-0000-4000-8000-000000000011','b2550000-0000-4000-8000-000000000010',
  '{"title":"Stale title","show_results":false,"question_identity_version":1,"questions":[{"id":"b2550000-0000-4000-8000-000000000111","question_type":"multiple_choice","question_text":"Stale prompt","options":["A","B"],"correct_option":0,"answer_key":null,"sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}',
  7,'b2550000-0000-4000-8000-000000000001','b2550000-0000-4000-8000-000000000001');
insert into public.test_student_availability(test_id,student_id,state,updated_by) values
 ('b2550000-0000-4000-8000-000000000011','b2550000-0000-4000-8000-000000000003','closed','b2550000-0000-4000-8000-000000000001');

create function pg_temp.test_unpublication_graph(p_test_id uuid) returns jsonb
language sql stable as $graph$
  select jsonb_build_object(
    'test',(select to_jsonb(t) from public.tests t where t.id=p_test_id),
    'draft',(select to_jsonb(d) from public.assessment_drafts d where d.assessment_type='test' and d.assessment_id=p_test_id),
    'questions',(select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]'::jsonb) from public.test_questions q where q.test_id=p_test_id),
    'availability',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from public.test_student_availability a where a.test_id=p_test_id),
    'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from public.test_attempts a where a.test_id=p_test_id),
    'responses',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.test_responses r where r.test_id=p_test_id),
    'focus',(select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]'::jsonb) from public.test_focus_events f where f.test_id=p_test_id),
    'grading_runs',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.test_ai_grading_runs r where r.test_id=p_test_id),
    'grading_items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.test_ai_grading_run_items i where i.test_id=p_test_id),
    'overrides',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]'::jsonb) from public.gradebook_score_overrides o where o.assessment_type='test' and o.assessment_id=p_test_id),
    'classroom',(select to_jsonb(c) from public.classrooms c where c.id='b2550000-0000-4000-8000-000000000010')
  );
$graph$;

create function pg_temp.expect_unpublication_rejection(p_actor uuid,p_test uuid,p_code text,p_message text,p_label text)
returns void language plpgsql as $reject$
declare before_graph jsonb; after_graph jsonb; actual_code text; actual_message text;
begin
  before_graph := pg_temp.test_unpublication_graph(p_test);
  begin
    perform public.return_test_to_draft_atomic(p_actor,p_test);
    raise exception 'Unexpected unpublication success: %', p_label;
  exception when others then
    get stacked diagnostics actual_code=returned_sqlstate, actual_message=message_text;
    if actual_code is distinct from p_code or actual_message is distinct from p_message then
      raise exception 'Wrong rejection for %: % %',p_label,actual_code,actual_message;
    end if;
  end;
  after_graph := pg_temp.test_unpublication_graph(p_test);
  if after_graph is distinct from before_graph then
    raise exception 'Rejected unpublication changed graph: %',p_label;
  end if;
end;
$reject$;

create function pg_temp.reject_unpublication_status_update() returns trigger
language plpgsql as $fault$
begin
  raise exception using errcode='55000', message='forced_unpublication_status_failure';
end;
$fault$;
create trigger reject_unpublication_status_update
before update on public.tests for each row
when (new.id='b2550000-0000-4000-8000-000000000031'::uuid
  and old.status='closed' and new.status='draft')
execute function pg_temp.reject_unpublication_status_update();

-- Invoke the success path as the actual granted role; the definer function
-- must perform the private checks without granting private schema access.
set local role service_role;
do $success$
declare
  owner_id uuid := 'b2550000-0000-4000-8000-000000000001';
  retained_id uuid := 'b2550000-0000-4000-8000-000000000011';
  new_id uuid := 'b2550000-0000-4000-8000-000000000021';
  before_graph jsonb; after_graph jsonb; result jsonb; content jsonb;
begin
  if current_user <> 'service_role' then raise exception 'Success did not invoke as service_role'; end if;
  before_graph := pg_temp.test_unpublication_graph(retained_id);
  result := public.return_test_to_draft_atomic(owner_id,retained_id);
  after_graph := pg_temp.test_unpublication_graph(retained_id);
  content := after_graph#>'{draft,content}';
  if result->>'draft_version' <> '8' or result#>>'{test,status}' <> 'draft'
    or after_graph#>>'{draft,version}' <> '8'
    or content->>'title' <> 'Current published title'
    or content->>'show_results' <> 'true'
    or content->>'question_identity_version' <> '1'
    or jsonb_array_length(content->'questions') <> 2
    or content#>>'{questions,0,id}' <> 'b2550000-0000-4000-8000-000000000111'
    or content#>>'{questions,0,question_text}' <> 'Current choice'
    or content#>>'{questions,1,id}' <> 'b2550000-0000-4000-8000-000000000122'
    or content#>>'{questions,1,question_text}' <> 'Current prompt'
    or content#>>'{questions,1,answer_key}' <> 'Current key'
    or after_graph->'questions' is distinct from before_graph->'questions'
    or after_graph->'availability' is distinct from before_graph->'availability'
    or after_graph#>'{test,documents}' is distinct from before_graph#>'{test,documents}'
    or ((after_graph->'test') - array['status','updated_at']) is distinct from ((before_graph->'test') - array['status','updated_at'])
    or ((after_graph->'draft') - array['content','version','updated_at']) is distinct from ((before_graph->'draft') - array['content','version','updated_at']) then
    raise exception 'Retained draft was not reconstructed from published rows without collateral changes';
  end if;
  before_graph := after_graph;
  result := public.return_test_to_draft_atomic(owner_id,retained_id);
  if result->>'draft_version' <> '8' or pg_temp.test_unpublication_graph(retained_id) is distinct from before_graph then
    raise exception 'Retained draft retry changed state';
  end if;
  before_graph := pg_temp.test_unpublication_graph(new_id);
  result := public.return_test_to_draft_atomic(owner_id,new_id);
  after_graph := pg_temp.test_unpublication_graph(new_id);
  if result->>'draft_version' <> '1' or after_graph#>>'{draft,version}' <> '1'
    or after_graph#>>'{draft,content,title}' <> 'No retained draft'
    or after_graph#>>'{draft,content,questions,0,id}' <> 'b2550000-0000-4000-8000-000000000211'
    or after_graph->'questions' is distinct from before_graph->'questions' then
    raise exception 'Missing-draft conversion did not create version one';
  end if;
  before_graph := after_graph;
  result := public.return_test_to_draft_atomic(owner_id,new_id);
  if result->>'draft_version' <> '1' or pg_temp.test_unpublication_graph(new_id) is distinct from before_graph then
    raise exception 'Missing-draft retry changed state';
  end if;
end;
$success$;
reset role;

do $reject_cases$
<<scenario>>
declare
  owner_id uuid := 'b2550000-0000-4000-8000-000000000001';
  other_id uuid := 'b2550000-0000-4000-8000-000000000002';
  student_id uuid := 'b2550000-0000-4000-8000-000000000003';
  test_id uuid := 'b2550000-0000-4000-8000-000000000031';
  classroom_id uuid := 'b2550000-0000-4000-8000-000000000010';
  before_graph jsonb;
begin
  perform pg_temp.expect_unpublication_rejection(other_id,test_id,'PT403','test_unpublish_forbidden','wrong teacher');
  update public.classrooms set archived_at=now() where id=classroom_id;
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT403','test_unpublish_forbidden','archived classroom');
  update public.classrooms set archived_at=null where id=classroom_id;
  update public.tests set blueprint_archived_at=now() where id=test_id;
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT403','test_unpublish_forbidden','archived Blueprint Test');
  update public.tests set blueprint_archived_at=null where id=test_id;
  update public.tests set status='active' where id=test_id;
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_not_eligible','active Test');
  update public.tests set status='closed' where id=test_id;

  insert into public.test_student_availability(test_id,student_id,state,updated_by) values(test_id,student_id,'open',owner_id);
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_has_work','open availability');
  delete from public.test_student_availability where test_student_availability.test_id=scenario.test_id;

  insert into public.test_attempts(test_id,student_id,responses) values(test_id,student_id,'{}');
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_has_work','attempt');
  delete from public.test_attempts where test_attempts.test_id=scenario.test_id;

  insert into public.test_responses(test_id,question_id,student_id,selected_option) values(test_id,'b2550000-0000-4000-8000-000000000301',student_id,0);
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_has_work','response');
  delete from public.test_responses where test_responses.test_id=scenario.test_id;

  insert into public.test_focus_events(test_id,student_id,session_id,event_type) values(test_id,student_id,'b255-fixture','away_start');
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_has_work','focus event');
  delete from public.test_focus_events where test_focus_events.test_id=scenario.test_id;

  insert into public.test_ai_grading_runs(id,test_id,triggered_by,selection_hash,status)
    values('b2550000-0000-4000-8000-000000000401',test_id,owner_id,'b255-fixture','completed');
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_has_work','grading run');
  insert into public.test_responses(id,test_id,question_id,student_id,selected_option)
    values('b2550000-0000-4000-8000-000000000402',test_id,'b2550000-0000-4000-8000-000000000301',student_id,0);
  insert into public.test_ai_grading_run_items(run_id,test_id,student_id,question_id,response_id,status)
    values('b2550000-0000-4000-8000-000000000401',test_id,student_id,
      'b2550000-0000-4000-8000-000000000301','b2550000-0000-4000-8000-000000000402','completed');
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_has_work','grading item with required parents');
  delete from public.test_ai_grading_runs where test_ai_grading_runs.test_id=scenario.test_id;
  delete from public.test_responses where test_responses.test_id=scenario.test_id;

  insert into public.gradebook_score_overrides(classroom_id,student_id,assessment_type,assessment_id,earned,created_by)
    values(classroom_id,student_id,'test',test_id,1,owner_id);
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_has_work','grade override');
  delete from public.gradebook_score_overrides where assessment_type='test' and assessment_id=test_id;
  insert into public.gradebook_score_overrides(classroom_id,student_id,assessment_type,assessment_id,earned,created_by)
    values('b2550000-0000-4000-8000-000000000020',student_id,'test',test_id,1,owner_id);
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_has_work','wrong-Class polymorphic grade override');
  delete from public.gradebook_score_overrides where assessment_type='test' and assessment_id=test_id;

  -- Migration 254's unique portable-identity index rejects this corruption
  -- before the unpublication RPC can observe it. Prove that failed write rolls
  -- back without changing the graph.
  before_graph := pg_temp.test_unpublication_graph(test_id);
  begin
    update public.test_questions set source_artifact_id='b2550000-0000-4000-8000-000000000311'
      where id='b2550000-0000-4000-8000-000000000302';
    raise exception 'Duplicate portable question identity was accepted';
  exception when unique_violation then null;
  end;
  if pg_temp.test_unpublication_graph(test_id) is distinct from before_graph then
    raise exception 'Duplicate question identity write changed graph';
  end if;
  update public.test_questions set options='["A",""]'::jsonb where id='b2550000-0000-4000-8000-000000000302';
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_invalid_published_content','invalid published question');
  update public.test_questions set options='["A","B"]'::jsonb where id='b2550000-0000-4000-8000-000000000302';
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'55000','forced_unpublication_status_failure','partial draft write rollback');
  update public.tests set questions_locked_at=now() where id=test_id;
  perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'PT409','test_unpublish_not_eligible','locked questions');
end;
$reject_cases$;

\echo Test unpublication rollback contracts: PASS
rollback;
SQL

# Two real sessions exercise the 244 lifecycle writer against the new RPC.
# A committed fixture is required because separate sessions cannot see the
# rollback-only fixture above. It uses reserved IDs and is deleted by this run.
RACE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pika-unpublish-race.XXXXXX")"
RACE_FIXTURE_READY=0
cleanup_race() {
  local previous_status=$?
  trap - EXIT
  if [[ "$RACE_FIXTURE_READY" == '1' ]]; then
    if ! docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'CLEANUP_SQL'
begin;
do $owned$
begin
  if not exists(select 1 from public.users where id='c2550000-0000-4000-8000-000000000001' and email='unpublish-race-owner@example.test')
    or not exists(select 1 from public.users where id='c2550000-0000-4000-8000-000000000002' and email='unpublish-race-student@example.test')
    or not exists(select 1 from public.classrooms where id='c2550000-0000-4000-8000-000000000010'
      and teacher_id='c2550000-0000-4000-8000-000000000001' and title='Test unpublication race fixture' and class_code='C255T1')
    or not exists(select 1 from public.tests where id='c2550000-0000-4000-8000-000000000011'
      and classroom_id='c2550000-0000-4000-8000-000000000010' and status='closed'
      and title='Race Test' and questions_locked_at is null)
    or not exists(select 1 from public.classroom_enrollments where classroom_id='c2550000-0000-4000-8000-000000000010'
      and student_id='c2550000-0000-4000-8000-000000000002')
    or exists(select 1 from public.assessment_drafts where assessment_type='test' and assessment_id='c2550000-0000-4000-8000-000000000011')
    or exists(select 1 from public.test_student_availability where test_id='c2550000-0000-4000-8000-000000000011')
    or exists(select 1 from public.test_attempts where test_id='c2550000-0000-4000-8000-000000000011') then
    raise exception 'Race fixture differs from exact owned postimage; refusing teardown';
  end if;
end;
$owned$;
delete from public.tests where id='c2550000-0000-4000-8000-000000000011';
delete from public.classrooms where id='c2550000-0000-4000-8000-000000000010';
delete from public.users where id in ('c2550000-0000-4000-8000-000000000001','c2550000-0000-4000-8000-000000000002');
do $empty$
begin
  if exists(select 1 from public.tests where id='c2550000-0000-4000-8000-000000000011')
    or exists(select 1 from public.classrooms where id='c2550000-0000-4000-8000-000000000010')
    or exists(select 1 from public.users where id in ('c2550000-0000-4000-8000-000000000001','c2550000-0000-4000-8000-000000000002'))
    or exists(select 1 from public.classroom_enrollments where classroom_id='c2550000-0000-4000-8000-000000000010') then
    raise exception 'Race fixture teardown left reserved rows';
  end if;
end;
$empty$;
commit;
CLEANUP_SQL
    then
      echo "Race fixture teardown needs attention; logs: $RACE_DIR" >&2
      exit 1
    fi
  fi
  rm -rf "$RACE_DIR"
  exit "$previous_status"
}
trap cleanup_race EXIT

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SETUP_SQL'
begin;
do $unused$
begin
  if exists(select 1 from public.users where id in ('c2550000-0000-4000-8000-000000000001','c2550000-0000-4000-8000-000000000002'))
    or exists(select 1 from public.classrooms where id='c2550000-0000-4000-8000-000000000010')
    or exists(select 1 from public.tests where id='c2550000-0000-4000-8000-000000000011') then
    raise exception 'Reserved race fixture identity already exists';
  end if;
end;
$unused$;
insert into public.users(id,email,role) values
 ('c2550000-0000-4000-8000-000000000001','unpublish-race-owner@example.test','teacher'),
 ('c2550000-0000-4000-8000-000000000002','unpublish-race-student@example.test','student');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('c2550000-0000-4000-8000-000000000010','c2550000-0000-4000-8000-000000000001','Test unpublication race fixture','C255T1');
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('c2550000-0000-4000-8000-000000000010','c2550000-0000-4000-8000-000000000002');
insert into public.tests(id,classroom_id,title,status,points_possible,created_by) values
 ('c2550000-0000-4000-8000-000000000011','c2550000-0000-4000-8000-000000000010','Race Test','closed',1,'c2550000-0000-4000-8000-000000000001');
commit;
SETUP_SQL
RACE_FIXTURE_READY=1

wait_for_race_holder() {
  local holder_pid="$1" holder_log="$2" i
  for ((i=0; i<60; i++)); do
    if grep -qx 'HOLD_READY' "$holder_log"; then return 0; fi
    if ! kill -0 "$holder_pid" 2>/dev/null; then
      echo "Race holder exited before lock marker; logs: $RACE_DIR" >&2
      return 1
    fi
    sleep 0.1
  done
  echo "Race holder did not reach lock marker; logs: $RACE_DIR" >&2
  return 1
}

# Session A transitions the closed Test to draft but deliberately rolls back.
# Session B's 244 access writer must fail at the shared lifecycle lock.
docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DATABASE_NAME" -X -A -t -v ON_ERROR_STOP=1 >"$RACE_DIR/unpublish-holder.log" 2>&1 <<'HOLD_UNPUBLISH' &
begin;
set local idle_in_transaction_session_timeout='12s';
set local role service_role;
select public.return_test_to_draft_atomic('c2550000-0000-4000-8000-000000000001','c2550000-0000-4000-8000-000000000011') is not null;
select 'HOLD_READY';
select pg_sleep(5);
rollback;
HOLD_UNPUBLISH
UNPUBLISH_HOLDER_PID=$!
wait_for_race_holder "$UNPUBLISH_HOLDER_PID" "$RACE_DIR/unpublish-holder.log"
docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >"$RACE_DIR/access-contender.log" 2>&1 <<'CONTEND_ACCESS'
set role service_role;
set lock_timeout='1s';
do $probe$
declare code text;
begin
  begin
    perform public.update_test_student_access_atomic(
      'c2550000-0000-4000-8000-000000000011',
      array['c2550000-0000-4000-8000-000000000002'::uuid],
      'open','c2550000-0000-4000-8000-000000000001');
    raise exception '244 access contender unexpectedly succeeded';
  exception when others then
    get stacked diagnostics code=returned_sqlstate;
    if code not in ('55P03','PT409') then raise exception '244 access contention code: %',code; end if;
  end;
end;
$probe$;
CONTEND_ACCESS
wait "$UNPUBLISH_HOLDER_PID"

# Reverse the ordering: a 244 access writer holds its transaction while the
# unpublication RPC must reject the occupied lifecycle lock as busy.
docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DATABASE_NAME" -X -A -t -v ON_ERROR_STOP=1 >"$RACE_DIR/access-holder.log" 2>&1 <<'HOLD_ACCESS' &
begin;
set local idle_in_transaction_session_timeout='12s';
set local role service_role;
select public.update_test_student_access_atomic(
 'c2550000-0000-4000-8000-000000000011',
 array['c2550000-0000-4000-8000-000000000002'::uuid],
 'open','c2550000-0000-4000-8000-000000000001') is not null;
select 'HOLD_READY';
select pg_sleep(5);
rollback;
HOLD_ACCESS
ACCESS_HOLDER_PID=$!
wait_for_race_holder "$ACCESS_HOLDER_PID" "$RACE_DIR/access-holder.log"
docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >"$RACE_DIR/unpublish-contender.log" 2>&1 <<'CONTEND_UNPUBLISH'
set role service_role;
do $probe$
declare code text; message text;
begin
  begin
    perform public.return_test_to_draft_atomic(
      'c2550000-0000-4000-8000-000000000001','c2550000-0000-4000-8000-000000000011');
    raise exception 'Unpublication contender unexpectedly succeeded';
  exception when others then
    get stacked diagnostics code=returned_sqlstate,message=message_text;
    if code <> 'PT409' or message <> 'test_unpublish_busy' then
      raise exception 'Unpublication contention result: % %',code,message;
    end if;
  end;
end;
$probe$;
CONTEND_UNPUBLISH
wait "$ACCESS_HOLDER_PID"

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'RACE_POST'
do $post$
begin
  if not exists(select 1 from public.tests where id='c2550000-0000-4000-8000-000000000011'
      and status='closed' and questions_locked_at is null)
    or exists(select 1 from public.assessment_drafts where assessment_type='test'
      and assessment_id='c2550000-0000-4000-8000-000000000011')
    or exists(select 1 from public.test_student_availability where test_id='c2550000-0000-4000-8000-000000000011') then
    raise exception 'Concurrent rollback left a changed Test graph';
  end if;
end;
$post$;
RACE_POST
echo 'Test unpublication versus 244 access: both lock orders PASS'
