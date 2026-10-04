#!/usr/bin/env bash
set -euo pipefail

# Canonical local container only; psql uses its local socket, never a remote URL.
# Rollback-only source fixture. Migration 242 must already be installed through
# the separately authorized workflow; this script never installs any migration.
# This single-session check does not claim cross-session visibility-race proof.
# UUIDs use hexadecimal c242; sc242 is the fixed textual fixture namespace.
SUPPLEMENT_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$SUPPLEMENT_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$SUPPLEMENT_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
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
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '242') then
    raise exception 'Migration 242 is required; this harness never applies it';
  end if;
  foreach v_signature in array array[
    'public.get_assignment_doc_history_for_actor_v1(uuid,uuid,uuid,boolean)',
    'public.restore_assignment_doc_for_member_v1(uuid,uuid,uuid,jsonb,timestamp with time zone,jsonb,jsonb,integer,integer,uuid,bigint,uuid)',
    'public.prepare_assignment_artifact_for_member_v1(uuid,uuid,uuid)',
    'public.upsert_assignment_artifact_for_member_v1(uuid,uuid,uuid,text,text,text,jsonb,text,text,timestamp with time zone,uuid,boolean,text,text,text)',
    'public.delete_assignment_artifact_for_member_v1(uuid,uuid,uuid)',
    'public.reserve_assignment_inline_image_for_member_v1(uuid,uuid,uuid,uuid,text,text,bigint)',
    'public.finalize_assignment_inline_image_for_member_v1(uuid,uuid,uuid,uuid)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Migration 242 function is missing: %', v_signature;
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
  foreach v_signature in array array[
    'private.lock_assignment_artifact_member_context_v1(uuid,uuid,uuid)',
    'private.lock_assignment_inline_image_member_context_v1(uuid,uuid)'
  ] loop
    if to_regprocedure(v_signature) is null then raise exception 'Missing private helper: %', v_signature; end if;
    select procedure.prosecdef, procedure.proconfig, owner.rolname
    into strict v_security_definer, v_config, v_owner
    from pg_proc procedure join pg_roles owner on owner.oid = procedure.proowner where procedure.oid = to_regprocedure(v_signature);
    if v_security_definer or not coalesce(v_config @> array['search_path=""']::text[], false) or v_owner <> 'postgres'
      or has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute')
      or has_function_privilege('service_role', v_signature, 'execute')
      or exists (select 1 from pg_proc procedure, lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
        where procedure.oid = to_regprocedure(v_signature) and acl.privilege_type = 'EXECUTE' and acl.grantee <> procedure.proowner)
    then raise exception 'Private helper metadata/ACL changed: %', v_signature; end if;
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
  if exists (select 1 from public.users where id::text like 'c242%' or email like 'sc242-%')
    or exists (select 1 from public.classrooms where id::text like 'c242%' or class_code like 'SC242%')
    or exists (select 1 from public.assignments where id::text like 'c242%' or classroom_id::text like 'c242%' or created_by::text like 'c242%')
    or exists (select 1 from public.classroom_enrollments where id::text like 'c242%' or classroom_id::text like 'c242%' or student_id::text like 'c242%')
    or exists (select 1 from public.classroom_roster where id::text like 'c242%' or classroom_id::text like 'c242%' or removed_enrollment_id::text like 'c242%' or removed_student_id::text like 'c242%' or email like 'sc242-%')
    or exists (select 1 from public.assignment_docs where id::text like 'c242%' or assignment_id::text like 'c242%' or student_id::text like 'c242%' or save_session_id::text like 'c242%')
    or exists (select 1 from public.assignment_doc_history where id::text like 'c242%' or assignment_doc_id::text like 'c242%')
    or exists (select 1 from public.assignment_doc_save_operations where id::text like 'c242%' or assignment_doc_id::text like 'c242%' or save_session_id::text like 'c242%' or metric_session_id::text like 'c242%')
    or exists (select 1 from public.assignment_submission_requirements where id::text like 'c242%' or assignment_id::text like 'c242%' or artifact_id::text like 'c242%')
    or exists (select 1 from public.assignment_submission_artifacts where id::text like 'c242%' or assignment_doc_id::text like 'c242%' or requirement_id::text like 'c242%' or student_id::text like 'c242%')
    or exists (select 1 from public.pal_event_outbox where id::text like 'c242%' or student_id::text like 'c242%' or source_id like 'c242%' or idempotency_key like 'pika:v1:pika-fact-sc242%')
    or exists (select 1 from private.pal_membership_outbox where outbox_id::text like 'c242%' or generation_id::text like 'c242%' or classroom_id::text like 'c242%' or student_id::text like 'c242%')
    or exists (select 1 from private.pal_membership_generations where generation_id::text like 'c242%')
    or exists (select 1 from public.managed_storage_objects where id::text like 'c242%' or classroom_id::text like 'c242%' or resource_id::text like 'c242%' or storage_path like 'sc242/%' or storage_path like 'classrooms/c242%')
    or exists (select 1 from storage.objects where id::text like 'c242%' or name like 'sc242/%' or name like 'classrooms/c242%')
    or exists (select 1 from public.assignment_artifact_storage_cleanup where id::text like 'c242%' or storage_path like 'sc242/%' or storage_path like 'classrooms/c242%')
    or exists (select 1 from public.effective_feature_entitlement_audit where subject_user_id::text like 'c242%' or operation_id::text like 'c242%')
    or exists (select 1 from public.user_github_identities where user_id::text like 'c242%')
    or exists (
      select 1 from private.pal_membership_generations identity
      cross join (values ('c2420000-0000-4000-8000-000000000010'::uuid),
        ('c2420000-0000-4000-8000-000000000011'::uuid),
        ('c2420000-0000-4000-8000-000000000012'::uuid)) as classrooms(id)
      cross join (values ('c2420000-0000-4000-8000-000000000001'::uuid),
        ('c2420000-0000-4000-8000-000000000002'::uuid),
        ('c2420000-0000-4000-8000-000000000003'::uuid),
        ('c2420000-0000-4000-8000-000000000004'::uuid)) as actors(id)
      where identity.scope_digest = private.pal_membership_scope(classrooms.id, actors.id)
    )
  then raise exception 'sc242 fixture namespace collision'; end if;
end;
$check$;

-- Migration 168 retains purged generations with NULL scope_digest. Excluding
-- synthetic live scopes must retain them before and after fixture creation.
do $null_scope_regression$
declare v_fixture_exists boolean; v_retained text[];
begin
  foreach v_fixture_exists in array array[false, true] loop
    select array_agg(g.state order by g.state) into v_retained
    from (values ('purged'::text, null::text), ('live', 'unrelated'), ('fixture', 'synthetic')) g(state, scope_digest)
    where not exists (
      select 1 from (values ('synthetic'::text)) fixture(scope_digest)
      where v_fixture_exists and g.scope_digest = fixture.scope_digest
    );
    if v_retained is distinct from (case when v_fixture_exists then array['live','purged'] else array['fixture','live','purged'] end)
    then raise exception 'Retained purged generation disappeared from unrelated-evidence snapshot'; end if;
  end loop;
end;
$null_scope_regression$;

-- Fingerprint unchanged global settings/resources and every unrelated evidence row.
-- No global setting, cron entry, immutable guard or bucket ACL is changed.
do $baseline$
declare v_baseline jsonb;
begin
  select jsonb_build_object(
    'pal_settings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_settings t where true),
    'signal_settings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_classroom_signal_settings t where true),
    'storage_settings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_settings t where true),
    'cron', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from cron.job t where true),
    'archive_resources', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classroom_archive_resource_contract t where true),
    'gradex_resources', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classroom_gradex_resource_contract t where true),
    'archive_versions', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classroom_archive_resource_contract_versions t where true),
    'buckets', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from storage.buckets t where true),
    'generations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_generations t where not exists (select 1 from public.classrooms c cross join public.users a where c.id::text like 'c242%' and a.id::text like 'c242%' and t.scope_digest = private.pal_membership_scope(c.id, a.id))),
    'storage_metadata', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from storage.objects t where id::text not like 'c242%' and name not like 'sc242/%' and name not like 'classrooms/c242%'),
    'objects', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_objects t where classroom_id::text not like 'c242%' or classroom_id is null),
    'docs', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_docs t where assignment_id::text not like 'c242%' and student_id::text not like 'c242%'),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_history t where assignment_doc_id not in (select id from public.assignment_docs where assignment_id::text like 'c242%' or student_id::text like 'c242%')),
    'save_operations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_save_operations t where assignment_doc_id not in (select id from public.assignment_docs where assignment_id::text like 'c242%' or student_id::text like 'c242%')),
    'artifacts', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_artifacts t where student_id::text not like 'c242%' and requirement_id::text not like 'c242%'),
    'pal_outbox', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pal_event_outbox t where student_id::text not like 'c242%'),
    'pal_bindings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_outbox t where classroom_id::text not like 'c242%' and student_id::text not like 'c242%'),
    'cleanup', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_artifact_storage_cleanup t where storage_path not like 'sc242/%' and storage_path not like 'classrooms/c242%'),
    'identities', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.user_github_identities t where user_id::text not like 'c242%'),
    'entitlements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.effective_feature_entitlements t where subject_user_id::text not like 'c242%'),
    'entitlement_audit', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.effective_feature_entitlement_audit t where subject_user_id::text not like 'c242%'),
    'users', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.users t where id::text not like 'c242%'),
    'classes', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classrooms t where id::text not like 'c242%'),
    'assignments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignments t where id::text not like 'c242%'),
    'enrollments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classroom_enrollments t where classroom_id::text not like 'c242%' and student_id::text not like 'c242%'),
    'requirements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_requirements t where assignment_id::text not like 'c242%'),
    'policies', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from pg_policy t where polrelid in ('storage.objects'::regclass, 'storage.buckets'::regclass)),
    'storage_acl', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from pg_class t where oid in ('storage.objects'::regclass, 'storage.buckets'::regclass)),
    'guards', (select coalesce(jsonb_agg(to_jsonb(t) order by t.oid), '[]'::jsonb) from pg_trigger t where t.tgname in ('guard_pal_membership_evidence', 'guard_pal_signal_activation'))
  ) into v_baseline;
  perform set_config('pika.sc242_baseline', v_baseline::text, true);
