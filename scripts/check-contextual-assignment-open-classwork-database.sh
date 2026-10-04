#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only. Migration 240 must already be installed through the
# separately authorized migration workflow. No migration or schema changes here.
# All fixtures and temporary Pal capture settings roll back in this connection.
# This single-session fixture does not claim cross-session visibility-race proof.
CLASSWORK_OPEN_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$CLASSWORK_OPEN_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$CLASSWORK_OPEN_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $check$
declare
  v_signature text := 'public.open_assignment_doc_for_member_v1(uuid,uuid,timestamp with time zone,jsonb)';
  v_security_definer boolean;
  v_config text[];
  v_owner text;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '240')
    or to_regprocedure(v_signature) is null
  then
    raise exception 'Migration 240 is required; this harness never applies it';
  end if;
  if has_function_privilege('anon', v_signature, 'execute')
    or has_function_privilege('authenticated', v_signature, 'execute')
    or not has_function_privilege('service_role', v_signature, 'execute')
    or exists (
      select 1 from pg_proc as procedure,
        lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as acl
      where procedure.oid = to_regprocedure(v_signature)
        and acl.privilege_type = 'EXECUTE'
        and acl.grantee not in (
          select oid from pg_roles where rolname in ('postgres', 'service_role')
        )
    )
  then
    raise exception 'Contextual assignment-open privileges are incorrect';
  end if;
  select procedure.prosecdef, procedure.proconfig, owner.rolname
  into strict v_security_definer, v_config, v_owner
  from pg_proc as procedure
  join pg_namespace as namespace on namespace.oid = procedure.pronamespace
  join pg_roles as owner on owner.oid = procedure.proowner
  where namespace.nspname = 'public'
    and procedure.oid = to_regprocedure(v_signature);
  if not v_security_definer
    or not coalesce(v_config @> array['search_path=""']::text[], false)
    or v_owner <> 'postgres'
  then
    raise exception 'Contextual assignment-open security metadata is incorrect';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'private.pal_membership_generations'::regclass
      and tgname = 'guard_pal_membership_evidence' and tgenabled = 'O'
  ) then
    raise exception 'Immutable migration 168 Pal evidence guard must remain enabled';
  end if;
  if not exists (select 1 from private.pal_membership_settings where singleton)
    or not exists (select 1 from private.pal_classroom_signal_settings where singleton)
    or exists (select 1 from private.pal_classroom_signal_settings where activated_at > clock_timestamp())
  then
    raise exception 'Expected current local Pal settings for rollback-only capture checks';
  end if;

  -- Reserve the entire synthetic namespace, including retained identities. Fail
  -- closed instead of reusing, updating, or cleaning another fixture's rows.
  if exists (select 1 from public.users where id::text like 'c240%' or email like 'c240-%')
    or exists (select 1 from public.classrooms where id::text like 'c240%' or class_code like 'C240%')
    or exists (select 1 from public.assignments where id::text like 'c240%')
    or exists (select 1 from public.classroom_enrollments where id::text like 'c240%' or classroom_id::text like 'c240%' or student_id::text like 'c240%')
    or exists (select 1 from public.assignment_docs where id::text like 'c240%' or assignment_id::text like 'c240%' or student_id::text like 'c240%')
    or exists (select 1 from public.assignment_doc_history where id::text like 'c240%' or assignment_doc_id::text like 'c240%')
    or exists (select 1 from public.pal_event_outbox where student_id::text like 'c240%' or source_id like 'c240%'
      or idempotency_key = 'pika:v1:pika-fact-c240' || repeat('a', 39))
    or exists (select 1 from private.pal_membership_outbox where generation_id::text like 'c240%' or classroom_id::text like 'c240%' or student_id::text like 'c240%')
    or exists (select 1 from private.pal_membership_generations where generation_id::text like 'c240%')
    or exists (
      select 1 from private.pal_membership_generations identity
      cross join (values ('c2400000-0000-4000-8000-000000000010'::uuid),
        ('c2400000-0000-4000-8000-000000000011'::uuid),
        ('c2400000-0000-4000-8000-000000000012'::uuid)) as classrooms(id)
      cross join (values ('c2400000-0000-4000-8000-000000000001'::uuid),
        ('c2400000-0000-4000-8000-000000000002'::uuid),
        ('c2400000-0000-4000-8000-000000000003'::uuid),
        ('c2400000-0000-4000-8000-000000000004'::uuid)) as actors(id)
      where identity.scope_digest = private.pal_membership_scope(classrooms.id, actors.id)
    )
  then
    raise exception 'c240 fixture namespace collision';
  end if;
