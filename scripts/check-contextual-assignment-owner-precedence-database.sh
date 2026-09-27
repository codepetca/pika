#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only. Migration 214 must be applied separately with exact
# target authorization. This harness never applies migrations or changes schema.
OWNER_PRECEDENCE_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$OWNER_PRECEDENCE_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$OWNER_PRECEDENCE_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $check$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '214') then
    raise exception 'Migration 214 is required; this harness never applies it';
  end if;
end;
$check$;

insert into public.users (id, email, role) values
  ('c2140000-0000-4000-8000-000000000001', 'owner-precedence-owner-student@example.invalid', 'student'),
  ('c2140000-0000-4000-8000-000000000002', 'owner-precedence-member-teacher@example.invalid', 'teacher'),
  ('c2140000-0000-4000-8000-000000000003', 'owner-precedence-owner-teacher@example.invalid', 'teacher'),
  ('c2140000-0000-4000-8000-000000000004', 'owner-precedence-member-student@example.invalid', 'student');

set local role service_role;
do $entitlements$
declare
  v_owner uuid;
begin
  foreach v_owner in array array[
    'c2140000-0000-4000-8000-000000000001'::uuid,
    'c2140000-0000-4000-8000-000000000003'::uuid
  ] loop
    perform public.set_effective_feature_entitlement_v1(
      gen_random_uuid(), v_owner, 'classrooms.create', 'manual', true,
      clock_timestamp(), null, 1, 'test:migration-214', 'owner_precedence_fixture',
      coalesce((select revision from public.effective_feature_entitlements
        where subject_user_id = v_owner and feature_key = 'classrooms.create'), 0)
    );
  end loop;
end;
$entitlements$;
reset role;

insert into public.classrooms (id, teacher_id, title, class_code) values
  ('c2140000-0000-4000-8000-000000000010', 'c2140000-0000-4000-8000-000000000001', 'Student-valued owner', 'C214ONE'),
  ('c2140000-0000-4000-8000-000000000011', 'c2140000-0000-4000-8000-000000000003', 'Teacher-valued owner', 'C214TWO');

-- Deliberately retain historical self-enrollments; the fix must not erase data.
insert into public.classroom_enrollments (classroom_id, student_id) values
  ('c2140000-0000-4000-8000-000000000010', 'c2140000-0000-4000-8000-000000000001'),
  ('c2140000-0000-4000-8000-000000000010', 'c2140000-0000-4000-8000-000000000002'),
  ('c2140000-0000-4000-8000-000000000011', 'c2140000-0000-4000-8000-000000000003'),
  ('c2140000-0000-4000-8000-000000000011', 'c2140000-0000-4000-8000-000000000004');

insert into public.assignments (id, classroom_id, title, description, due_at, created_by, is_draft, released_at) values
  ('c2140000-0000-4000-8000-000000000020', 'c2140000-0000-4000-8000-000000000010', 'Owner precedence one', '', clock_timestamp() + interval '7 days', 'c2140000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2140000-0000-4000-8000-000000000021', 'c2140000-0000-4000-8000-000000000011', 'Owner precedence two', '', clock_timestamp() + interval '7 days', 'c2140000-0000-4000-8000-000000000003', false, clock_timestamp() - interval '1 hour');

insert into public.assignment_submission_requirements (id, assignment_id, type, label, required, position) values
  ('c2140000-0000-4000-8000-000000000030', 'c2140000-0000-4000-8000-000000000020', 'repo_link', 'Repository', false, 0),
  ('c2140000-0000-4000-8000-000000000031', 'c2140000-0000-4000-8000-000000000021', 'repo_link', 'Repository', false, 0);

update private.pal_membership_settings set enabled = false;
update private.pal_classroom_signal_settings set enabled = false;

set local role service_role;
do $behavior$
declare
  v_fixture record;
  v_member uuid;
  v_result jsonb;
  v_before jsonb;
  v_after jsonb;
  v_content constant jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Historical work"}]}]}';
  v_doc_id uuid;
  v_updated_at timestamptz;
  v_operation integer;
