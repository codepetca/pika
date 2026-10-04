#!/usr/bin/env bash
set -euo pipefail

# Canonical local container only; psql uses its local socket, never a remote URL.
# Rollback-only source fixture. Migration 241 must already be installed through
# the separately authorized workflow; this script never installs any migration.
# This single-session check does not claim cross-session visibility-race proof.
# UUIDs use hexadecimal c241; sc241 is the fixed textual fixture namespace.
CLASSWORK_MEMBER_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$CLASSWORK_MEMBER_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$CLASSWORK_MEMBER_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $check$
declare
  v_signature text;
  v_security_definer boolean;
  v_config text[];
  v_owner text;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '241') then
    raise exception 'Migration 241 is required; this harness never applies it';
  end if;
  foreach v_signature in array array[
    'public.save_assignment_doc_for_member_v1(uuid,uuid,jsonb,timestamp with time zone,text,integer,integer,jsonb,jsonb,integer,integer,uuid,bigint,uuid)',
    'public.submit_assignment_doc_for_member_v1(uuid,uuid,jsonb,timestamp with time zone,integer,integer,uuid[],boolean,jsonb)',
    'public.unsubmit_assignment_doc_for_member_v1(uuid,uuid)',
    'public.prepare_assignment_doc_submission_for_member_v1(uuid,uuid)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Migration 241 function is missing: %', v_signature;
    end if;
    if has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute')
      or not has_function_privilege('service_role', v_signature, 'execute')
      or exists (
        select 1 from pg_proc as procedure,
          lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as acl
        where procedure.oid = to_regprocedure(v_signature)
          and acl.privilege_type = 'EXECUTE'
          and acl.grantee not in (select oid from pg_roles where rolname in ('postgres', 'service_role'))
      )
    then raise exception 'Contextual Assignment member privileges are incorrect: %', v_signature; end if;
    select procedure.prosecdef, procedure.proconfig, owner.rolname
    into strict v_security_definer, v_config, v_owner
    from pg_proc as procedure join pg_roles as owner on owner.oid = procedure.proowner
    where procedure.oid = to_regprocedure(v_signature);
    if not v_security_definer
      or not coalesce(v_config @> array['search_path=""']::text[], false)
      or v_owner <> 'postgres'
    then raise exception 'Contextual Assignment member security metadata is incorrect: %', v_signature; end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'private.pal_membership_generations'::regclass
    and tgname = 'guard_pal_membership_evidence' and tgenabled = 'O')
  then raise exception 'Immutable migration 168 Pal evidence guard must remain enabled'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'private.pal_classroom_signal_settings'::regclass
    and tgname = 'guard_pal_signal_activation' and tgenabled = 'O')
  then raise exception 'Immutable migration 169 Pal activation guard must remain enabled'; end if;
  if not exists (select 1 from private.pal_membership_settings where singleton)
    or not exists (select 1 from private.pal_classroom_signal_settings where singleton)
    or exists (select 1 from private.pal_classroom_signal_settings where activated_at > clock_timestamp())
  then raise exception 'Expected current local Pal settings for rollback-only capture checks'; end if;

  -- Reserve the whole namespace, including retained evidence and scope digests.
  -- A collision fails before fixture writes; existing rows are never reused.
  if exists (select 1 from public.users where id::text like 'c241%' or email like 'sc241-%')
    or exists (select 1 from public.classrooms where id::text like 'c241%' or class_code like 'SC241%')
    or exists (select 1 from public.assignments where id::text like 'c241%' or classroom_id::text like 'c241%' or created_by::text like 'c241%')
    or exists (select 1 from public.classroom_enrollments where id::text like 'c241%' or classroom_id::text like 'c241%' or student_id::text like 'c241%')
    or exists (select 1 from public.classroom_roster where id::text like 'c241%' or classroom_id::text like 'c241%' or removed_enrollment_id::text like 'c241%' or removed_student_id::text like 'c241%' or email like 'sc241-%')
    or exists (select 1 from public.assignment_docs where id::text like 'c241%' or assignment_id::text like 'c241%' or student_id::text like 'c241%' or save_session_id::text like 'c241%')
    or exists (select 1 from public.assignment_doc_history where id::text like 'c241%' or assignment_doc_id::text like 'c241%')
    or exists (select 1 from public.assignment_doc_save_operations where id::text like 'c241%' or assignment_doc_id::text like 'c241%' or save_session_id::text like 'c241%' or metric_session_id::text like 'c241%')
    or exists (select 1 from public.assignment_submission_requirements where id::text like 'c241%' or assignment_id::text like 'c241%' or artifact_id::text like 'c241%')
    or exists (select 1 from public.assignment_submission_artifacts where id::text like 'c241%' or assignment_doc_id::text like 'c241%' or requirement_id::text like 'c241%' or student_id::text like 'c241%')
    or exists (select 1 from public.pal_event_outbox where id::text like 'c241%' or student_id::text like 'c241%' or source_id like 'c241%' or idempotency_key like 'pika:v1:pika-fact-sc241%')
    or exists (select 1 from private.pal_membership_outbox where outbox_id::text like 'c241%' or generation_id::text like 'c241%' or classroom_id::text like 'c241%' or student_id::text like 'c241%')
    or exists (select 1 from private.pal_membership_generations where generation_id::text like 'c241%')
    or exists (
      select 1 from private.pal_membership_generations identity
      cross join (values ('c2410000-0000-4000-8000-000000000010'::uuid),
        ('c2410000-0000-4000-8000-000000000011'::uuid),
        ('c2410000-0000-4000-8000-000000000012'::uuid)) as classrooms(id)
      cross join (values ('c2410000-0000-4000-8000-000000000001'::uuid),
        ('c2410000-0000-4000-8000-000000000002'::uuid),
        ('c2410000-0000-4000-8000-000000000003'::uuid),
        ('c2410000-0000-4000-8000-000000000004'::uuid)) as actors(id)
      where identity.scope_digest = private.pal_membership_scope(classrooms.id, actors.id)
    )
  then raise exception 'sc241 fixture namespace collision'; end if;