end;
$baseline$;

-- Every synthetic row is in this transaction; required due_at is always set.
insert into public.users (id, email, role) values
  ('c2420000-0000-4000-8000-000000000001', 'sc242-1@example.invalid', 'student'),
  ('c2420000-0000-4000-8000-000000000002', 'sc242-2@example.invalid', 'teacher'),
  ('c2420000-0000-4000-8000-000000000003', 'sc242-3@example.invalid', 'student'),
  ('c2420000-0000-4000-8000-000000000004', 'sc242-4@example.invalid', 'student');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  'c2420000-0000-4000-8000-000000000090', 'c2420000-0000-4000-8000-000000000001', 'classrooms.create', 'manual', true,
  clock_timestamp(), null, 3, 'test:migration-242', 'sc242_supplement_fixture', 0
);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
  ('c2420000-0000-4000-8000-000000000010', 'c2420000-0000-4000-8000-000000000001', 'sc242 classroom 10', 'SC24210', null),
  ('c2420000-0000-4000-8000-000000000011', 'c2420000-0000-4000-8000-000000000001', 'sc242 classroom 11', 'SC24211', clock_timestamp()),
  ('c2420000-0000-4000-8000-000000000012', 'c2420000-0000-4000-8000-000000000001', 'sc242 classroom 12', 'SC24212', null);

-- Historical self-membership does not confer a member-only owner grant.
insert into public.classroom_enrollments (id, classroom_id, student_id) values
  ('c2420000-0000-4000-8000-000000000101', 'c2420000-0000-4000-8000-000000000010', 'c2420000-0000-4000-8000-000000000001'),
  ('c2420000-0000-4000-8000-000000000102', 'c2420000-0000-4000-8000-000000000010', 'c2420000-0000-4000-8000-000000000002'),
  ('c2420000-0000-4000-8000-000000000103', 'c2420000-0000-4000-8000-000000000010', 'c2420000-0000-4000-8000-000000000003'),
  ('c2420000-0000-4000-8000-000000000111', 'c2420000-0000-4000-8000-000000000011', 'c2420000-0000-4000-8000-000000000001'),
  ('c2420000-0000-4000-8000-000000000112', 'c2420000-0000-4000-8000-000000000011', 'c2420000-0000-4000-8000-000000000002'),
  ('c2420000-0000-4000-8000-000000000113', 'c2420000-0000-4000-8000-000000000011', 'c2420000-0000-4000-8000-000000000003');

insert into public.assignments (id, classroom_id, title, description, due_at, created_by, is_draft, released_at) values
  ('c2420000-0000-4000-8000-000000000020', 'c2420000-0000-4000-8000-000000000010', 'sc242 assignment 20', '', clock_timestamp() + interval '7 days', 'c2420000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2420000-0000-4000-8000-000000000021', 'c2420000-0000-4000-8000-000000000010', 'sc242 assignment 21', '', clock_timestamp() + interval '7 days', 'c2420000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2420000-0000-4000-8000-000000000022', 'c2420000-0000-4000-8000-000000000010', 'sc242 assignment 22', '', clock_timestamp() + interval '7 days', 'c2420000-0000-4000-8000-000000000001', true, null),
  ('c2420000-0000-4000-8000-000000000023', 'c2420000-0000-4000-8000-000000000010', 'sc242 assignment 23', '', clock_timestamp() + interval '7 days', 'c2420000-0000-4000-8000-000000000001', false, clock_timestamp() + interval '1 hour'),
  ('c2420000-0000-4000-8000-000000000024', 'c2420000-0000-4000-8000-000000000011', 'sc242 assignment 24', '', clock_timestamp() + interval '7 days', 'c2420000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2420000-0000-4000-8000-000000000025', 'c2420000-0000-4000-8000-000000000010', 'sc242 assignment 25', '', clock_timestamp() + interval '7 days', 'c2420000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2420000-0000-4000-8000-000000000026', 'c2420000-0000-4000-8000-000000000010', 'sc242 assignment 26', '', clock_timestamp() + interval '7 days', 'c2420000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour');