end;
$check$;

-- Some normalizer inputs cannot be persisted under the current shape/not-null
-- constraints. Check their SQL predicate directly without weakening the schema;
-- stored default/missing/boolean values are exercised through the actual RPC below.
do $normalization$
declare
  v_case record;
begin
  for v_case in select * from (values
    (null::jsonb, false), ('null'::jsonb, false), ('{}'::jsonb, false),
    ('{"classwork":true}'::jsonb, false), ('{"classwork":false}'::jsonb, true),
    ('{"classwork":null}'::jsonb, false), ('{"classwork":"false"}'::jsonb, false),
    ('{"classwork":0}'::jsonb, false), ('{"classwork":[]}'::jsonb, false),
    ('{"classwork":{}}'::jsonb, false), ('false'::jsonb, false),
    ('"false"'::jsonb, false), ('0'::jsonb, false), ('[]'::jsonb, false),
    ('[{"classwork":false}]'::jsonb, false)
  ) as cases(visibility, hidden)
  loop
    if coalesce(jsonb_typeof(v_case.visibility) = 'object'
      and v_case.visibility->'classwork' = 'false'::jsonb, false) is distinct from v_case.hidden
    then raise exception 'Default-visible normalization value rejected'; end if;
  end loop;
end;
$normalization$;

-- Disable capture only within this transaction while historical rows are seeded.
update private.pal_membership_settings set enabled = false where singleton;
update private.pal_classroom_signal_settings set enabled = false where singleton;

insert into public.users (id, email, role) values
  ('c2400000-0000-4000-8000-000000000001', 'c240-owner-student@example.invalid', 'student'),
  ('c2400000-0000-4000-8000-000000000002', 'c240-member-teacher@example.invalid', 'teacher'),
  ('c2400000-0000-4000-8000-000000000003', 'c240-member-student@example.invalid', 'student'),
  ('c2400000-0000-4000-8000-000000000004', 'c240-outsider@example.invalid', 'student');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), 'c2400000-0000-4000-8000-000000000001',
  'classrooms.create', 'manual', true, clock_timestamp(), null, 10,
  'test:migration-240', 'assignment_open_classwork_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = 'c2400000-0000-4000-8000-000000000001'
      and feature_key = 'classrooms.create'), 0)
);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
  ('c2400000-0000-4000-8000-000000000010', 'c2400000-0000-4000-8000-000000000001', 'Classwork open active', 'C240LIVE', null),
  ('c2400000-0000-4000-8000-000000000011', 'c2400000-0000-4000-8000-000000000001', 'Classwork open archived', 'C240ARCH', clock_timestamp()),
  ('c2400000-0000-4000-8000-000000000012', 'c2400000-0000-4000-8000-000000000001', 'Classwork legacy Pal control', 'C240PAL', null);

-- Historical owner self-enrollment remains intact; authorization must reject it.
insert into public.classroom_enrollments (id, classroom_id, student_id) values
  ('c2400000-0000-4000-8000-000000000101', 'c2400000-0000-4000-8000-000000000010', 'c2400000-0000-4000-8000-000000000001'),
  ('c2400000-0000-4000-8000-000000000102', 'c2400000-0000-4000-8000-000000000010', 'c2400000-0000-4000-8000-000000000002'),
  ('c2400000-0000-4000-8000-000000000103', 'c2400000-0000-4000-8000-000000000010', 'c2400000-0000-4000-8000-000000000003'),
  ('c2400000-0000-4000-8000-000000000104', 'c2400000-0000-4000-8000-000000000011', 'c2400000-0000-4000-8000-000000000002'),
  ('c2400000-0000-4000-8000-000000000105', 'c2400000-0000-4000-8000-000000000012', 'c2400000-0000-4000-8000-000000000002');

