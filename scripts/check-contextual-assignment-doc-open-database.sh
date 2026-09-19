#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavioral fixture. It never applies migrations and
# leaves no durable rows. Run only after separately authorized migrations 182
# and 183.
ASSIGNMENT_OPEN_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$ASSIGNMENT_OPEN_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$ASSIGNMENT_OPEN_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $check$
declare
  v_signature text := 'public.open_assignment_doc_for_member_v1(uuid,uuid,timestamp with time zone,jsonb)';
  v_security_definer boolean;
  v_config text[];
  v_owner text;
begin
  if to_regprocedure(v_signature) is null then
    raise exception 'Migration 182 is required; this harness never applies it';
  end if;
  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '183'
  ) then
    raise exception 'Migration 183 is required; this harness never applies it';
  end if;
  if has_function_privilege('anon', v_signature, 'execute')
    or has_function_privilege('authenticated', v_signature, 'execute')
    or not has_function_privilege('service_role', v_signature, 'execute')
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
    or not (v_config @> array['search_path=""']::text[])
    or v_owner <> 'postgres'
  then
    raise exception 'Contextual assignment-open security metadata is incorrect';
  end if;
end;
$check$;

insert into public.users (id, email, role) values
  ('c1820000-0000-4000-8000-000000000001', 'assignment-open-member@example.invalid', 'teacher'),
  ('c1820000-0000-4000-8000-000000000002', 'assignment-open-owner@example.invalid', 'student'),
  ('c1820000-0000-4000-8000-000000000003', 'assignment-open-outsider@example.invalid', 'student');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(),
  'c1820000-0000-4000-8000-000000000002',
  'classrooms.create',
  'manual',
  true,
  clock_timestamp(),
  null,
  10,
  'test:migration-182',
  'assignment_open_fixture',
  coalesce((
    select revision
    from public.effective_feature_entitlements
    where subject_user_id = 'c1820000-0000-4000-8000-000000000002'
      and feature_key = 'classrooms.create'
  ), 0)
);
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(),
  'c1820000-0000-4000-8000-000000000001',
  'classrooms.create',
  'manual',
  true,
  clock_timestamp(),
  null,
  1,
  'test:migration-182',
  'assignment_open_owner_fixture',
  coalesce((
    select revision
    from public.effective_feature_entitlements
    where subject_user_id = 'c1820000-0000-4000-8000-000000000001'
      and feature_key = 'classrooms.create'
  ), 0)
);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
  ('c1820000-0000-4000-8000-000000000010', 'c1820000-0000-4000-8000-000000000002', 'Assignment open active', 'C182LIVE', null),
  ('c1820000-0000-4000-8000-000000000011', 'c1820000-0000-4000-8000-000000000002', 'Assignment open archived', 'C182ARCH', clock_timestamp()),
  ('c1820000-0000-4000-8000-000000000012', 'c1820000-0000-4000-8000-000000000001', 'Assignment open owned', 'C182OWN', null);

insert into public.classroom_enrollments (classroom_id, student_id) values
  ('c1820000-0000-4000-8000-000000000010', 'c1820000-0000-4000-8000-000000000001'),
  ('c1820000-0000-4000-8000-000000000011', 'c1820000-0000-4000-8000-000000000001');