insert into public.assignment_submission_requirements (id, assignment_id, type, label, required) values
  ('c2420000-0000-4000-8000-000000000320', 'c2420000-0000-4000-8000-000000000020', 'link', 'sc242 link 20', false),
  ('c2420000-0000-4000-8000-000000000321', 'c2420000-0000-4000-8000-000000000021', 'link', 'sc242 link 21', false),
  ('c2420000-0000-4000-8000-000000000322', 'c2420000-0000-4000-8000-000000000022', 'link', 'sc242 link 22', false),
  ('c2420000-0000-4000-8000-000000000323', 'c2420000-0000-4000-8000-000000000023', 'link', 'sc242 link 23', false),
  ('c2420000-0000-4000-8000-000000000324', 'c2420000-0000-4000-8000-000000000024', 'link', 'sc242 link 24', false),
  ('c2420000-0000-4000-8000-000000000325', 'c2420000-0000-4000-8000-000000000025', 'link', 'sc242 link 25', false),
  ('c2420000-0000-4000-8000-000000000326', 'c2420000-0000-4000-8000-000000000026', 'link', 'sc242 link 26', false);

-- Nonempty documents and reconstructible baseline/patch history exist BEFORE hiding.
insert into public.assignment_docs (id, assignment_id, student_id, content, viewed_at)
select ('c2420000-0000-4000-8000-' || lpad((1000 + n.assignment * 10 + n.actor)::text, 12, '0'))::uuid,
  ('c2420000-0000-4000-8000-' || lpad(n.assignment::text, 12, '0'))::uuid,
  ('c2420000-0000-4000-8000-' || lpad(n.actor::text, 12, '0'))::uuid,
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Today work"}]}]}'::jsonb,
  clock_timestamp()
from (select assignment, actor from generate_series(20,24) assignment cross join generate_series(1,3) actor) n;

insert into public.assignment_doc_history (id, assignment_doc_id, patch, snapshot, word_count, char_count, paste_word_count, keystroke_count, trigger, created_at)
select ('c2420000-0000-4000-8000-' || lpad((2000 + n.assignment * 10 + n.actor)::text, 12, '0'))::uuid,
  ('c2420000-0000-4000-8000-' || lpad((1000 + n.assignment * 10 + n.actor)::text, 12, '0'))::uuid,
  null, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Target baseline"}]}]}'::jsonb,
  2, 15, 0, 0, 'baseline', clock_timestamp() - interval '2 hours'
from (select assignment, actor from generate_series(20,24) assignment cross join generate_series(1,3) actor) n;
insert into public.assignment_doc_history (id, assignment_doc_id, patch, snapshot, word_count, char_count, paste_word_count, keystroke_count, trigger, created_at)
select ('c2420000-0000-4000-8000-' || lpad((3000 + n.assignment * 10 + n.actor)::text, 12, '0'))::uuid,
  ('c2420000-0000-4000-8000-' || lpad((1000 + n.assignment * 10 + n.actor)::text, 12, '0'))::uuid,
  '[{"op":"replace","path":"/content/0/content/0/text","value":"Target restored"}]'::jsonb,
  null, 2, 15, 0, 0, 'restore', clock_timestamp() - interval '1 hour'
from (select assignment, actor from generate_series(20,24) assignment cross join generate_series(1,3) actor) n;

-- These are ONLY synthetic storage.objects metadata, not Storage API/bytes.
-- Existing submission-images bucket settings/policies are preserved unchanged.
do $reserved_fixture$
declare v_doc public.assignment_docs; v_object uuid; v_path text;
begin
  for v_doc in select * from public.assignment_docs where assignment_id::text like 'c242%' loop
    v_object := ('c2420000-0000-4000-8000-' || lpad((4000 + right(v_doc.id::text, 12)::integer - 1000)::text, 12, '0'))::uuid;
    v_path := 'sc242/' || v_doc.id::text || '/existing.png';
    perform public.begin_managed_storage_upload(v_object, 'submission-images', v_path,
      case when v_doc.assignment_id = 'c2420000-0000-4000-8000-000000000024' then 'c2420000-0000-4000-8000-000000000011'::uuid else 'c2420000-0000-4000-8000-000000000010'::uuid end,
      null, null, 'student_inline_image', v_doc.student_id, v_doc.student_id, 'assignment_doc', v_doc.id, 'image/png', 4);
    insert into storage.objects (id, bucket_id, name) values (v_object, 'submission-images', v_path);
  end loop;
end;
$reserved_fixture$;

-- Real service-only RPCs establish nonempty ledger, artifacts and submitted history.
set local role service_role;
do $current_fixture$
declare v_actor uuid; v_assignment uuid; v_doc public.assignment_docs; v_result jsonb;
begin
  foreach v_actor in array array['c2420000-0000-4000-8000-000000000002'::uuid, 'c2420000-0000-4000-8000-000000000003'::uuid] loop
    foreach v_assignment in array array['c2420000-0000-4000-8000-000000000020'::uuid, 'c2420000-0000-4000-8000-000000000021'::uuid] loop
      select * into strict v_doc from public.assignment_docs where assignment_id = v_assignment and student_id = v_actor;
      v_result := public.save_assignment_doc_for_member_v1(v_actor, v_assignment, v_doc.content, v_doc.updated_at,
        'autosave', 0, 1, '[]'::jsonb, v_doc.content, 2, 10, gen_random_uuid(), 1, gen_random_uuid());
      if (v_result->>'ok')::boolean is distinct from true then raise exception 'sc242 save-ledger fixture failed'; end if;
      v_result := public.upsert_assignment_artifact_for_member_v1(v_actor, v_assignment,
        ('c2420000-0000-4000-8000-' || lpad((300 + right(v_assignment::text,12)::integer)::text,12,'0'))::uuid,
        'link', 'https://sc242.example.invalid/work', null, '{"fixture":"sc242"}'::jsonb, 'valid', null, clock_timestamp(), null);
      if (v_result->>'ok')::boolean is distinct from true then raise exception 'sc242 artifact fixture failed'; end if;
    end loop;
    select * into strict v_doc from public.assignment_docs where assignment_id = 'c2420000-0000-4000-8000-000000000021' and student_id = v_actor;
    v_result := public.submit_assignment_doc_for_member_v1(v_actor, v_doc.assignment_id, v_doc.content, v_doc.updated_at,
      2, 10, '{}'::uuid[], false, null);
    if (v_result->>'ok')::boolean is distinct from true or (v_result->'doc'->>'is_submitted')::boolean is distinct from true
      or v_result->'history_entry'->>'trigger' is distinct from 'submit'
    then raise exception 'sc242 submitted fixture failed'; end if;
  end loop;