insert into public.assignments (id, classroom_id, title, description, due_at, created_by, is_draft, released_at) values
  ('c2400000-0000-4000-8000-000000000020', 'c2400000-0000-4000-8000-000000000010', 'Hidden missing document', '', clock_timestamp() + interval '7 days', 'c2400000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2400000-0000-4000-8000-000000000021', 'c2400000-0000-4000-8000-000000000010', 'Hidden historical document', '', clock_timestamp() + interval '7 days', 'c2400000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2400000-0000-4000-8000-000000000022', 'c2400000-0000-4000-8000-000000000010', 'Default and missing visibility', '', clock_timestamp() + interval '7 days', 'c2400000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2400000-0000-4000-8000-000000000023', 'c2400000-0000-4000-8000-000000000010', 'Draft', '', clock_timestamp() + interval '7 days', 'c2400000-0000-4000-8000-000000000001', true, null),
  ('c2400000-0000-4000-8000-000000000024', 'c2400000-0000-4000-8000-000000000010', 'Scheduled', '', clock_timestamp() + interval '7 days', 'c2400000-0000-4000-8000-000000000001', false, clock_timestamp() + interval '1 hour'),
  ('c2400000-0000-4000-8000-000000000025', 'c2400000-0000-4000-8000-000000000011', 'Archived', '', clock_timestamp() + interval '7 days', 'c2400000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2400000-0000-4000-8000-000000000026', 'c2400000-0000-4000-8000-000000000012', 'Visible legacy Pal control', '', clock_timestamp() + interval '7 days', 'c2400000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour');

insert into public.assignment_docs (id, assignment_id, student_id, content, viewed_at, returned_at, is_submitted) values
  ('c2400000-0000-4000-8000-000000000200', 'c2400000-0000-4000-8000-000000000021', 'c2400000-0000-4000-8000-000000000002',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Historical content"}]}]}'::jsonb,
   null, clock_timestamp() - interval '1 minute', false);

update public.classrooms set feature_visibility = jsonb_set(feature_visibility, '{classwork}', 'false'::jsonb)
where id = 'c2400000-0000-4000-8000-000000000010';

set local role service_role;
do $hidden_legacy$
declare
  v_actor uuid;
  v_viewed timestamptz := clock_timestamp();
  v_day date := (v_viewed at time zone 'America/Toronto')::date;
  v_event jsonb;
  v_before jsonb;
  v_docs_before jsonb;
  v_history_before jsonb;
  v_outbox_before jsonb;
  v_result jsonb;