end;
$check$;

-- Schema 205 disallows stored SQL/JSON null and malformed nonboolean shapes.
-- Test those normalizer inputs directly, without relaxing stored constraints.
do $normalization$
declare v_case record;
begin
  for v_case in select * from (values
    (null::jsonb, false), ('null'::jsonb, false), ('{}'::jsonb, false),
    ('{"classwork":true}'::jsonb, false), ('{"classwork":false}'::jsonb, true),
    ('{"classwork":null}'::jsonb, false), ('{"classwork":"false"}'::jsonb, false),
    ('{"classwork":0}'::jsonb, false), ('{"classwork":[]}'::jsonb, false),
    ('{"classwork":{}}'::jsonb, false), ('false'::jsonb, false),
    ('"false"'::jsonb, false), ('0'::jsonb, false), ('[]'::jsonb, false),
    ('[{"classwork":false}]'::jsonb, false), ('{"tests":false}'::jsonb, false)
  ) as cases(visibility, hidden)
  loop
    if coalesce(jsonb_typeof(v_case.visibility) = 'object'
      and v_case.visibility->'classwork' = 'false'::jsonb, false) is distinct from v_case.hidden
    then raise exception 'Default-visible normalization value rejected'; end if;
  end loop;
end;
$normalization$;

-- Capture settings are transaction-local fixture changes; immutable 168 stays on.
update private.pal_membership_settings set enabled = false where singleton;
update private.pal_classroom_signal_settings set enabled = false where singleton;

insert into public.users (id, email, role) values
  ('c2410000-0000-4000-8000-000000000001', 'sc241-owner-student@example.invalid', 'student'),
  ('c2410000-0000-4000-8000-000000000002', 'sc241-member-teacher@example.invalid', 'teacher'),
  ('c2410000-0000-4000-8000-000000000003', 'sc241-member-student@example.invalid', 'student'),
  ('c2410000-0000-4000-8000-000000000004', 'sc241-outsider@example.invalid', 'student');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), 'c2410000-0000-4000-8000-000000000001',
  'classrooms.create', 'manual', true, clock_timestamp(), null, 10,
  'test:migration-241', 'sc241_assignment_member_classwork_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = 'c2410000-0000-4000-8000-000000000001'
      and feature_key = 'classrooms.create'), 0)
);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
  ('c2410000-0000-4000-8000-000000000010', 'c2410000-0000-4000-8000-000000000001', 'sc241 active', 'SC241LIVE', null),
  ('c2410000-0000-4000-8000-000000000011', 'c2410000-0000-4000-8000-000000000001', 'sc241 archived', 'SC241ARCH', clock_timestamp()),
  ('c2410000-0000-4000-8000-000000000012', 'c2410000-0000-4000-8000-000000000001', 'sc241 legacy Pal control', 'SC241PAL', null);

-- Historical owner self-enrollment must not grant learner authority.
insert into public.classroom_enrollments (id, classroom_id, student_id) values
  ('c2410000-0000-4000-8000-000000000101', 'c2410000-0000-4000-8000-000000000010', 'c2410000-0000-4000-8000-000000000001'),
  ('c2410000-0000-4000-8000-000000000102', 'c2410000-0000-4000-8000-000000000010', 'c2410000-0000-4000-8000-000000000002'),
  ('c2410000-0000-4000-8000-000000000103', 'c2410000-0000-4000-8000-000000000010', 'c2410000-0000-4000-8000-000000000003'),
  ('c2410000-0000-4000-8000-000000000104', 'c2410000-0000-4000-8000-000000000011', 'c2410000-0000-4000-8000-000000000001'),
  ('c2410000-0000-4000-8000-000000000105', 'c2410000-0000-4000-8000-000000000011', 'c2410000-0000-4000-8000-000000000002'),
  ('c2410000-0000-4000-8000-000000000106', 'c2410000-0000-4000-8000-000000000012', 'c2410000-0000-4000-8000-000000000002');