begin
  for v_fixture in
    select assignment.id as assignment_id, classroom.id as classroom_id,
      classroom.teacher_id as owner_id, requirement.id as requirement_id
    from public.assignments assignment
    join public.classrooms classroom on classroom.id = assignment.classroom_id
    join public.assignment_submission_requirements requirement on requirement.assignment_id = assignment.id
    where assignment.id in ('c2140000-0000-4000-8000-000000000020', 'c2140000-0000-4000-8000-000000000021')
  loop
    select student_id into strict v_member from public.classroom_enrollments
      where classroom_id = v_fixture.classroom_id and student_id <> v_fixture.owner_id;

    begin
      perform public.open_assignment_doc_for_member_v1(v_fixture.owner_id, v_fixture.assignment_id, clock_timestamp(), null);
      raise exception 'Historical self-enrollment allowed owner to open/create learner document';
    exception when insufficient_privilege then null;
    end;
    if exists (select 1 from public.assignment_docs where assignment_id = v_fixture.assignment_id and student_id = v_fixture.owner_id) then
      raise exception 'Rejected owner open created a document';
    end if;

    -- Seed pre-existing work so every operation must enforce the relationship,
    -- rather than merely failing because an owner has no document yet.
    insert into public.assignment_docs (assignment_id, student_id, content, is_submitted)
      values (v_fixture.assignment_id, v_fixture.owner_id, v_content, false)
      returning id, updated_at into v_doc_id, v_updated_at;
    select to_jsonb(document) into v_before from public.assignment_docs document where id = v_doc_id;

    for v_operation in 1..10 loop
      begin
        case v_operation
          when 1 then perform public.open_assignment_doc_for_member_v1(v_fixture.owner_id, v_fixture.assignment_id, clock_timestamp(), null);
          when 2 then perform public.save_assignment_doc_for_member_v1(
            v_fixture.owner_id, v_fixture.assignment_id, v_content, v_updated_at, 'autosave',
            0, 0, null, v_content, 2, 15, gen_random_uuid(), 1, gen_random_uuid());
          when 3 then perform public.prepare_assignment_doc_submission_for_member_v1(v_fixture.owner_id, v_fixture.assignment_id);
          when 4 then perform public.submit_assignment_doc_for_member_v1(
            v_fixture.owner_id, v_fixture.assignment_id, v_content, v_updated_at, 2, 15, '{}'::uuid[], false, null);
          when 5 then perform public.unsubmit_assignment_doc_for_member_v1(v_fixture.owner_id, v_fixture.assignment_id);
          when 6 then perform public.get_assignment_doc_history_for_actor_v1(
            v_fixture.owner_id, v_fixture.assignment_id, v_member, true);
          when 7 then perform public.restore_assignment_doc_for_member_v1(
            v_fixture.owner_id, v_fixture.assignment_id, gen_random_uuid(), v_content,
            v_updated_at, null, v_content, 2, 15, gen_random_uuid(), 1, gen_random_uuid());
          when 8 then perform public.prepare_assignment_artifact_for_member_v1(
            v_fixture.owner_id, v_fixture.assignment_id, v_fixture.requirement_id);
          when 9 then perform public.upsert_assignment_artifact_for_member_v1(
            v_fixture.owner_id, v_fixture.assignment_id, v_fixture.requirement_id,
            'repo_link', 'https://github.com/codepetca/pika', null, '{}'::jsonb,
            'valid', null, clock_timestamp(), null, true, 'codepetca', 'valid', null);
          when 10 then perform public.delete_assignment_artifact_for_member_v1(
            v_fixture.owner_id, v_fixture.assignment_id, v_fixture.requirement_id);
        end case;
        raise exception 'Owner learner operation % was not forbidden', v_operation;
      exception when insufficient_privilege then null;
      end;
    end loop;

    select to_jsonb(document) into v_after from public.assignment_docs document where id = v_doc_id;
    if v_after is distinct from v_before
      or exists (select 1 from public.assignment_doc_history where assignment_doc_id = v_doc_id)
      or exists (select 1 from public.assignment_submission_artifacts where assignment_doc_id = v_doc_id)
      or exists (select 1 from public.user_github_identities where user_id = v_fixture.owner_id)
      or exists (select 1 from public.pal_event_outbox where student_id = v_fixture.owner_id)
    then
      raise exception 'Owner denial changed learner work, history, artifacts, identity or Pal';
    end if;

    v_result := public.open_assignment_doc_for_member_v1(v_member, v_fixture.assignment_id, clock_timestamp(), null);
    if v_result->'doc'->>'student_id' is distinct from v_member::text then
      raise exception 'Non-owner member lost access';
    end if;
    v_result := public.prepare_assignment_doc_submission_for_member_v1(v_member, v_fixture.assignment_id);
    if v_result->'doc'->>'student_id' is distinct from v_member::text then
      raise exception 'Non-owner member preflight lost access';
    end if;
    v_result := public.get_assignment_doc_history_for_actor_v1(v_member, v_fixture.assignment_id, null, true);
    if v_result->>'access_mode' is distinct from 'member' then
      raise exception 'Non-owner member history lost access';
    end if;
    v_result := public.get_assignment_doc_history_for_actor_v1(v_fixture.owner_id, v_fixture.assignment_id, v_member, false);
    if v_result->>'access_mode' is distinct from 'owner' or v_result->>'subject_id' is distinct from v_member::text then
      raise exception 'Owner history inspection lost access';
    end if;
    v_result := public.prepare_assignment_artifact_for_member_v1(v_member, v_fixture.assignment_id, v_fixture.requirement_id);
    if (v_result->>'ok')::boolean is distinct from true then
      raise exception 'Non-owner member artifact access failed';
    end if;
  end loop;
end;
$behavior$;

rollback;
SQL