end;
$current_fixture$;
reset role;

-- Each rejected call uses valid input and whole-row before/after evidence.
-- Inline missing-doc calls cannot reach the locked Assignment row: preserve
-- their existing initial discovery error, rather than claiming a new owner check.
do $denials$
declare
  v_phase text; v_case record; v_operation text; v_actor uuid; v_assignment uuid;
  v_classroom uuid; v_docid uuid; v_requirement uuid; v_history uuid; v_object uuid;
  v_revision timestamptz; v_expected_state text; v_expected_message text;
  v_state text; v_message text; v_result jsonb; v_before jsonb; v_after jsonb;
  v_target jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Target restored"}]}]}'::jsonb;
begin
  foreach v_phase in array array['hidden', 'visible'] loop
    update public.classrooms set feature_visibility = jsonb_set(feature_visibility, '{classwork}',
      case when v_phase = 'hidden' then 'false'::jsonb else 'true'::jsonb end)
    where id::text like 'c242%';
    for v_case in
      select actor, assignment, 'P0002'::text as expected_state
      from generate_series(2,3) actor cross join generate_series(20,25) assignment where v_phase = 'hidden'
      union all select 1, assignment, '42501' from (values (20),(22),(24),(25)) a(assignment)
      union all select actor, assignment, 'P0002' from generate_series(2,3) actor cross join (values (22),(23),(24),(29)) a(assignment) where v_phase = 'visible'
      union all select 4, 20, '42501' where v_phase = 'visible'
    loop
      v_actor := ('c2420000-0000-4000-8000-' || lpad(v_case.actor::text,12,'0'))::uuid;
      v_assignment := ('c2420000-0000-4000-8000-' || lpad(v_case.assignment::text,12,'0'))::uuid;
      v_classroom := case when v_case.assignment = 24 then 'c2420000-0000-4000-8000-000000000011'::uuid else 'c2420000-0000-4000-8000-000000000010'::uuid end;
      v_requirement := ('c2420000-0000-4000-8000-' || lpad((300 + v_case.assignment)::text,12,'0'))::uuid;
      -- The outsider receives a real member document/object, never an invented binding.
      v_docid := ('c2420000-0000-4000-8000-' || lpad((1000 + v_case.assignment*10 + case when v_case.actor=4 then 2 else v_case.actor end)::text,12,'0'))::uuid;
      v_history := ('c2420000-0000-4000-8000-' || lpad((3000 + v_case.assignment*10 + v_case.actor)::text,12,'0'))::uuid;
      v_object := ('c2420000-0000-4000-8000-' || lpad((4000 + v_case.assignment*10 + case when v_case.actor=4 then 2 else v_case.actor end)::text,12,'0'))::uuid;
      select coalesce((select updated_at from public.assignment_docs where id = v_docid), clock_timestamp()) into v_revision;
      foreach v_operation in array array['history','restore','prepare','upsert','delete','reserve','finalize'] loop
        if v_case.actor = 1 and v_case.assignment = 25 and v_operation in ('reserve','finalize') then continue; end if;
        v_expected_state := v_case.expected_state;
        v_expected_message := case when v_expected_state = '42501' then 'Forbidden' else 'Assignment not found' end;
        if v_operation in ('reserve','finalize') and v_case.assignment in (25,29) then
          v_expected_message := 'Assignment document not found';
        end if;
  select jsonb_build_object(
    'docs', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_docs t where assignment_id::text like 'c242%' or student_id::text like 'c242%'),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_history t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c242%')),
    'save_operations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_save_operations t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c242%')),
    'requirements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_requirements t where assignment_id::text like 'c242%'),
    'artifacts', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_artifacts t where student_id::text like 'c242%' or requirement_id::text like 'c242%'),
    'managed_objects', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_objects t where true),
    'storage_metadata', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from storage.objects t where true),
    'cleanup', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_artifact_storage_cleanup t where true),
    'identities', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.user_github_identities t where true),
    'outbox', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pal_event_outbox t where true),
    'bindings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_outbox t where true),
    'generations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_generations t where true),
    'guards', (select coalesce(jsonb_agg(to_jsonb(t) order by t.oid), '[]'::jsonb) from pg_trigger t where t.tgname in ('guard_pal_membership_evidence', 'guard_pal_signal_activation'))
  ) into v_before;
        v_state := '00000'; v_message := ''; v_result := null;
        set local role service_role;
        if current_user <> 'service_role' then raise exception 'Denial did not execute as service_role'; end if;
        begin
      case v_operation
        when 'history' then v_result := public.get_assignment_doc_history_for_actor_v1(v_actor, v_assignment, 'c2420000-0000-4000-8000-000000000004', true);
        when 'restore' then v_result := public.restore_assignment_doc_for_member_v1(v_actor, v_assignment, v_history, v_target, v_revision, '[]'::jsonb, v_target, 999, 999, gen_random_uuid(), 1, gen_random_uuid());
        when 'prepare' then v_result := public.prepare_assignment_artifact_for_member_v1(v_actor, v_assignment, v_requirement);
        when 'upsert' then v_result := public.upsert_assignment_artifact_for_member_v1(v_actor, v_assignment, v_requirement, 'link', 'https://sc242.example.invalid/changed', null, '{"fixture":"changed"}'::jsonb, 'valid', null, clock_timestamp(), null);
        when 'delete' then v_result := public.delete_assignment_artifact_for_member_v1(v_actor, v_assignment, v_requirement);
        when 'reserve' then v_result := public.reserve_assignment_inline_image_for_member_v1(v_actor, v_classroom, v_docid, 'c2420000-0000-4000-8000-000000009000', 'png', 'image/png', 4);
        when 'finalize' then v_result := public.finalize_assignment_inline_image_for_member_v1(v_actor, v_classroom, v_docid, v_object);
      end case;
        exception when others then get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
        end;
        reset role;
        if current_user <> 'postgres' then raise exception 'Evidence role did not return to postgres'; end if;
  select jsonb_build_object(
    'docs', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_docs t where assignment_id::text like 'c242%' or student_id::text like 'c242%'),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_history t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c242%')),
    'save_operations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_save_operations t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c242%')),
    'requirements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_requirements t where assignment_id::text like 'c242%'),
    'artifacts', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_artifacts t where student_id::text like 'c242%' or requirement_id::text like 'c242%'),
    'managed_objects', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_objects t where true),
    'storage_metadata', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from storage.objects t where true),
    'cleanup', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_artifact_storage_cleanup t where true),
    'identities', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.user_github_identities t where true),
    'outbox', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pal_event_outbox t where true),
    'bindings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_outbox t where true),
    'generations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_generations t where true),
    'guards', (select coalesce(jsonb_agg(to_jsonb(t) order by t.oid), '[]'::jsonb) from pg_trigger t where t.tgname in ('guard_pal_membership_evidence', 'guard_pal_signal_activation'))
  ) into v_after;
        if v_state is distinct from v_expected_state or v_message is distinct from v_expected_message then
          if v_case.actor = 1 then raise exception 'Owner member-only denial lost precedence: %, %, %, %', v_phase, v_operation, v_state, v_message; end if;
          raise exception 'Supplement denial changed: %, %, actor %, assignment %, state %, message %', v_phase, v_operation, v_case.actor, v_case.assignment, v_state, v_message;
        end if;
        if v_before is distinct from v_after then raise exception 'Hidden supplement changed whole-row evidence: %, %, actor %, assignment %', v_phase, v_operation, v_case.actor, v_case.assignment; end if;
      end loop;
    end loop;

    -- Owner disclosure remains available even with Classwork hidden/archive/draft.
    for v_case in select actor, assignment from generate_series(2,3) actor cross join (values (20),(22),(24)) a(assignment) loop
      v_actor := ('c2420000-0000-4000-8000-' || lpad(v_case.actor::text,12,'0'))::uuid;
      v_assignment := ('c2420000-0000-4000-8000-' || lpad(v_case.assignment::text,12,'0'))::uuid;
  select jsonb_build_object(
    'docs', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_docs t where assignment_id::text like 'c242%' or student_id::text like 'c242%'),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_history t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c242%')),
    'save_operations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_save_operations t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c242%')),
    'requirements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_requirements t where assignment_id::text like 'c242%'),
    'artifacts', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_artifacts t where student_id::text like 'c242%' or requirement_id::text like 'c242%'),
    'managed_objects', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_objects t where true),
    'storage_metadata', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from storage.objects t where true),
    'cleanup', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_artifact_storage_cleanup t where true),
    'identities', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.user_github_identities t where true),
    'outbox', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pal_event_outbox t where true),
    'bindings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_outbox t where true),
    'generations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_generations t where true),
    'guards', (select coalesce(jsonb_agg(to_jsonb(t) order by t.oid), '[]'::jsonb) from pg_trigger t where t.tgname in ('guard_pal_membership_evidence', 'guard_pal_signal_activation'))
  ) into v_before;
      set local role service_role;
      v_result := public.get_assignment_doc_history_for_actor_v1('c2420000-0000-4000-8000-000000000001', v_assignment, v_actor, false);
      reset role;
  select jsonb_build_object(
    'docs', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_docs t where assignment_id::text like 'c242%' or student_id::text like 'c242%'),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_history t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c242%')),
    'save_operations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_save_operations t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c242%')),
    'requirements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_requirements t where assignment_id::text like 'c242%'),
    'artifacts', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_artifacts t where student_id::text like 'c242%' or requirement_id::text like 'c242%'),
    'managed_objects', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_objects t where true),
    'storage_metadata', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from storage.objects t where true),
    'cleanup', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_artifact_storage_cleanup t where true),
    'identities', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.user_github_identities t where true),
    'outbox', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pal_event_outbox t where true),
    'bindings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_outbox t where true),
    'generations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_generations t where true),
    'guards', (select coalesce(jsonb_agg(to_jsonb(t) order by t.oid), '[]'::jsonb) from pg_trigger t where t.tgname in ('guard_pal_membership_evidence', 'guard_pal_signal_activation'))
  ) into v_after;
      if v_result->>'access_mode' is distinct from 'owner' or v_result->>'subject_id' is distinct from v_actor::text
        or v_result->'doc'->>'student_id' is distinct from v_actor::text or jsonb_array_length(v_result->'history') < 2
      then raise exception 'Owner history lost hidden access'; end if;
      if v_before is distinct from v_after then raise exception 'Owner history changed whole-row evidence'; end if;
    end loop;
  end loop;