insert into public.assignments (id, classroom_id, title, description, due_at, created_by, is_draft, released_at) values
  ('c2410000-0000-4000-8000-000000000020', 'c2410000-0000-4000-8000-000000000010', 'sc241 missing work', '', clock_timestamp() + interval '7 days', 'c2410000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2410000-0000-4000-8000-000000000021', 'c2410000-0000-4000-8000-000000000010', 'sc241 submitted history', '', clock_timestamp() + interval '7 days', 'c2410000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2410000-0000-4000-8000-000000000022', 'c2410000-0000-4000-8000-000000000010', 'sc241 normalization', '', null, 'c2410000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2410000-0000-4000-8000-000000000023', 'c2410000-0000-4000-8000-000000000010', 'sc241 draft', '', null, 'c2410000-0000-4000-8000-000000000001', true, null),
  ('c2410000-0000-4000-8000-000000000024', 'c2410000-0000-4000-8000-000000000010', 'sc241 scheduled', '', null, 'c2410000-0000-4000-8000-000000000001', false, clock_timestamp() + interval '1 hour'),
  ('c2410000-0000-4000-8000-000000000025', 'c2410000-0000-4000-8000-000000000011', 'sc241 archived work', '', null, 'c2410000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2410000-0000-4000-8000-000000000026', 'c2410000-0000-4000-8000-000000000012', 'sc241 visible legacy Pal', '', clock_timestamp() + interval '7 days', 'c2410000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2410000-0000-4000-8000-000000000027', 'c2410000-0000-4000-8000-000000000010', 'sc241 writable historical work', '', null, 'c2410000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour');

insert into public.assignment_submission_requirements (id, assignment_id, type, label, required) values
  ('c2410000-0000-4000-8000-000000000301', 'c2410000-0000-4000-8000-000000000021', 'link', 'sc241 historical link', true),
  ('c2410000-0000-4000-8000-000000000302', 'c2410000-0000-4000-8000-000000000020', 'link', 'sc241 positive link', true);

-- Create nonempty draft/history/save-ledger evidence through the real save RPC.
set local role service_role;
do $history_fixture$
declare v_actor uuid; v_assignment uuid; v_result jsonb;
  v_content jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Fixture work"}]}]}'::jsonb;
begin
  foreach v_actor in array array['c2410000-0000-4000-8000-000000000002'::uuid, 'c2410000-0000-4000-8000-000000000003'::uuid] loop
    foreach v_assignment in array array['c2410000-0000-4000-8000-000000000021'::uuid, 'c2410000-0000-4000-8000-000000000027'::uuid] loop
      v_result := public.save_assignment_doc_for_member_v1(v_actor, v_assignment, v_content, null, 'autosave', 0, 12, '[]'::jsonb, v_content, 2, 12, gen_random_uuid(), 1, gen_random_uuid());
      if (v_result->>'ok')::boolean is distinct from true or (v_result->>'created')::boolean is distinct from true
      then raise exception 'sc241 historical save fixture failed'; end if;
    end loop;
  end loop;
end;
$history_fixture$;
reset role;

insert into public.assignment_submission_artifacts (id, assignment_doc_id, requirement_id, student_id, type, url, validation_status)
select case when student_id = 'c2410000-0000-4000-8000-000000000002' then 'c2410000-0000-4000-8000-000000000401'::uuid else 'c2410000-0000-4000-8000-000000000402'::uuid end,
  id, 'c2410000-0000-4000-8000-000000000301', student_id, 'link', 'https://sc241.example.invalid/work', 'valid'
from public.assignment_docs where assignment_id = 'c2410000-0000-4000-8000-000000000021';

set local role service_role;
do $submitted_fixture$
declare v_doc public.assignment_docs; v_result jsonb;
begin
  for v_doc in select * from public.assignment_docs where assignment_id = 'c2410000-0000-4000-8000-000000000021' loop
    v_result := public.submit_assignment_doc_for_member_v1(v_doc.student_id, v_doc.assignment_id, v_doc.content, v_doc.updated_at, 2, 12, '{}'::uuid[], false, null);
    if (v_result->>'ok')::boolean is distinct from true or (v_result->'doc'->>'is_submitted')::boolean is distinct from true
      or v_result->'history_entry'->>'trigger' is distinct from 'submit'
    then raise exception 'sc241 submitted history fixture failed'; end if;
  end loop;
end;
$submitted_fixture$;