insert into public.assignments (
  id, classroom_id, title, description, due_at, created_by, is_draft, released_at
) values
  ('c1820000-0000-4000-8000-000000000020', 'c1820000-0000-4000-8000-000000000010', 'Live assignment', '', clock_timestamp() + interval '7 days', 'c1820000-0000-4000-8000-000000000002', false, clock_timestamp() - interval '1 hour'),
  ('c1820000-0000-4000-8000-000000000021', 'c1820000-0000-4000-8000-000000000010', 'Draft assignment', '', clock_timestamp() + interval '7 days', 'c1820000-0000-4000-8000-000000000002', true, null),
  ('c1820000-0000-4000-8000-000000000022', 'c1820000-0000-4000-8000-000000000010', 'Scheduled assignment', '', clock_timestamp() + interval '7 days', 'c1820000-0000-4000-8000-000000000002', false, clock_timestamp() + interval '1 hour'),
  ('c1820000-0000-4000-8000-000000000023', 'c1820000-0000-4000-8000-000000000011', 'Archived assignment', '', clock_timestamp() + interval '7 days', 'c1820000-0000-4000-8000-000000000002', false, clock_timestamp() - interval '1 hour'),
  ('c1820000-0000-4000-8000-000000000024', 'c1820000-0000-4000-8000-000000000012', 'Owner-only assignment', '', clock_timestamp() + interval '7 days', 'c1820000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c1820000-0000-4000-8000-000000000025', 'c1820000-0000-4000-8000-000000000010', 'Teacher member signal', '', clock_timestamp() + interval '7 days', 'c1820000-0000-4000-8000-000000000002', false, clock_timestamp() - interval '1 hour'),
  ('c1820000-0000-4000-8000-000000000026', 'c1820000-0000-4000-8000-000000000010', 'Student member signal', '', clock_timestamp() + interval '7 days', 'c1820000-0000-4000-8000-000000000002', false, clock_timestamp() - interval '1 hour');

update private.pal_membership_settings set enabled = false;
update private.pal_classroom_signal_settings set enabled = false;

set local role service_role;
do $behavior$
declare
  v_actor constant uuid := 'c1820000-0000-4000-8000-000000000001';
  v_outsider constant uuid := 'c1820000-0000-4000-8000-000000000003';
  v_live constant uuid := 'c1820000-0000-4000-8000-000000000020';
  v_viewed timestamptz := clock_timestamp();
  v_second_view timestamptz;
  v_period_day date;
  v_period text;
  v_event jsonb;
  v_result jsonb;
  v_doc_id uuid;
  v_updated_at timestamptz;