end;
$denials$;

-- Compatibility failures remain atomic after visibility is restored.
do $compatibility$
declare
  v_actor uuid; v_assignment uuid; v_classroom uuid := 'c2420000-0000-4000-8000-000000000010'; v_docid uuid;
  v_requirement uuid; v_history uuid; v_object uuid; v_revision timestamptz;
  v_case text; v_state text; v_message text; v_result jsonb; v_before jsonb; v_after jsonb;
  v_target jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Target restored"}]}]}'::jsonb;
begin
  foreach v_actor in array array['c2420000-0000-4000-8000-000000000002'::uuid, 'c2420000-0000-4000-8000-000000000003'::uuid] loop
    foreach v_case in array array['revision','tampered','foreign_history','wrong_requirement','wrong_classroom','wrong_object','cross_subject',
      'submitted_restore','submitted_prepare','submitted_upsert','submitted_delete','submitted_reserve','submitted_finalize','missing_restore','missing_inline'] loop
      v_assignment := case when v_case like 'submitted_%' then 'c2420000-0000-4000-8000-000000000021'::uuid when v_case = 'missing_restore' then 'c2420000-0000-4000-8000-000000000025'::uuid else 'c2420000-0000-4000-8000-000000000020'::uuid end;
      select id, updated_at into v_docid, v_revision from public.assignment_docs where assignment_id = v_assignment and student_id = v_actor;
      v_docid := coalesce(v_docid, 'c2420000-0000-4000-8000-000000001252'::uuid); v_revision := coalesce(v_revision, clock_timestamp());
      v_requirement := case when v_case like 'submitted_%' then 'c2420000-0000-4000-8000-000000000321'::uuid else 'c2420000-0000-4000-8000-000000000320'::uuid end;
      v_history := ('c2420000-0000-4000-8000-' || lpad((3000 + right(v_assignment::text,12)::integer*10 + right(v_actor::text,12)::integer)::text,12,'0'))::uuid;
      v_object := ('c2420000-0000-4000-8000-' || lpad((4000 + right(v_assignment::text,12)::integer*10 + right(v_actor::text,12)::integer)::text,12,'0'))::uuid;
  select jsonb_build_object(
    'docs', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_docs t where assignment_id::text like 'c242%' or student_id::text like 'c242%'),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_history t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c242%')),
    'save_operations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_save_operations t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c242%')),
    'requirements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_requirements t where assignment_id::text like 'c242%'),
    'artifacts', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_artifacts t where student_id::text like 'c242%' or requirement_id::text like 'c242%'),
    'managed_objects', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_objects t where true),
    'storage_metadata', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from storage.objects t where true),
    'cleanup', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_artifact_storage_cleanup t where true),
    'identities', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.user_github_identities t where true),
    'outbox', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pal_event_outbox t where true),
    'bindings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_outbox t where true),
    'generations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_generations t where true),
    'guards', (select coalesce(jsonb_agg(to_jsonb(t) order by t.oid), '[]'::jsonb) from pg_trigger t where t.tgname in ('guard_pal_membership_evidence', 'guard_pal_signal_activation'))
  ) into v_before;
      v_state := '00000'; v_message := ''; v_result := null;
      set local role service_role;
      if current_user <> 'service_role' then raise exception 'Compatibility check did not execute as service_role'; end if;
      begin
        case v_case
          when 'revision' then v_result := public.restore_assignment_doc_for_member_v1(v_actor,v_assignment,v_history,v_target,v_revision - interval '1 second','[]'::jsonb,v_target,999,999,gen_random_uuid(),1,gen_random_uuid());
          when 'tampered' then v_result := public.restore_assignment_doc_for_member_v1(v_actor,v_assignment,v_history,'{"type":"doc","content":[]}'::jsonb,v_revision,'[]'::jsonb,v_target,999,999,gen_random_uuid(),1,gen_random_uuid());
          when 'foreign_history' then v_result := public.restore_assignment_doc_for_member_v1(v_actor,v_assignment,
            case when v_actor = 'c2420000-0000-4000-8000-000000000002' then 'c2420000-0000-4000-8000-000000003203'::uuid else 'c2420000-0000-4000-8000-000000003202'::uuid end,v_target,v_revision,'[]'::jsonb,v_target,999,999,gen_random_uuid(),1,gen_random_uuid());
          when 'wrong_requirement' then v_result := public.prepare_assignment_artifact_for_member_v1(v_actor,v_assignment,'c2420000-0000-4000-8000-000000000321');
          when 'wrong_classroom' then v_result := public.reserve_assignment_inline_image_for_member_v1(v_actor,'c2420000-0000-4000-8000-000000000011',v_docid,'c2420000-0000-4000-8000-000000009000','png','image/png',4);
          when 'wrong_object' then v_result := public.finalize_assignment_inline_image_for_member_v1(v_actor,v_classroom,v_docid,'c2420000-0000-4000-8000-000000009000');
          when 'cross_subject' then v_result := public.reserve_assignment_inline_image_for_member_v1(v_actor,v_classroom,
            case when v_actor = 'c2420000-0000-4000-8000-000000000002' then 'c2420000-0000-4000-8000-000000001203'::uuid else 'c2420000-0000-4000-8000-000000001202'::uuid end,'c2420000-0000-4000-8000-000000009000','png','image/png',4);
          when 'submitted_restore' then v_result := public.restore_assignment_doc_for_member_v1(v_actor,v_assignment,v_history,v_target,v_revision,'[]'::jsonb,v_target,999,999,gen_random_uuid(),1,gen_random_uuid());
          when 'submitted_prepare' then v_result := public.prepare_assignment_artifact_for_member_v1(v_actor,v_assignment,v_requirement);
          when 'submitted_upsert' then v_result := public.upsert_assignment_artifact_for_member_v1(v_actor,v_assignment,v_requirement,'link','https://sc242.example.invalid/changed',null,'{}'::jsonb,'valid',null,clock_timestamp(),null);
          when 'submitted_delete' then v_result := public.delete_assignment_artifact_for_member_v1(v_actor,v_assignment,v_requirement);
          when 'submitted_reserve' then v_result := public.reserve_assignment_inline_image_for_member_v1(v_actor,v_classroom,v_docid,'c2420000-0000-4000-8000-000000009000','png','image/png',4);
          when 'submitted_finalize' then v_result := public.finalize_assignment_inline_image_for_member_v1(v_actor,v_classroom,v_docid,v_object);
          when 'missing_restore' then v_result := public.restore_assignment_doc_for_member_v1(v_actor,v_assignment,v_history,v_target,v_revision,'[]'::jsonb,v_target,999,999,gen_random_uuid(),1,gen_random_uuid());
          when 'missing_inline' then v_result := public.reserve_assignment_inline_image_for_member_v1(v_actor,v_classroom,'c2420000-0000-4000-8000-000000001252','c2420000-0000-4000-8000-000000009000','png','image/png',4);
        end case;
      exception when others then get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
      end;
      reset role;
  select jsonb_build_object(
    'docs', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_docs t where assignment_id::text like 'c242%' or student_id::text like 'c242%'),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_history t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c242%')),
    'save_operations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_save_operations t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c242%')),
    'requirements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_requirements t where assignment_id::text like 'c242%'),
    'artifacts', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_artifacts t where student_id::text like 'c242%' or requirement_id::text like 'c242%'),
    'managed_objects', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_objects t where true),
    'storage_metadata', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from storage.objects t where true),
    'cleanup', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_artifact_storage_cleanup t where true),
    'identities', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.user_github_identities t where true),
    'outbox', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pal_event_outbox t where true),
    'bindings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_outbox t where true),
    'generations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_generations t where true),
    'guards', (select coalesce(jsonb_agg(to_jsonb(t) order by t.oid), '[]'::jsonb) from pg_trigger t where t.tgname in ('guard_pal_membership_evidence', 'guard_pal_signal_activation'))
  ) into v_after;
      if v_before is distinct from v_after then raise exception 'Compatibility denial changed whole-row evidence: %', v_case; end if;
      if v_case = 'revision' then
        if v_state <> '00000' or (v_result->>'ok')::boolean is distinct from false or v_result->>'error_code' is distinct from 'assignment_doc_revision_conflict' then raise exception 'Revision conflict weakened'; end if;
      elsif v_case like 'submitted_%' then
        if v_state <> '00000' or (v_result->>'ok')::boolean is distinct from false
          or (v_result->>'status')::integer is distinct from case when v_case in ('submitted_restore','submitted_prepare') then 403 else 409 end
          or v_result->>'error' is distinct from 'Cannot edit a submitted document'
          or (v_case not in ('submitted_reserve','submitted_finalize') and v_result->>'error_code' is distinct from 'assignment_doc_submitted')
        then raise exception 'Submitted freeze/DTO changed: %', v_case; end if;
      elsif v_state is distinct from case v_case when 'tampered' then '22023' when 'wrong_classroom' then '40001' when 'cross_subject' then '42501' else 'P0002' end
        or v_message is distinct from case v_case
          when 'tampered' then 'Assignment restore content does not match history target'
          when 'foreign_history' then 'History entry not found'
          when 'wrong_requirement' then 'Requirement not found'
          when 'wrong_classroom' then 'Assignment classroom changed'
          when 'wrong_object' then 'Image upload not found'
          when 'cross_subject' then 'Forbidden'
          when 'missing_restore' then 'Assignment doc not found'
          when 'missing_inline' then 'Assignment document not found' end
      then raise exception 'Compatibility error changed: %, %, %', v_case, v_state, v_message; end if;
    end loop;
  end loop;