-- Nonvacuous valid legacy completion control before hidden fingerprints.
do $legacy_pal_control$
declare v_result jsonb; v_revision timestamptz; v_now timestamptz := clock_timestamp();
  v_day date := (v_now at time zone 'America/Toronto')::date;
  v_content jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Pal work"}]}]}'::jsonb;
  v_event jsonb;
begin
  v_event := jsonb_build_object('schema_version', 1,
    'idempotency_key', 'pika:v1:pika-fact-sc241' || repeat('a', 38),
    'learner_id', 'pika-learner-' || repeat('b', 43), 'event_type', 'learning_item.completed',
    'occurred_at', v_now, 'metadata', jsonb_build_object('item_token', 'pika-item-' || repeat('c', 43),
      'kind', 'assignment', 'period_key', 'pika-week-' || to_char(v_day - (extract(isodow from v_day)::integer - 1), 'YYYY-MM-DD'), 'timing', 'on_time'));
  v_result := public.save_assignment_doc_for_member_v1('c2410000-0000-4000-8000-000000000002', 'c2410000-0000-4000-8000-000000000026', v_content, null, 'autosave', 0, 8, '[]'::jsonb, v_content, 2, 8, gen_random_uuid(), 1, gen_random_uuid());
  if (v_result->>'ok')::boolean is distinct from true then raise exception 'sc241 legacy save failed'; end if;
  v_revision := (v_result->'doc'->>'updated_at')::timestamptz;
  v_result := public.submit_assignment_doc_for_member_v1('c2410000-0000-4000-8000-000000000002', 'c2410000-0000-4000-8000-000000000026', v_content, v_revision, 2, 8, '{}'::uuid[], true, v_event);
  if (v_result->>'ok')::boolean is distinct from true
    or (select count(*) from public.pal_event_outbox where student_id = 'c2410000-0000-4000-8000-000000000002'
      and source_kind = 'assignment_first_completion' and source_id = 'c2410000-0000-4000-8000-000000000026'
      and idempotency_key = v_event->>'idempotency_key' and payload = v_event) <> 1
  then raise exception 'Visible legacy-Pal control did not enqueue exactly one valid event'; end if;
  v_result := public.submit_assignment_doc_for_member_v1('c2410000-0000-4000-8000-000000000002', 'c2410000-0000-4000-8000-000000000026', v_content, v_revision, 2, 8, '{}'::uuid[], true, v_event);
  if (v_result->>'idempotent')::boolean is distinct from true
    or (select count(*) from public.pal_event_outbox where student_id::text like 'c241%') <> 1
  then raise exception 'sc241 legacy Pal retry duplicated evidence'; end if;
end;
$legacy_pal_control$;
reset role;

update public.classrooms set feature_visibility = jsonb_set(feature_visibility, '{classwork}', 'false'::jsonb)
where id in ('c2410000-0000-4000-8000-000000000010', 'c2410000-0000-4000-8000-000000000011');

-- Run every denial with legacy and membership capture modes. Settings and all
-- evidence remain inside this same transaction. Each call is made as service_role;
-- the surrounding postgres block fingerprints private retained evidence too.
do $denials$
declare v_mode boolean; v_hidden boolean; v_case record; v_operation text; v_state text; v_message text;
  v_before jsonb; v_after jsonb; v_event jsonb; v_now timestamptz := clock_timestamp();
  v_day date := (v_now at time zone 'America/Toronto')::date;
  v_content jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Attempted hidden work"}]}]}'::jsonb;