begin
  v_event := jsonb_build_object(
    'schema_version', 1, 'idempotency_key', 'pika:v1:pika-fact-c240' || repeat('a', 39),
    'learner_id', 'pika-learner-' || repeat('b', 43), 'event_type', 'learning_item.viewed',
    'occurred_at', v_viewed, 'metadata', jsonb_build_object(
      'item_token', 'pika-item-' || repeat('c', 43), 'kind', 'assignment',
      'period_key', 'pika-week-' || to_char(v_day - (extract(isodow from v_day)::integer - 1), 'YYYY-MM-DD'),
      'timing', 'within_24h_of_release'
    )
  );
  -- A real visible create proves this non-null legacy event can enqueue before
  -- the same event is used to assert hidden opens preserve all row evidence.
  v_result := public.open_assignment_doc_for_member_v1('c2400000-0000-4000-8000-000000000002', 'c2400000-0000-4000-8000-000000000026', v_viewed, v_event);
  if (v_result->>'created')::boolean is distinct from true
    or (select count(*) from public.pal_event_outbox
      where student_id = 'c2400000-0000-4000-8000-000000000002'
        and source_kind = 'assignment_first_view'
        and source_id = 'c2400000-0000-4000-8000-000000000026'
        and idempotency_key = v_event->>'idempotency_key'
        and payload = v_event) <> 1
  then raise exception 'Visible legacy-Pal control did not enqueue exactly one valid event'; end if;
  v_result := public.open_assignment_doc_for_member_v1('c2400000-0000-4000-8000-000000000002', 'c2400000-0000-4000-8000-000000000026', v_viewed, v_event);
  if (v_result->>'created')::boolean is distinct from false
    or (select count(*) from public.pal_event_outbox where student_id::text like 'c240%') <> 1
  then raise exception 'Visible legacy-Pal retry duplicated document or outbox evidence'; end if;
  select coalesce(jsonb_object_agg(d.id::text, to_jsonb(d)), '{}'::jsonb) into v_docs_before
    from public.assignment_docs d where d.assignment_id::text like 'c240%';
  select coalesce(jsonb_object_agg(h.id::text, to_jsonb(h)), '{}'::jsonb) into v_history_before
    from public.assignment_doc_history h join public.assignment_docs d on d.id = h.assignment_doc_id where d.assignment_id::text like 'c240%';
  select coalesce(jsonb_object_agg(o.id::text, to_jsonb(o)), '{}'::jsonb) into v_outbox_before
    from public.pal_event_outbox o where o.student_id::text like 'c240%';
  foreach v_actor in array array['c2400000-0000-4000-8000-000000000002'::uuid, 'c2400000-0000-4000-8000-000000000003'::uuid]
  loop
    begin
      perform public.open_assignment_doc_for_member_v1(v_actor, 'c2400000-0000-4000-8000-000000000020', v_viewed, v_event);
      raise exception 'Expected hidden missing-document concealment';
    exception when no_data_found then null;
    end;
  end loop;
  if exists (select 1 from public.assignment_docs where assignment_id = 'c2400000-0000-4000-8000-000000000020')
    or v_docs_before is distinct from (select coalesce(jsonb_object_agg(d.id::text, to_jsonb(d)), '{}'::jsonb) from public.assignment_docs d where d.assignment_id::text like 'c240%')
    or v_history_before is distinct from (select coalesce(jsonb_object_agg(h.id::text, to_jsonb(h)), '{}'::jsonb) from public.assignment_doc_history h join public.assignment_docs d on d.id = h.assignment_doc_id where d.assignment_id::text like 'c240%')
    or v_outbox_before is distinct from (select coalesce(jsonb_object_agg(o.id::text, to_jsonb(o)), '{}'::jsonb) from public.pal_event_outbox o where o.student_id::text like 'c240%')
  then raise exception 'Hidden missing-document open changed document, history or Pal evidence'; end if;

  select to_jsonb(document) into strict v_before from public.assignment_docs document
    where id = 'c2400000-0000-4000-8000-000000000200';
  begin
    perform public.open_assignment_doc_for_member_v1('c2400000-0000-4000-8000-000000000002', 'c2400000-0000-4000-8000-000000000021', v_viewed, v_event);
    raise exception 'Expected hidden existing-document concealment';
  exception when no_data_found then null;
  end;
  if v_before is distinct from (select to_jsonb(document) from public.assignment_docs document where id = 'c2400000-0000-4000-8000-000000000200')
    or v_docs_before is distinct from (select coalesce(jsonb_object_agg(d.id::text, to_jsonb(d)), '{}'::jsonb) from public.assignment_docs d where d.assignment_id::text like 'c240%')
    or v_history_before is distinct from (select coalesce(jsonb_object_agg(h.id::text, to_jsonb(h)), '{}'::jsonb) from public.assignment_doc_history h join public.assignment_docs d on d.id = h.assignment_doc_id where d.assignment_id::text like 'c240%')
    or v_outbox_before is distinct from (select coalesce(jsonb_object_agg(o.id::text, to_jsonb(o)), '{}'::jsonb) from public.pal_event_outbox o where o.student_id::text like 'c240%')
  then raise exception 'Hidden existing-document open changed document, history or Pal evidence'; end if;
  begin
    perform public.open_assignment_doc_for_member_v1('c2400000-0000-4000-8000-000000000001', 'c2400000-0000-4000-8000-000000000020', v_viewed, null);
    raise exception 'Owner denial lost precedence over hidden Classwork';
  exception when insufficient_privilege then null;
  end;
end;
$hidden_legacy$;
reset role;