end;
$compatibility$;

-- Nonvacuous positive controls: each historical role label traverses every wrapper.
do $positive$
declare
  v_actor uuid; v_doc public.assignment_docs; v_result jsonb; v_artifact_id uuid;
  v_history_count bigint; v_ledger_count bigint; v_object uuid; v_path text;
  v_target jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Target restored"}]}]}'::jsonb;
begin
  foreach v_actor in array array['c2420000-0000-4000-8000-000000000002'::uuid, 'c2420000-0000-4000-8000-000000000003'::uuid] loop
    set local role service_role;
    if current_user <> 'service_role' then raise exception 'Positive control did not execute as service_role'; end if;
    v_result := public.get_assignment_doc_history_for_actor_v1(v_actor,'c2420000-0000-4000-8000-000000000020','c2420000-0000-4000-8000-000000000004',false);
    if v_result->>'access_mode' is distinct from 'member' or v_result->>'subject_id' is distinct from v_actor::text
      or v_result->'doc'->>'student_id' is distinct from v_actor::text or jsonb_array_length(v_result->'history') < 2
    then raise exception 'Visible own-subject history control failed'; end if;
    v_result := public.get_assignment_doc_history_for_actor_v1(v_actor,'c2420000-0000-4000-8000-000000000025',null,false);
    if v_result->'doc' is distinct from 'null'::jsonb or v_result->'history' is distinct from '[]'::jsonb then raise exception 'Visible missing-doc history changed'; end if;
    select * into strict v_doc from public.assignment_docs where assignment_id = 'c2420000-0000-4000-8000-000000000020' and student_id = v_actor;
    select count(*) into v_history_count from public.assignment_doc_history where assignment_doc_id = v_doc.id;
    select count(*) into v_ledger_count from public.assignment_doc_save_operations where assignment_doc_id = v_doc.id;
    if v_ledger_count = 0 then raise exception 'Save-ledger fixture is vacuous'; end if;
    v_result := public.restore_assignment_doc_for_member_v1(v_actor,'c2420000-0000-4000-8000-000000000020',
      ('c2420000-0000-4000-8000-' || lpad((3200 + right(v_actor::text,12)::integer)::text,12,'0'))::uuid,
      v_target,v_doc.updated_at,'[]'::jsonb,v_target,999,999,gen_random_uuid(),1,gen_random_uuid());
    if (v_result->>'ok')::boolean is distinct from true or v_result->'doc'->'content' is distinct from v_target
      or v_result->'history_entry'->'snapshot' is distinct from v_target or v_result->'history_entry'->'patch' is distinct from 'null'::jsonb
      or (v_result->'history_entry'->>'word_count')::integer is distinct from 2 or (v_result->'history_entry'->>'char_count')::integer is distinct from 15
      or (select count(*) from public.assignment_doc_history where assignment_doc_id = v_doc.id) <> v_history_count + 1
      or (select count(*) from public.assignment_doc_save_operations where assignment_doc_id = v_doc.id) <> v_ledger_count + 1
    then raise exception 'Visible exact history restoration failed'; end if;

    v_result := public.prepare_assignment_artifact_for_member_v1(v_actor,'c2420000-0000-4000-8000-000000000020','c2420000-0000-4000-8000-000000000320');
    v_artifact_id := (v_result->'artifact'->>'id')::uuid;
    if (v_result->>'ok')::boolean is distinct from true or v_artifact_id is null then raise exception 'Visible artifact control failed'; end if;
    v_result := public.upsert_assignment_artifact_for_member_v1(v_actor,'c2420000-0000-4000-8000-000000000020','c2420000-0000-4000-8000-000000000320','link','https://sc242.example.invalid/visible',null,'{"fixture":"visible"}'::jsonb,'valid',null,clock_timestamp(),null);
    if (v_result->>'ok')::boolean is distinct from true or v_result->'artifact'->>'id' is distinct from v_artifact_id::text
      or v_result->'artifact'->'metadata_json' is distinct from '{"fixture":"visible"}'::jsonb then raise exception 'Visible artifact control failed'; end if;
    -- Only the exact synthetic link artifact is removed by the existing member RPC.
    -- No storage path, real object, cleanup row or unrelated artifact is removed.
    v_result := public.delete_assignment_artifact_for_member_v1(v_actor,'c2420000-0000-4000-8000-000000000020','c2420000-0000-4000-8000-000000000320');
    if (v_result->>'ok')::boolean is distinct from true or (v_result->>'deleted')::boolean is distinct from true or v_result->'storage_path' is distinct from 'null'::jsonb then raise exception 'Visible artifact control failed'; end if;
    v_result := public.delete_assignment_artifact_for_member_v1(v_actor,'c2420000-0000-4000-8000-000000000020','c2420000-0000-4000-8000-000000000320');
    if (v_result->>'deleted')::boolean is distinct from false then raise exception 'Visible artifact control failed'; end if;
    -- Missing-doc prepare creates only this actor's new synthetic draft.
    v_result := public.prepare_assignment_artifact_for_member_v1(v_actor,'c2420000-0000-4000-8000-000000000026','c2420000-0000-4000-8000-000000000326');
    if (v_result->>'ok')::boolean is distinct from true or not exists (select 1 from public.assignment_docs where id=(v_result->>'assignment_doc_id')::uuid and assignment_id='c2420000-0000-4000-8000-000000000026' and student_id=v_actor and not is_submitted)
    then raise exception 'Visible artifact missing-doc control failed'; end if;

    -- Hidden finalize had genuine reserved metadata; visible finalize must mutate it.
    v_object := ('c2420000-0000-4000-8000-' || lpad((4200 + right(v_actor::text,12)::integer)::text,12,'0'))::uuid;
    v_result := public.finalize_assignment_inline_image_for_member_v1(v_actor,'c2420000-0000-4000-8000-000000000010',v_doc.id,v_object);
    if (v_result->>'ok')::boolean is distinct from true or (select status from public.managed_storage_objects where id=v_object) is distinct from 'verified' then raise exception 'Visible inline control failed'; end if;
    v_object := ('c2420000-0000-4000-8000-' || lpad((5200 + right(v_actor::text,12)::integer)::text,12,'0'))::uuid;
    v_result := public.reserve_assignment_inline_image_for_member_v1(v_actor,'c2420000-0000-4000-8000-000000000010',v_doc.id,v_object,'png','image/png',4);
    if (v_result->>'ok')::boolean is distinct from true or v_result->>'managed_object_id' is distinct from v_object::text
      or not exists(select 1 from public.managed_storage_objects where id=v_object and status='reserved' and created_by_user_id=v_actor and data_subject_user_id=v_actor and resource_id=v_doc.id)
    then raise exception 'Visible inline control failed'; end if;
    reset role;
    select storage_path into strict v_path from public.managed_storage_objects where id=v_object;
    if v_path <> format('classrooms/%s/students/%s/assignment-docs/%s/%s.png','c2420000-0000-4000-8000-000000000010',v_actor,v_doc.id,v_object) then raise exception 'Visible inline binding changed'; end if;
    insert into storage.objects (id,bucket_id,name) values(v_object,'submission-images',v_path);
    set local role service_role;
    v_result := public.finalize_assignment_inline_image_for_member_v1(v_actor,'c2420000-0000-4000-8000-000000000010',v_doc.id,v_object);
    reset role;
    if (v_result->>'ok')::boolean is distinct from true or (select status from public.managed_storage_objects where id=v_object) is distinct from 'verified' then raise exception 'Visible inline control failed'; end if;
  end loop;