begin
  v_event := jsonb_build_object('schema_version', 1,
    'idempotency_key', 'pika:v1:pika-fact-sc241' || repeat('d', 38),
    'learner_id', 'pika-learner-' || repeat('e', 43), 'event_type', 'learning_item.completed',
    'occurred_at', v_now, 'metadata', jsonb_build_object('item_token', 'pika-item-' || repeat('f', 43),
      'kind', 'assignment', 'period_key', 'pika-week-' || to_char(v_day - (extract(isodow from v_day)::integer - 1), 'YYYY-MM-DD'), 'timing', 'on_time'));
  foreach v_mode in array array[false, true] loop
    update private.pal_membership_settings set enabled = v_mode where singleton;
    -- Match the existing 240 rollback fixture: fresh databases have a null
    -- activation boundary. Never replace an already-established boundary.
    update private.pal_classroom_signal_settings
    set enabled = v_mode, activated_at = case when v_mode then coalesce(activated_at,
      date_trunc('week', clock_timestamp() at time zone 'America/Toronto') at time zone 'America/Toronto')
      else activated_at end
    where singleton;
    foreach v_hidden in array array[true, false] loop
      update public.classrooms set feature_visibility = jsonb_set(feature_visibility, '{classwork}', to_jsonb(not v_hidden))
      where id in ('c2410000-0000-4000-8000-000000000010', 'c2410000-0000-4000-8000-000000000011');
      for v_case in
        select actor, assignment, 'P0002'::text as expected_state, 'Assignment not found'::text as expected_message, 'Hidden missing/existing document changed whole-row evidence'::text as label
        from (values ('c2410000-0000-4000-8000-000000000002'::uuid), ('c2410000-0000-4000-8000-000000000003'::uuid)) actors(actor)
        cross join (values ('c2410000-0000-4000-8000-000000000020'::uuid), ('c2410000-0000-4000-8000-000000000021'::uuid), ('c2410000-0000-4000-8000-000000000027'::uuid)) assignments(assignment)
        where v_hidden
        union all
        select 'c2410000-0000-4000-8000-000000000001'::uuid, assignment, '42501', 'Forbidden', 'Owner denial lost precedence over hidden/archive/draft'
        from (values ('c2410000-0000-4000-8000-000000000020'::uuid), ('c2410000-0000-4000-8000-000000000023'::uuid), ('c2410000-0000-4000-8000-000000000025'::uuid)) assignments(assignment)
        union all
        select 'c2410000-0000-4000-8000-000000000002'::uuid, assignment, 'P0002', 'Assignment not found', 'Expected missing/archive/draft/scheduled concealment'
        from (values ('c2410000-0000-4000-8000-000000000029'::uuid), ('c2410000-0000-4000-8000-000000000023'::uuid), ('c2410000-0000-4000-8000-000000000024'::uuid), ('c2410000-0000-4000-8000-000000000025'::uuid)) assignments(assignment)
        union all
        select 'c2410000-0000-4000-8000-000000000004'::uuid, 'c2410000-0000-4000-8000-000000000026'::uuid, '42501', 'Forbidden', 'Expected outsider denial'
      loop
        foreach v_operation in array array['save', 'submit', 'unsubmit', 'prepare'] loop
          select jsonb_build_object(
            'docs', (select coalesce(jsonb_object_agg(d.id::text, to_jsonb(d)), '{}'::jsonb) from public.assignment_docs d where d.assignment_id::text like 'c241%'),
            'history', (select coalesce(jsonb_object_agg(h.id::text, to_jsonb(h)), '{}'::jsonb) from public.assignment_doc_history h join public.assignment_docs d on d.id = h.assignment_doc_id where d.assignment_id::text like 'c241%'),
            'save_operations', (select coalesce(jsonb_object_agg(o.id::text, to_jsonb(o)), '{}'::jsonb) from public.assignment_doc_save_operations o join public.assignment_docs d on d.id = o.assignment_doc_id where d.assignment_id::text like 'c241%'),
            'requirements', (select coalesce(jsonb_object_agg(r.id::text, to_jsonb(r)), '{}'::jsonb) from public.assignment_submission_requirements r where r.assignment_id::text like 'c241%'),
            'artifacts', (select coalesce(jsonb_object_agg(a.id::text, to_jsonb(a)), '{}'::jsonb) from public.assignment_submission_artifacts a where a.student_id::text like 'c241%'),
            'outbox', (select coalesce(jsonb_object_agg(o.id::text, to_jsonb(o)), '{}'::jsonb) from public.pal_event_outbox o where o.student_id::text like 'c241%'),
            'bindings', (select coalesce(jsonb_object_agg(b.outbox_id::text, to_jsonb(b)), '{}'::jsonb) from private.pal_membership_outbox b where b.student_id::text like 'c241%'),
            'generations', (select coalesce(jsonb_object_agg(g.generation_id::text, to_jsonb(g)), '{}'::jsonb) from private.pal_membership_generations g where g.generation_id::text like 'c241%')
          ) into v_before;
          v_state := null; v_message := null;
          set local role service_role;
          if current_user <> 'service_role' then raise exception 'sc241 denied RPC must run as service_role'; end if;
          begin
            case v_operation
              when 'save' then perform public.save_assignment_doc_for_member_v1(v_case.actor, v_case.assignment, v_content,
                (select updated_at from public.assignment_docs where assignment_id = v_case.assignment and student_id = v_case.actor),
                'autosave', 0, 20, '[]'::jsonb, v_content, 3, 20, gen_random_uuid(), 1, gen_random_uuid());
              when 'submit' then perform public.submit_assignment_doc_for_member_v1(v_case.actor, v_case.assignment, v_content,
                coalesce((select updated_at from public.assignment_docs where assignment_id = v_case.assignment and student_id = v_case.actor), clock_timestamp()), 3, 20, '{}'::uuid[], true, v_event);
              when 'unsubmit' then perform public.unsubmit_assignment_doc_for_member_v1(v_case.actor, v_case.assignment);
              when 'prepare' then perform public.prepare_assignment_doc_submission_for_member_v1(v_case.actor, v_case.assignment);
            end case;
          exception when others then get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
          end;
          reset role;
          if current_user <> 'postgres' then raise exception 'sc241 private evidence must run as postgres'; end if;
          if v_state is distinct from v_case.expected_state or v_message is distinct from v_case.expected_message
          then raise exception '%: % returned state %, message %', v_case.label, v_operation, v_state, v_message; end if;
          select jsonb_build_object(
            'docs', (select coalesce(jsonb_object_agg(d.id::text, to_jsonb(d)), '{}'::jsonb) from public.assignment_docs d where d.assignment_id::text like 'c241%'),
            'history', (select coalesce(jsonb_object_agg(h.id::text, to_jsonb(h)), '{}'::jsonb) from public.assignment_doc_history h join public.assignment_docs d on d.id = h.assignment_doc_id where d.assignment_id::text like 'c241%'),
            'save_operations', (select coalesce(jsonb_object_agg(o.id::text, to_jsonb(o)), '{}'::jsonb) from public.assignment_doc_save_operations o join public.assignment_docs d on d.id = o.assignment_doc_id where d.assignment_id::text like 'c241%'),
            'requirements', (select coalesce(jsonb_object_agg(r.id::text, to_jsonb(r)), '{}'::jsonb) from public.assignment_submission_requirements r where r.assignment_id::text like 'c241%'),
            'artifacts', (select coalesce(jsonb_object_agg(a.id::text, to_jsonb(a)), '{}'::jsonb) from public.assignment_submission_artifacts a where a.student_id::text like 'c241%'),
            'outbox', (select coalesce(jsonb_object_agg(o.id::text, to_jsonb(o)), '{}'::jsonb) from public.pal_event_outbox o where o.student_id::text like 'c241%'),
            'bindings', (select coalesce(jsonb_object_agg(b.outbox_id::text, to_jsonb(b)), '{}'::jsonb) from private.pal_membership_outbox b where b.student_id::text like 'c241%'),
            'generations', (select coalesce(jsonb_object_agg(g.generation_id::text, to_jsonb(g)), '{}'::jsonb) from private.pal_membership_generations g where g.generation_id::text like 'c241%')
          ) into v_after;
          if v_before is distinct from v_after then raise exception '%: % modified evidence', v_case.label, v_operation; end if;
        end loop;
      end loop;
    end loop;
  end loop;