begin
  v_period_day := (v_viewed at time zone 'America/Toronto')::date;
  v_period := 'pika-week-' || to_char(
    v_period_day - (extract(isodow from v_period_day)::integer - 1),
    'YYYY-MM-DD'
  );
  v_event := jsonb_build_object(
    'schema_version', 1,
    'idempotency_key', 'pika:v1:pika-fact-' || repeat('a', 43),
    'learner_id', 'pika-learner-' || repeat('b', 43),
    'event_type', 'learning_item.viewed',
    'occurred_at', v_viewed,
    'metadata', jsonb_build_object(
      'item_token', 'pika-item-' || repeat('c', 43),
      'kind', 'assignment',
      'period_key', v_period,
      'timing', 'within_24h_of_release'
    )
  );

  v_result := public.open_assignment_doc_for_member_v1(v_actor, v_live, v_viewed, v_event);
  v_doc_id := (v_result->'doc'->>'id')::uuid;
  if not (v_result->>'ok')::boolean
    or not (v_result->>'created')::boolean
    or not (v_result->>'viewed_at_changed')::boolean
    or v_result->'assignment'->>'id' is distinct from v_live::text
    or v_result->'doc'->>'assignment_id' is distinct from v_live::text
    or v_result->'doc'->>'student_id' is distinct from v_actor::text
  then
    raise exception 'Live member open returned invalid evidence: %', v_result;
  end if;
  if not exists (
    select 1 from public.pal_event_outbox
    where student_id = v_actor
      and source_kind = 'assignment_first_view'
      and source_id = v_live::text
      and idempotency_key = 'pika:v1:pika-fact-' || repeat('a', 43)
  ) then
    raise exception 'First open did not atomically enqueue its legacy Pal event';
  end if;

  v_result := public.open_assignment_doc_for_member_v1(
    v_actor, v_live, v_viewed + interval '1 minute', null
  );
  if (v_result->>'created')::boolean or (v_result->>'viewed_at_changed')::boolean
    or (v_result->'doc'->>'id')::uuid is distinct from v_doc_id
  then
    raise exception 'Idempotent open changed an already viewed document: %', v_result;
  end if;
  if (select count(*) from public.pal_event_outbox where source_kind = 'assignment_first_view' and source_id = v_live::text) <> 1 then
    raise exception 'Idempotent open duplicated the Pal event';
  end if;

  v_second_view := v_viewed + interval '2 minutes';
  update public.assignment_docs
  set returned_at = v_viewed + interval '90 seconds'
  where id = v_doc_id;
  v_result := public.open_assignment_doc_for_member_v1(v_actor, v_live, v_second_view, null);
  if (v_result->>'created')::boolean
    or not (v_result->>'viewed_at_changed')::boolean
    or (v_result->'doc'->>'viewed_at')::timestamptz is distinct from v_second_view
  then
    raise exception 'Returned-work open did not refresh viewed_at: %', v_result;
  end if;
  select updated_at into v_updated_at from public.assignment_docs where id = v_doc_id;
  v_result := public.open_assignment_doc_for_member_v1(
    v_actor, v_live, v_second_view + interval '1 minute', null
  );
  if (v_result->>'viewed_at_changed')::boolean
    or (select updated_at from public.assignment_docs where id = v_doc_id) is distinct from v_updated_at
  then
    raise exception 'No-op open rewrote an already acknowledged document';
  end if;

  begin
    perform public.open_assignment_doc_for_member_v1(v_outsider, v_live, v_viewed, null);
    raise exception 'Expected nonmember denial';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.open_assignment_doc_for_member_v1(v_actor, 'c1820000-0000-4000-8000-000000000021', v_viewed, null);
    raise exception 'Expected draft concealment';
  exception when no_data_found then null;
  end;
  begin
    perform public.open_assignment_doc_for_member_v1(v_actor, 'c1820000-0000-4000-8000-000000000022', v_viewed, null);
    raise exception 'Expected scheduled concealment';
  exception when no_data_found then null;
  end;
  begin
    perform public.open_assignment_doc_for_member_v1(v_actor, 'c1820000-0000-4000-8000-000000000023', v_viewed, null);
    raise exception 'Expected archived concealment';
  exception when no_data_found then null;
  end;
  begin
    perform public.open_assignment_doc_for_member_v1(v_actor, 'c1820000-0000-4000-8000-000000000024', v_viewed, null);
    raise exception 'Expected owner-without-enrollment denial';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.open_assignment_doc_for_member_v1(
      v_actor,
      v_live,
      v_viewed,
      v_event || jsonb_build_object('event_type', 'learning_item.completed')
    );
    raise exception 'Expected malformed Pal event denial';
  exception when invalid_parameter_value then null;
  end;

  if exists (
    select 1 from public.assignment_docs
    where assignment_id <> v_live
      and student_id in (v_actor, v_outsider)
  ) then
    raise exception 'Denied assignment open wrote a document';
  end if;
end;
$behavior$;
reset role;

-- A legacy-global-role value must not suppress membership-scoped Pal identity.
-- Add the student control before activation so the join itself is not captured.
insert into public.classroom_enrollments (classroom_id, student_id) values
  ('c1820000-0000-4000-8000-000000000010', 'c1820000-0000-4000-8000-000000000003');
update private.pal_membership_settings set enabled = true;
update private.pal_classroom_signal_settings
set enabled = true,
    activated_at = coalesce(
      activated_at,
      date_trunc('week', clock_timestamp() at time zone 'America/Toronto')
        at time zone 'America/Toronto'
    );

set local role service_role;
do $membership_pal$
declare
  v_teacher_member constant uuid := 'c1820000-0000-4000-8000-000000000001';
  v_student_member constant uuid := 'c1820000-0000-4000-8000-000000000003';
  v_nonmember_owner constant uuid := 'c1820000-0000-4000-8000-000000000002';
  v_classroom constant uuid := 'c1820000-0000-4000-8000-000000000010';
  v_teacher_assignment constant uuid := 'c1820000-0000-4000-8000-000000000025';
  v_student_assignment constant uuid := 'c1820000-0000-4000-8000-000000000026';
  v_result jsonb;