end;
$positive$;

-- Stored default and partial objects obey 205's existing CHECK/NULL semantics.
-- SQL/JSON null and malformed forbidden storage shapes remain structural inputs,
-- never persisted by relaxing a constraint or trigger.
do $visible_shapes$
declare v_visibility jsonb; v_actor uuid; v_doc uuid; v_object uuid; v_result jsonb; v_index integer := 0;
begin
  update public.classrooms set feature_visibility = default where id = 'c2420000-0000-4000-8000-000000000010';
  foreach v_visibility in array array[
    (select feature_visibility from public.classrooms where id = 'c2420000-0000-4000-8000-000000000010'),
    '{}'::jsonb, '{"tests":false}'::jsonb, '{"classwork":true}'::jsonb
  ] loop
    update public.classrooms set feature_visibility = v_visibility where id = 'c2420000-0000-4000-8000-000000000010';
    foreach v_actor in array array['c2420000-0000-4000-8000-000000000002'::uuid, 'c2420000-0000-4000-8000-000000000003'::uuid] loop
      v_index := v_index + 1;
      v_object := ('c2420000-0000-4000-8000-' || lpad((6000 + v_index)::text,12,'0'))::uuid;
      select id into strict v_doc from public.assignment_docs where assignment_id = 'c2420000-0000-4000-8000-000000000020' and student_id = v_actor;
      set local role service_role;
      v_result := public.get_assignment_doc_history_for_actor_v1(v_actor,'c2420000-0000-4000-8000-000000000020',null,false);
      if v_result->>'subject_id' is distinct from v_actor::text then raise exception 'Default-visible history shape rejected'; end if;
      v_result := public.prepare_assignment_artifact_for_member_v1(v_actor,'c2420000-0000-4000-8000-000000000020','c2420000-0000-4000-8000-000000000320');
      if (v_result->>'ok')::boolean is distinct from true then raise exception 'Default-visible artifact shape rejected'; end if;
      v_result := public.reserve_assignment_inline_image_for_member_v1(v_actor,'c2420000-0000-4000-8000-000000000010',v_doc,v_object,'png','image/png',4);
      reset role;
      if (v_result->>'ok')::boolean is distinct from true or (select status from public.managed_storage_objects where id=v_object) is distinct from 'reserved'
      then raise exception 'Default-visible inline shape rejected'; end if;
    end loop;
  end loop;