end;
$denials$;

update public.classrooms set feature_visibility = default where id = 'c2410000-0000-4000-8000-000000000010';

set local role service_role;
do $visible_mixed_roles$
declare v_actor uuid; v_result jsonb; v_preflight jsonb; v_revision timestamptz; v_doc uuid;
  v_session uuid; v_metric uuid; v_history uuid;
  v_content jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Visible work"}]}]}'::jsonb;
begin
  foreach v_actor in array array['c2410000-0000-4000-8000-000000000002'::uuid, 'c2410000-0000-4000-8000-000000000003'::uuid] loop
    select updated_at into strict v_revision from public.assignment_docs
    where assignment_id = 'c2410000-0000-4000-8000-000000000027' and student_id = v_actor;
    v_result := public.save_assignment_doc_for_member_v1(v_actor, 'c2410000-0000-4000-8000-000000000027', v_content, v_revision, 'blur', 1, 20, '[]'::jsonb, v_content, 2, 12, gen_random_uuid(), 1, gen_random_uuid());
    if (v_result->>'ok')::boolean is distinct from true or (v_result->>'created')::boolean is distinct from false
      or v_result->'doc'->'content' is distinct from v_content
      or v_result->'history_entry'->>'assignment_doc_id' is distinct from v_result->'doc'->>'id'
      or (select count(*) from public.assignment_doc_save_operations where assignment_doc_id = (v_result->'doc'->>'id')::uuid) <> 2
    then raise exception 'Visible existing-document revision save failed'; end if;
    v_revision := null;
    v_session := gen_random_uuid(); v_metric := gen_random_uuid();
    v_result := public.prepare_assignment_doc_submission_for_member_v1(v_actor, 'c2410000-0000-4000-8000-000000000020');
    if v_result->'doc' is distinct from 'null'::jsonb
      or jsonb_array_length(v_result->'submission_requirements') <> 1
      or v_result->'submission_artifacts' is distinct from '[]'::jsonb
    then raise exception 'Visible missing-document preflight failed'; end if;
    v_result := public.save_assignment_doc_for_member_v1(v_actor, 'c2410000-0000-4000-8000-000000000020', v_content, null, 'autosave', 0, 12, '[]'::jsonb, v_content, 2, 12, v_session, 1, v_metric);
    v_doc := (v_result->'doc'->>'id')::uuid; v_revision := (v_result->'doc'->>'updated_at')::timestamptz;
    if (v_result->>'ok')::boolean is distinct from true or (v_result->>'created')::boolean is distinct from true
      or v_result->'doc'->>'student_id' is distinct from v_actor::text
      or v_result->'doc'->>'assignment_id' is distinct from 'c2410000-0000-4000-8000-000000000020'
      or v_result->'history_entry'->>'assignment_doc_id' is distinct from v_doc::text
    then raise exception 'Visible mixed-role save/submit/unsubmit/preflight contract failed'; end if;
    v_result := public.save_assignment_doc_for_member_v1(v_actor, 'c2410000-0000-4000-8000-000000000020', v_content, v_revision, 'autosave', 0, 12, '[]'::jsonb, null, 2, 12, v_session, 1, v_metric);
    if (v_result->>'ok')::boolean is distinct from true or v_result->'history_entry' is distinct from 'null'::jsonb
      or (select count(*) from public.assignment_doc_save_operations where assignment_doc_id = v_doc and save_session_id = v_session) <> 1
    then raise exception 'Visible idempotent save changed history or metrics'; end if;
    v_result := public.save_assignment_doc_for_member_v1(v_actor, 'c2410000-0000-4000-8000-000000000020', v_content, null, 'autosave', 0, 0, '[]'::jsonb, null, 2, 12, gen_random_uuid(), 1, gen_random_uuid());
    if (v_result->>'ok')::boolean is distinct from false or v_result->>'error_code' is distinct from 'assignment_doc_revision_required'
    then raise exception 'Visible save revision-required contract failed'; end if;
    v_result := public.save_assignment_doc_for_member_v1(v_actor, 'c2410000-0000-4000-8000-000000000020', v_content, v_revision - interval '1 second', 'autosave', 0, 0, '[]'::jsonb, null, 2, 12, gen_random_uuid(), 1, gen_random_uuid());
    if (v_result->>'ok')::boolean is distinct from false or v_result->>'error_code' is distinct from 'assignment_doc_revision_conflict'
    then raise exception 'Visible save revision-conflict contract failed'; end if;
    insert into public.assignment_submission_artifacts (assignment_doc_id, requirement_id, student_id, type, url, validation_status)
    values (v_doc, 'c2410000-0000-4000-8000-000000000302', v_actor, 'link', 'https://sc241.example.invalid/positive', 'valid');
    v_preflight := public.prepare_assignment_doc_submission_for_member_v1(v_actor, 'c2410000-0000-4000-8000-000000000020');
    if v_preflight->'doc'->>'id' is distinct from v_doc::text
      or v_preflight->'doc'->>'student_id' is distinct from v_actor::text
      or v_preflight->'assignment'->>'classroom_id' is distinct from 'c2410000-0000-4000-8000-000000000010'
      or jsonb_array_length(v_preflight->'submission_requirements') <> 1
      or jsonb_array_length(v_preflight->'submission_artifacts') <> 1
    then raise exception 'Visible mixed-role save/submit/unsubmit/preflight contract failed'; end if;
    v_result := public.submit_assignment_doc_for_member_v1(v_actor, 'c2410000-0000-4000-8000-000000000020', v_content, v_revision - interval '1 second', 2, 12, '{}'::uuid[], false, null);
    if (v_result->>'ok')::boolean is distinct from false or v_result->>'error_code' is distinct from 'assignment_doc_revision_conflict'
    then raise exception 'Visible submit revision-conflict contract failed'; end if;
    v_result := public.submit_assignment_doc_for_member_v1(v_actor, 'c2410000-0000-4000-8000-000000000020', v_content, v_revision, 2, 12, '{}'::uuid[], false, null);
    v_history := (v_result->'history_entry'->>'id')::uuid;
    if (v_result->>'ok')::boolean is distinct from true or (v_result->>'idempotent')::boolean is distinct from false
      or (v_result->'doc'->>'is_submitted')::boolean is distinct from true
      or v_result->>'classroom_id' is distinct from 'c2410000-0000-4000-8000-000000000010'
      or v_result->'history_entry'->>'assignment_doc_id' is distinct from v_doc::text
      or v_result->'history_entry'->'snapshot' is distinct from v_content
    then raise exception 'Visible mixed-role save/submit/unsubmit/preflight contract failed'; end if;
    v_result := public.submit_assignment_doc_for_member_v1(v_actor, 'c2410000-0000-4000-8000-000000000020', v_content, v_revision, 2, 12, '{}'::uuid[], false, null);
    if (v_result->>'idempotent')::boolean is distinct from true or v_result->'history_entry'->>'id' is distinct from v_history::text
    then raise exception 'Visible submit retry changed authoritative submit history'; end if;
    begin
      update public.assignment_submission_artifacts set validation_message = 'Attempted submitted change' where assignment_doc_id = v_doc;
      raise exception 'Visible submission artifact freeze failed';
    exception when check_violation then
      if sqlerrm <> 'assignment_artifact_submitted_document_immutable' then raise; end if;
    end;
    v_result := public.save_assignment_doc_for_member_v1(v_actor, 'c2410000-0000-4000-8000-000000000020', v_content, v_revision, 'autosave', 0, 0, '[]'::jsonb, null, 2, 12, gen_random_uuid(), 1, gen_random_uuid());
    if (v_result->>'ok')::boolean is distinct from false or v_result->>'error_code' is distinct from 'assignment_doc_submitted'
    then raise exception 'Visible submitted-document save protection failed'; end if;
    v_result := public.unsubmit_assignment_doc_for_member_v1(v_actor, 'c2410000-0000-4000-8000-000000000020');
    if (v_result->>'ok')::boolean is distinct from true or (v_result->'doc'->>'is_submitted')::boolean is distinct from false
      or v_result->'doc'->'submitted_at' is distinct from 'null'::jsonb
      or v_result->'doc'->>'id' is distinct from v_doc::text
      or v_result->>'classroom_id' is distinct from 'c2410000-0000-4000-8000-000000000010'
    then raise exception 'Visible mixed-role save/submit/unsubmit/preflight contract failed'; end if;
  end loop;