-- Exercise the existing membership trigger too, solely inside this rollback.
update private.pal_membership_settings set enabled = true where singleton;
update private.pal_classroom_signal_settings
set enabled = true, activated_at = coalesce(activated_at,
  date_trunc('week', clock_timestamp() at time zone 'America/Toronto') at time zone 'America/Toronto')
where singleton;

set local role service_role;
do $hidden_membership$
declare
  v_target uuid;
  v_before jsonb;
  v_docs_before jsonb;
  v_history_before jsonb;
  v_outbox_before jsonb;
begin
  select to_jsonb(document) into strict v_before from public.assignment_docs document
    where id = 'c2400000-0000-4000-8000-000000000200';
  select coalesce(jsonb_object_agg(d.id::text, to_jsonb(d)), '{}'::jsonb) into v_docs_before
    from public.assignment_docs d where d.assignment_id::text like 'c240%';
  select coalesce(jsonb_object_agg(h.id::text, to_jsonb(h)), '{}'::jsonb) into v_history_before
    from public.assignment_doc_history h join public.assignment_docs d on d.id = h.assignment_doc_id where d.assignment_id::text like 'c240%';
  select coalesce(jsonb_object_agg(o.id::text, to_jsonb(o)), '{}'::jsonb) into v_outbox_before
    from public.pal_event_outbox o where o.student_id::text like 'c240%';
  foreach v_target in array array['c2400000-0000-4000-8000-000000000020'::uuid, 'c2400000-0000-4000-8000-000000000021'::uuid]
  loop
    begin
      perform public.open_assignment_doc_for_member_v1('c2400000-0000-4000-8000-000000000002', v_target, clock_timestamp(), null);
      raise exception 'Expected hidden membership-Pal concealment';
    exception when no_data_found then null;
    end;
  end loop;
  if v_before is distinct from (select to_jsonb(document) from public.assignment_docs document where id = 'c2400000-0000-4000-8000-000000000200')
    or v_docs_before is distinct from (select coalesce(jsonb_object_agg(d.id::text, to_jsonb(d)), '{}'::jsonb) from public.assignment_docs d where d.assignment_id::text like 'c240%')
    or v_history_before is distinct from (select coalesce(jsonb_object_agg(h.id::text, to_jsonb(h)), '{}'::jsonb) from public.assignment_doc_history h join public.assignment_docs d on d.id = h.assignment_doc_id where d.assignment_id::text like 'c240%')
    or v_outbox_before is distinct from (select coalesce(jsonb_object_agg(o.id::text, to_jsonb(o)), '{}'::jsonb) from public.pal_event_outbox o where o.student_id::text like 'c240%')
  then raise exception 'Hidden membership-Pal open changed historical work or source evidence'; end if;
end;
$hidden_membership$;
reset role;

do $hidden_private_evidence$
begin
  if exists (select 1 from private.pal_membership_outbox where classroom_id::text like 'c240%' or student_id::text like 'c240%') then
    raise exception 'Hidden Classwork open created a membership-scoped Pal fact';
  end if;
end;
$hidden_private_evidence$;

update public.classrooms set feature_visibility = jsonb_set(feature_visibility, '{classwork}', 'true'::jsonb)
where id = 'c2400000-0000-4000-8000-000000000010';

set local role service_role;
do $visible$
declare
  v_actor uuid;
  v_target uuid;
  v_result jsonb;
  v_doc uuid;