end;
$visible_shapes$;

do $normalizer_inputs$
declare v_case record;
begin
  for v_case in select * from (values
    (null::jsonb,false), ('null'::jsonb,false), ('{}'::jsonb,false),
    ('{"tests":false}'::jsonb,false), ('{"classwork":true}'::jsonb,false), ('{"classwork":false}'::jsonb,true),
    ('{"classwork":null}'::jsonb,false), ('{"classwork":"false"}'::jsonb,false),
    ('{"classwork":0}'::jsonb,false), ('{"classwork":[]}'::jsonb,false), ('{"classwork":{}}'::jsonb,false),
    ('false'::jsonb,false), ('"false"'::jsonb,false), ('0'::jsonb,false), ('[]'::jsonb,false)
  ) cases(visibility, hidden) loop
    if coalesce(jsonb_typeof(v_case.visibility)='object' and v_case.visibility->'classwork'='false'::jsonb,false) is distinct from v_case.hidden
    then raise exception 'Classwork normalizer predicate changed'; end if;
  end loop;
end;
$normalizer_inputs$;

-- No same-actor post-revocation transition/concurrency is claimed. Immutable168
-- prohibits identity updates and this fixture performs no enrollment removal.
-- Current enrollees, never-enrolled outsiders and cross-subjects are distinct proof.
-- Root owns separate authorized removal/race integration and post-rollback checks.
do $unchanged$
declare v_baseline jsonb;
begin
  select jsonb_build_object(
    'pal_settings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_settings t where true),
    'signal_settings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_classroom_signal_settings t where true),
    'storage_settings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_settings t where true),
    'cron', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from cron.job t where true),
    'archive_resources', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classroom_archive_resource_contract t where true),
    'gradex_resources', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classroom_gradex_resource_contract t where true),
    'archive_versions', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classroom_archive_resource_contract_versions t where true),
    'buckets', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from storage.buckets t where true),
    'generations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_generations t where not exists (select 1 from public.classrooms c cross join public.users a where c.id::text like 'c242%' and a.id::text like 'c242%' and t.scope_digest = private.pal_membership_scope(c.id, a.id))),
    'storage_metadata', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from storage.objects t where id::text not like 'c242%' and name not like 'sc242/%' and name not like 'classrooms/c242%'),
    'objects', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_objects t where classroom_id::text not like 'c242%' or classroom_id is null),
    'docs', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_docs t where assignment_id::text not like 'c242%' and student_id::text not like 'c242%'),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_history t where assignment_doc_id not in (select id from public.assignment_docs where assignment_id::text like 'c242%' or student_id::text like 'c242%')),
    'save_operations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_save_operations t where assignment_doc_id not in (select id from public.assignment_docs where assignment_id::text like 'c242%' or student_id::text like 'c242%')),
    'artifacts', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_artifacts t where student_id::text not like 'c242%' and requirement_id::text not like 'c242%'),
    'pal_outbox', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pal_event_outbox t where student_id::text not like 'c242%'),
    'pal_bindings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_outbox t where classroom_id::text not like 'c242%' and student_id::text not like 'c242%'),
    'cleanup', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_artifact_storage_cleanup t where storage_path not like 'sc242/%' and storage_path not like 'classrooms/c242%'),
    'identities', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.user_github_identities t where user_id::text not like 'c242%'),
    'entitlements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.effective_feature_entitlements t where subject_user_id::text not like 'c242%'),
    'entitlement_audit', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.effective_feature_entitlement_audit t where subject_user_id::text not like 'c242%'),
    'users', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.users t where id::text not like 'c242%'),
    'classes', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classrooms t where id::text not like 'c242%'),
    'assignments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignments t where id::text not like 'c242%'),
    'enrollments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classroom_enrollments t where classroom_id::text not like 'c242%' and student_id::text not like 'c242%'),
    'requirements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_requirements t where assignment_id::text not like 'c242%'),
    'policies', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from pg_policy t where polrelid in ('storage.objects'::regclass, 'storage.buckets'::regclass)),
    'storage_acl', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from pg_class t where oid in ('storage.objects'::regclass, 'storage.buckets'::regclass)),
    'guards', (select coalesce(jsonb_agg(to_jsonb(t) order by t.oid), '[]'::jsonb) from pg_trigger t where t.tgname in ('guard_pal_membership_evidence', 'guard_pal_signal_activation'))
  ) into v_baseline;
  if v_baseline is distinct from current_setting('pika.sc242_baseline')::jsonb then
    raise exception 'sc242 changed global settings/resources or unrelated whole-row evidence';
  end if;
  if not exists(select 1 from pg_trigger where tgname='guard_pal_membership_evidence' and tgrelid='private.pal_membership_generations'::regclass and tgenabled='O')
    or not exists(select 1 from pg_trigger where tgname='guard_pal_signal_activation' and tgrelid='private.pal_classroom_signal_settings'::regclass and tgenabled='O')
  then raise exception 'Immutable Pal guards changed'; end if;
  raise notice 'sc242 source contract checks completed; all synthetic SQL rows roll back';
end;
$unchanged$;
rollback;
SQL