end;
$visible_mixed_roles$;
reset role;

do $membership_pal_control$
declare v_actor uuid;
begin
  foreach v_actor in array array['c2410000-0000-4000-8000-000000000002'::uuid, 'c2410000-0000-4000-8000-000000000003'::uuid] loop
    if (select count(*) from public.pal_event_outbox o join private.pal_membership_outbox b on b.outbox_id = o.id
      where b.classroom_id = 'c2410000-0000-4000-8000-000000000010' and b.student_id = v_actor and o.student_id = v_actor
        and o.source_kind = 'membership_v1' and o.source_id = b.generation_id::text
        and o.event_type = 'learning_item.completed' and o.payload->'metadata'->>'kind' = 'assignment') <> 1
    then raise exception 'Visible membership-Pal completion control failed'; end if;
  end loop;
end;
$membership_pal_control$;

-- Actual RPC checks for every persistable default-visible form under 205.
set local role service_role;
do $stored_normalization$
declare v_visibility jsonb; v_result jsonb; v_doc uuid; v_revision timestamptz;
  v_content jsonb := '{"type":"doc","content":[]}'::jsonb;
begin
  -- Current default is checked separately from partial/missing-key objects.
  update public.classrooms set feature_visibility = default where id = 'c2410000-0000-4000-8000-000000000010';
  foreach v_visibility in array array[(select feature_visibility from public.classrooms where id = 'c2410000-0000-4000-8000-000000000010'), '{}'::jsonb, '{"tests":false}'::jsonb, '{"classwork":true}'::jsonb] loop
    update public.classrooms set feature_visibility = v_visibility where id = 'c2410000-0000-4000-8000-000000000010';
    v_result := public.prepare_assignment_doc_submission_for_member_v1('c2410000-0000-4000-8000-000000000002', 'c2410000-0000-4000-8000-000000000022');
    if v_result->'assignment'->>'id' is distinct from 'c2410000-0000-4000-8000-000000000022'
    then raise exception 'Default-visible normalization value rejected'; end if;
    v_result := public.save_assignment_doc_for_member_v1('c2410000-0000-4000-8000-000000000002', 'c2410000-0000-4000-8000-000000000022', v_content, v_revision, 'autosave', 0, 0, '[]'::jsonb, v_content, 0, 0, gen_random_uuid(), 1, gen_random_uuid());
    if (v_result->>'ok')::boolean is distinct from true then raise exception 'Default-visible normalization value rejected'; end if;
    v_doc := (v_result->'doc'->>'id')::uuid; v_revision := (v_result->'doc'->>'updated_at')::timestamptz;
    v_result := public.submit_assignment_doc_for_member_v1('c2410000-0000-4000-8000-000000000002', 'c2410000-0000-4000-8000-000000000022', v_content, v_revision, 0, 0, '{}'::uuid[], false, null);
    if (v_result->>'ok')::boolean is distinct from true then raise exception 'Default-visible normalization value rejected'; end if;
    v_result := public.unsubmit_assignment_doc_for_member_v1('c2410000-0000-4000-8000-000000000002', 'c2410000-0000-4000-8000-000000000022');
    if (v_result->>'ok')::boolean is distinct from true or v_result->'doc'->>'id' is distinct from v_doc::text
    then raise exception 'Default-visible normalization value rejected'; end if;
    v_revision := (v_result->'doc'->>'updated_at')::timestamptz;
  end loop;
end;
$stored_normalization$;
reset role;

do $guard_preserved$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'private.pal_membership_generations'::regclass
    and tgname = 'guard_pal_membership_evidence' and tgenabled = 'O')
  then raise exception 'Migration 168 guard changed during the fixture'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'private.pal_classroom_signal_settings'::regclass
    and tgname = 'guard_pal_signal_activation' and tgenabled = 'O')
  then raise exception 'Migration 169 guard changed during the fixture'; end if;
end;
$guard_preserved$;

rollback;
SQL