begin
  foreach v_actor in array array['c2400000-0000-4000-8000-000000000002'::uuid, 'c2400000-0000-4000-8000-000000000003'::uuid]
  loop
    v_result := public.open_assignment_doc_for_member_v1(v_actor, 'c2400000-0000-4000-8000-000000000020', clock_timestamp(), null);
    v_doc := (v_result->'doc'->>'id')::uuid;
    if (v_result->>'ok')::boolean is distinct from true
      or (v_result->>'created')::boolean is distinct from true
      or (v_result->>'viewed_at_changed')::boolean is distinct from true
      or v_result->'doc'->>'student_id' is distinct from v_actor::text
      or v_result->'assignment'->>'id' is distinct from 'c2400000-0000-4000-8000-000000000020'
    then raise exception 'Visible teacher-valued and student-valued members must both open'; end if;
    v_result := public.open_assignment_doc_for_member_v1(v_actor, 'c2400000-0000-4000-8000-000000000020', clock_timestamp(), null);
    if (v_result->>'created')::boolean is distinct from false
      or (v_result->>'viewed_at_changed')::boolean is distinct from false
      or (v_result->'doc'->>'id')::uuid is distinct from v_doc
    then raise exception 'Visible retry changed the existing document'; end if;
  end loop;
  foreach v_target in array array['c2400000-0000-4000-8000-000000000023'::uuid, 'c2400000-0000-4000-8000-000000000024'::uuid, 'c2400000-0000-4000-8000-000000000025'::uuid]
  loop
    begin
      perform public.open_assignment_doc_for_member_v1('c2400000-0000-4000-8000-000000000002', v_target, clock_timestamp(), null);
      raise exception 'Expected archived/draft/scheduled concealment';
    exception when no_data_found then null;
    end;
  end loop;
  begin
    perform public.open_assignment_doc_for_member_v1('c2400000-0000-4000-8000-000000000004', 'c2400000-0000-4000-8000-000000000020', clock_timestamp(), null);
    raise exception 'Expected outsider denial';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.assignment_docs where assignment_id in ('c2400000-0000-4000-8000-000000000023', 'c2400000-0000-4000-8000-000000000024', 'c2400000-0000-4000-8000-000000000025')
      or (assignment_id::text like 'c240%' and student_id in ('c2400000-0000-4000-8000-000000000001', 'c2400000-0000-4000-8000-000000000004')))
  then raise exception 'An owner, outsider or unpublished open created learner work'; end if;
end;
$visible$;
reset role;

do $visible_private_evidence$
declare v_actor uuid;
begin
  foreach v_actor in array array['c2400000-0000-4000-8000-000000000002'::uuid, 'c2400000-0000-4000-8000-000000000003'::uuid]
  loop
    if (select count(*) from public.pal_event_outbox outbox
      join private.pal_membership_outbox binding on binding.outbox_id = outbox.id
      where binding.classroom_id = 'c2400000-0000-4000-8000-000000000010'
        and binding.student_id = v_actor and outbox.student_id = v_actor
        and outbox.source_kind = 'membership_v1' and outbox.source_id = binding.generation_id::text
        and outbox.event_type = 'learning_item.viewed'
        and outbox.payload->'metadata'->>'kind' = 'assignment') <> 1
    then raise exception 'Visible member did not emit exactly one bound first-view Pal fact'; end if;
  end loop;
end;
$visible_private_evidence$;

-- Existing schema permits missing keys. Exercise each admissible fallback via
-- the real RPC, including the database default, without altering constraints.
set local role service_role;
do $stored_normalization$
declare v_visibility jsonb; v_result jsonb;
begin
  update public.classrooms set feature_visibility = default where id = 'c2400000-0000-4000-8000-000000000010';
  v_result := public.open_assignment_doc_for_member_v1('c2400000-0000-4000-8000-000000000002', 'c2400000-0000-4000-8000-000000000022', clock_timestamp(), null);
  if (v_result->>'created')::boolean is distinct from true then raise exception 'Default-visible normalization value rejected'; end if;
  foreach v_visibility in array array['{}'::jsonb, '{"tests":false}'::jsonb, '{"classwork":true}'::jsonb]
  loop
    update public.classrooms set feature_visibility = v_visibility where id = 'c2400000-0000-4000-8000-000000000010';
    v_result := public.open_assignment_doc_for_member_v1('c2400000-0000-4000-8000-000000000002', 'c2400000-0000-4000-8000-000000000022', clock_timestamp(), null);
    if (v_result->>'ok')::boolean is distinct from true
      or v_result->'doc'->>'student_id' is distinct from 'c2400000-0000-4000-8000-000000000002'
    then raise exception 'Default-visible normalization value rejected'; end if;
  end loop;
end;
$stored_normalization$;
reset role;

do $guard_preserved$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'private.pal_membership_generations'::regclass
    and tgname = 'guard_pal_membership_evidence' and tgenabled = 'O')
  then raise exception 'Migration 168 guard changed during the fixture'; end if;
end;
$guard_preserved$;

rollback;
SQL