begin
  if public.resolve_pal_membership(v_teacher_member, v_classroom)->>'status' <> 'active'
    or public.resolve_pal_membership(v_student_member, v_classroom)->>'status' <> 'active'
  then
    raise exception 'Exact enrollment did not resolve Pal identity across legacy roles';
  end if;
  if public.resolve_pal_membership(v_nonmember_owner, v_classroom) <> '{"status":"forbidden"}'::jsonb then
    raise exception 'Classroom ownership without enrollment resolved member Pal identity';
  end if;

  v_result := public.open_assignment_doc_for_member_v1(
    v_teacher_member, v_teacher_assignment, clock_timestamp(), null
  );
  if not (v_result->>'created')::boolean then
    raise exception 'Teacher-valued member document was not created: %', v_result;
  end if;
  v_result := public.open_assignment_doc_for_member_v1(
    v_student_member, v_student_assignment, clock_timestamp(), null
  );
  if not (v_result->>'created')::boolean then
    raise exception 'Student-valued member document was not created: %', v_result;
  end if;

  v_result := public.open_assignment_doc_for_member_v1(
    v_teacher_member, v_teacher_assignment, clock_timestamp() + interval '1 minute', null
  );
  if (v_result->>'created')::boolean then
    raise exception 'Teacher-valued member retry created a second document';
  end if;
  v_result := public.open_assignment_doc_for_member_v1(
    v_student_member, v_student_assignment, clock_timestamp() + interval '1 minute', null
  );
  if (v_result->>'created')::boolean then
    raise exception 'Student-valued member retry created a second document';
  end if;
end;
$membership_pal$;
reset role;

do $membership_pal_evidence$
declare
  v_teacher_member constant uuid := 'c1820000-0000-4000-8000-000000000001';
  v_student_member constant uuid := 'c1820000-0000-4000-8000-000000000003';
  v_classroom constant uuid := 'c1820000-0000-4000-8000-000000000010';
begin
  if (
    select count(*)
    from public.pal_event_outbox as outbox
    join private.pal_membership_outbox as binding on binding.outbox_id = outbox.id
    where binding.classroom_id = v_classroom
      and binding.student_id = v_teacher_member
      and outbox.student_id = v_teacher_member
      and outbox.source_kind = 'membership_v1'
      and outbox.source_id = binding.generation_id::text
      and outbox.event_type = 'learning_item.viewed'
      and outbox.payload->'metadata'->>'kind' = 'assignment'
  ) <> 1 then
    raise exception 'Teacher-valued exact member did not emit one bound first-view fact';
  end if;
  if (
    select count(*)
    from public.pal_event_outbox as outbox
    join private.pal_membership_outbox as binding on binding.outbox_id = outbox.id
    where binding.classroom_id = v_classroom
      and binding.student_id = v_student_member
      and outbox.student_id = v_student_member
      and outbox.source_kind = 'membership_v1'
      and outbox.source_id = binding.generation_id::text
      and outbox.event_type = 'learning_item.viewed'
      and outbox.payload->'metadata'->>'kind' = 'assignment'
  ) <> 1 then
    raise exception 'Student-valued exact member did not emit one bound first-view fact';
  end if;
  if (
    select count(*)
    from public.pal_event_outbox as outbox
    join private.pal_membership_outbox as binding on binding.outbox_id = outbox.id
    where binding.classroom_id = v_classroom
      and binding.student_id in (v_teacher_member, v_student_member)
      and outbox.event_type = 'learning_item.viewed'
  ) <> 2 then
    raise exception 'Assignment-open retries duplicated membership-scoped first-view facts';
  end if;
end;
$membership_pal_evidence$;

rollback;
SQL

echo 'Contextual assignment-open visibility, role-neutral membership, idempotency, refresh, Pal, and privilege contracts passed.'
