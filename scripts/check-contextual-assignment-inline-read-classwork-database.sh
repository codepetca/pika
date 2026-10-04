#!/usr/bin/env bash
set -euo pipefail

# Canonical local container only; psql uses its local socket, never a remote URL.
# Rollback-only source fixture. Migration 243 must already be installed through
# the separately authorized workflow; this script never installs any migration.
# This single-session check does not claim cross-session visibility-race proof.
# UUIDs use hexadecimal c243; sc243 is the fixed textual fixture namespace.
INLINE_READ_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$INLINE_READ_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$INLINE_READ_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
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
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '243') then
    raise exception 'Migration 243 is required; this harness never applies it';
  end if;
  foreach v_signature in array array[
    'public.read_assignment_inline_image_for_context_v1(uuid,uuid,uuid,uuid)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Migration 243 function is missing: %', v_signature;
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

  if not exists (select 1 from storage.buckets where id = 'submission-images')
    or not exists (select 1 from storage.buckets where id = 'assignment-artifacts')
  then raise exception 'Existing private fixture buckets are required; no bucket is created'; end if;

  -- Reserve the whole namespace, including retained evidence and scope digests.
  -- A collision fails before fixture writes; existing rows are never reused.
  if exists (select 1 from public.users where id::text like 'c243%' or email like 'sc243-%')
    or exists (select 1 from public.classrooms where id::text like 'c243%' or class_code like 'SC243%')
    or exists (select 1 from public.assignments where id::text like 'c243%' or classroom_id::text like 'c243%' or created_by::text like 'c243%')
    or exists (select 1 from public.classroom_enrollments where id::text like 'c243%' or classroom_id::text like 'c243%' or student_id::text like 'c243%')
    or exists (select 1 from public.classroom_roster where id::text like 'c243%' or classroom_id::text like 'c243%' or removed_enrollment_id::text like 'c243%' or removed_student_id::text like 'c243%' or email like 'sc243-%')
    or exists (select 1 from public.assignment_docs where id::text like 'c243%' or assignment_id::text like 'c243%' or student_id::text like 'c243%' or save_session_id::text like 'c243%')
    or exists (select 1 from public.assignment_doc_history where id::text like 'c243%' or assignment_doc_id::text like 'c243%')
    or exists (select 1 from public.assignment_doc_save_operations where id::text like 'c243%' or assignment_doc_id::text like 'c243%' or save_session_id::text like 'c243%' or metric_session_id::text like 'c243%')
    or exists (select 1 from public.assignment_submission_requirements where id::text like 'c243%' or assignment_id::text like 'c243%' or artifact_id::text like 'c243%')
    or exists (select 1 from public.assignment_submission_artifacts where id::text like 'c243%' or assignment_doc_id::text like 'c243%' or requirement_id::text like 'c243%' or student_id::text like 'c243%')
    or exists (select 1 from public.pal_event_outbox where id::text like 'c243%' or student_id::text like 'c243%' or source_id like 'c243%' or idempotency_key like 'pika:v1:pika-fact-sc243%')
    or exists (select 1 from private.pal_membership_outbox where outbox_id::text like 'c243%' or generation_id::text like 'c243%' or classroom_id::text like 'c243%' or student_id::text like 'c243%')
    or exists (select 1 from private.pal_membership_generations where generation_id::text like 'c243%')
    or exists (select 1 from public.managed_storage_objects where id::text like 'c243%' or classroom_id::text like 'c243%' or resource_id::text like 'c243%' or storage_path like 'sc243/%' or storage_path like 'classrooms/c243%')
    or exists (select 1 from public.managed_storage_json_references where id::text like 'c243%' or managed_object_id::text like 'c243%' or assignment_doc_id::text like 'c243%' or assignment_doc_history_id::text like 'c243%' or storage_path like 'sc243/%' or storage_path like 'classrooms/c243%')
    or exists (select 1 from storage.objects where id::text like 'c243%' or name like 'sc243/%' or name like 'classrooms/c243%')
    or exists (select 1 from public.assignment_artifact_storage_cleanup where id::text like 'c243%' or storage_path like 'sc243/%' or storage_path like 'classrooms/c243%')
    or exists (select 1 from public.effective_feature_entitlement_audit where subject_user_id::text like 'c243%' or operation_id::text like 'c243%')
    or exists (select 1 from public.user_github_identities where user_id::text like 'c243%')
    or exists (
      select 1 from private.pal_membership_generations identity
      cross join (values ('c2430000-0000-4000-8000-000000000010'::uuid),
        ('c2430000-0000-4000-8000-000000000011'::uuid),
        ('c2430000-0000-4000-8000-000000000012'::uuid)) as classrooms(id)
      cross join (values ('c2430000-0000-4000-8000-000000000001'::uuid),
        ('c2430000-0000-4000-8000-000000000002'::uuid),
        ('c2430000-0000-4000-8000-000000000003'::uuid),
        ('c2430000-0000-4000-8000-000000000004'::uuid)) as actors(id)
      where identity.scope_digest = private.pal_membership_scope(classrooms.id, actors.id)
    )
  then raise exception 'sc243 fixture namespace collision'; end if;
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
    'generations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_generations t where not exists (select 1 from public.classrooms c cross join public.users a where c.id::text like 'c243%' and a.id::text like 'c243%' and t.scope_digest = private.pal_membership_scope(c.id, a.id))),
    'storage_metadata', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from storage.objects t where id::text not like 'c243%' and name not like 'sc243/%' and name not like 'classrooms/c243%'),
    'objects', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_objects t where classroom_id::text not like 'c243%' or classroom_id is null),
    'docs', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_docs t where assignment_id::text not like 'c243%' and student_id::text not like 'c243%'),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_history t where assignment_doc_id not in (select id from public.assignment_docs where assignment_id::text like 'c243%' or student_id::text like 'c243%')),
    'save_operations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_save_operations t where assignment_doc_id not in (select id from public.assignment_docs where assignment_id::text like 'c243%' or student_id::text like 'c243%')),
    'artifacts', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_artifacts t where student_id::text not like 'c243%' and requirement_id::text not like 'c243%'),
    'pal_outbox', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pal_event_outbox t where student_id::text not like 'c243%'),
    'pal_bindings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_outbox t where classroom_id::text not like 'c243%' and student_id::text not like 'c243%'),
    'cleanup', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_artifact_storage_cleanup t where storage_path not like 'sc243/%' and storage_path not like 'classrooms/c243%'),
    'identities', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.user_github_identities t where user_id::text not like 'c243%'),
    'entitlements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.effective_feature_entitlements t where subject_user_id::text not like 'c243%'),
    'entitlement_audit', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.effective_feature_entitlement_audit t where subject_user_id::text not like 'c243%'),
    'users', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.users t where id::text not like 'c243%'),
    'classes', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classrooms t where id::text not like 'c243%'),
    'assignments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignments t where id::text not like 'c243%'),
    'enrollments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classroom_enrollments t where classroom_id::text not like 'c243%' and student_id::text not like 'c243%'),
    'requirements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_requirements t where assignment_id::text not like 'c243%'),
    'policies', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from pg_policy t where polrelid in ('storage.objects'::regclass, 'storage.buckets'::regclass)),
    'storage_acl', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from pg_class t where oid in ('storage.objects'::regclass, 'storage.buckets'::regclass)),
    'embedded_references', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_json_references t where not exists (select 1 from public.managed_storage_objects o where o.id = t.managed_object_id and o.classroom_id::text like 'c243%')),
    'guards', (select coalesce(jsonb_agg(to_jsonb(t) order by t.oid), '[]'::jsonb) from pg_trigger t where t.tgname in ('guard_pal_membership_evidence', 'guard_pal_signal_activation'))
  ) into v_baseline;
  perform set_config('pika.sc243_baseline', v_baseline::text, true);
end;
$baseline$;

-- Four synthetic actors: owner with student label, teacher/student members,
-- and a never-enrolled outsider. No account role is changed.
insert into public.users (id, email, role) values
  ('c2430000-0000-4000-8000-000000000001', 'sc243-1@example.invalid', 'student'),
  ('c2430000-0000-4000-8000-000000000002', 'sc243-2@example.invalid', 'teacher'),
  ('c2430000-0000-4000-8000-000000000003', 'sc243-3@example.invalid', 'student'),
  ('c2430000-0000-4000-8000-000000000004', 'sc243-4@example.invalid', 'student');

-- This grant affects only the new synthetic owner, never a real plan/cohort.
set local role service_role;
do $entitlement$
begin
  perform public.set_effective_feature_entitlement_v1('c2430000-0000-4000-8000-000000000090', 'c2430000-0000-4000-8000-000000000001',
    'classrooms.create', 'manual', true, clock_timestamp(), null, 3,
    'test:migration-243', 'sc243_inline_read_fixture', 0);
end;
$entitlement$;
reset role;

insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
  ('c2430000-0000-4000-8000-000000000010', 'c2430000-0000-4000-8000-000000000001', 'sc243 classroom 10', 'SC24310', null),
  ('c2430000-0000-4000-8000-000000000011', 'c2430000-0000-4000-8000-000000000001', 'sc243 classroom 11', 'SC24311', clock_timestamp()),
  ('c2430000-0000-4000-8000-000000000012', 'c2430000-0000-4000-8000-000000000001', 'sc243 classroom 12', 'SC24312', null);

-- Owner self-enrollment is historical evidence, not a verified-only read grant.
insert into public.classroom_enrollments (id, classroom_id, student_id) values
  ('c2430000-0000-4000-8000-000000000101', 'c2430000-0000-4000-8000-000000000010', 'c2430000-0000-4000-8000-000000000001'),
  ('c2430000-0000-4000-8000-000000000102', 'c2430000-0000-4000-8000-000000000010', 'c2430000-0000-4000-8000-000000000002'),
  ('c2430000-0000-4000-8000-000000000103', 'c2430000-0000-4000-8000-000000000010', 'c2430000-0000-4000-8000-000000000003'),
  ('c2430000-0000-4000-8000-000000000111', 'c2430000-0000-4000-8000-000000000011', 'c2430000-0000-4000-8000-000000000001'),
  ('c2430000-0000-4000-8000-000000000112', 'c2430000-0000-4000-8000-000000000011', 'c2430000-0000-4000-8000-000000000002'),
  ('c2430000-0000-4000-8000-000000000113', 'c2430000-0000-4000-8000-000000000011', 'c2430000-0000-4000-8000-000000000003');

insert into public.assignments (id, classroom_id, title, description, due_at, created_by, is_draft, released_at) values
  ('c2430000-0000-4000-8000-000000000020', 'c2430000-0000-4000-8000-000000000010', 'sc243 assignment 20', '', clock_timestamp() + interval '7 days', 'c2430000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2430000-0000-4000-8000-000000000021', 'c2430000-0000-4000-8000-000000000010', 'sc243 assignment 21', '', clock_timestamp() + interval '7 days', 'c2430000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2430000-0000-4000-8000-000000000022', 'c2430000-0000-4000-8000-000000000010', 'sc243 assignment 22', '', clock_timestamp() + interval '7 days', 'c2430000-0000-4000-8000-000000000001', true, null),
  ('c2430000-0000-4000-8000-000000000023', 'c2430000-0000-4000-8000-000000000010', 'sc243 assignment 23', '', clock_timestamp() + interval '7 days', 'c2430000-0000-4000-8000-000000000001', false, clock_timestamp() + interval '1 hour'),
  ('c2430000-0000-4000-8000-000000000024', 'c2430000-0000-4000-8000-000000000011', 'sc243 assignment 24', '', clock_timestamp() + interval '7 days', 'c2430000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour');

-- Assignment21 has frozen submitted documents. Actor4 has document evidence but
-- no current enrollment: this models absence, not a post-revocation transition.
insert into public.assignment_docs (id, assignment_id, student_id, content, is_submitted, submitted_at, viewed_at)
select ('c2430000-0000-4000-8000-' || lpad((1000 + n.assignment*10 + n.actor)::text,12,'0'))::uuid,
  ('c2430000-0000-4000-8000-' || lpad(n.assignment::text,12,'0'))::uuid,
  ('c2430000-0000-4000-8000-' || lpad(n.actor::text,12,'0'))::uuid,
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"sc243 work"}]}]}'::jsonb,
  n.assignment = 21, (case when n.assignment = 21 then clock_timestamp() else null end), clock_timestamp()
from (select assignment, actor from generate_series(20,24) assignment cross join generate_series(1,4) actor) n;
insert into public.assignment_doc_history (id, assignment_doc_id, snapshot, word_count, char_count, paste_word_count, keystroke_count, trigger, created_at)
select ('c2430000-0000-4000-8000-' || lpad((2000 + right(doc.id::text,12)::integer - 1000)::text,12,'0'))::uuid,
  doc.id, doc.content, 2, 10, 0, 0, 'baseline', clock_timestamp() - interval '1 hour'
from public.assignment_docs doc where assignment_id::text like 'c243%';

-- No Storage API/bytes: only collision-guarded storage.objects METADATA rows.
-- Supported begin/verify/mark-ready RPCs create real reserved/verified/ready states
-- on exact synthetic objects, without mutating bucket settings/policies or guards.
do $objects$
declare
  v_doc public.assignment_docs; v_status text; v_object uuid; v_classroom uuid; v_path text;
  v_actor uuid; v_case record; v_bucket text; v_purpose text; v_creator uuid; v_subject uuid;
  v_resource_type text; v_resource uuid;
begin
  for v_doc in select * from public.assignment_docs where assignment_id::text like 'c243%' loop
    select classroom_id into strict v_classroom from public.assignments where id = v_doc.assignment_id;
    foreach v_status in array array['verified','ready'] loop
      v_object := ('c2430000-0000-4000-8000-' || lpad(((case when v_status = 'verified' then 3000 else 4000 end) + right(v_doc.id::text,12)::integer - 1000)::text,12,'0'))::uuid;
      v_path := 'sc243/' || v_doc.id::text || '/' || v_object::text || '.png';
      perform public.begin_managed_storage_upload(v_object,'submission-images',v_path,v_classroom,
        null,null,'student_inline_image',v_doc.student_id,v_doc.student_id,'assignment_doc',v_doc.id,'image/png',4);
      insert into storage.objects (id, bucket_id, name) values (v_object, 'submission-images', v_path);
      perform public.verify_managed_storage_upload(v_object);
      -- Only the postgres fixture session may perform this internal transition.
      if v_status = 'ready' then perform public.managed_storage_mark_ready(v_object); end if;
      if not exists(select 1 from public.managed_storage_objects where id = v_object and status = v_status) then raise exception 'sc243 valid object fixture failed'; end if;
    end loop;
  end loop;

  -- Each wrong binding is individually valid managed metadata, not a corrupted
  -- live object. Its creator/purpose/resource mismatch is tested by read243.
  foreach v_actor in array array['c2430000-0000-4000-8000-000000000002'::uuid,'c2430000-0000-4000-8000-000000000003'::uuid] loop
    select * into strict v_doc from public.assignment_docs where assignment_id = 'c2430000-0000-4000-8000-000000000020' and student_id = v_actor;
    for v_case in select * from (values
      (1,'wrong_purpose'),(2,'wrong_creator'),(3,'wrong_subject'),
      (4,'wrong_resource'),(5,'wrong_resource_type'),(6,'wrong_classroom'),(7,'wrong_bucket'),(8,'reserved')
    ) cases(number,label) loop
      v_object := ('c2430000-0000-4000-8000-' || lpad((7000 + right(v_actor::text,12)::integer*100 + v_case.number)::text,12,'0'))::uuid;
      v_bucket := (case when v_case.label = 'wrong_bucket' then 'assignment-artifacts' else 'submission-images' end);
      v_purpose := (case when v_case.label = 'wrong_purpose' then 'student_assignment_artifact' else 'student_inline_image' end);
      v_creator := (case when v_case.label = 'wrong_creator' then 'c2430000-0000-4000-8000-000000000004'::uuid else v_actor end);
      v_subject := (case when v_case.label = 'wrong_subject' then 'c2430000-0000-4000-8000-000000000004'::uuid else v_actor end);
      v_resource_type := (case when v_case.label = 'wrong_resource_type' then 'assignment_submission_artifact' else 'assignment_doc' end);
      v_resource := (case when v_case.label = 'wrong_resource' then 'c2430000-0000-4000-8000-000000001212'::uuid else v_doc.id end);
      v_classroom := (case when v_case.label = 'wrong_classroom' then 'c2430000-0000-4000-8000-000000000012'::uuid else 'c2430000-0000-4000-8000-000000000010'::uuid end);
      v_path := 'sc243/wrong/' || v_actor::text || '/' || v_case.label || '.png';
      perform public.begin_managed_storage_upload(v_object,v_bucket,v_path,v_classroom,null,null,v_purpose,
        v_creator,v_subject,v_resource_type,v_resource,'image/png',4);
      if v_case.label <> 'reserved' then
        insert into storage.objects (id, bucket_id, name) values (v_object, v_bucket, v_path);
        perform public.verify_managed_storage_upload(v_object);
        perform public.managed_storage_mark_ready(v_object);
      end if;
    end loop;
  end loop;
end;
$objects$;

-- Visible controls precede hidden checks using the SAME valid verified/ready rows.
-- Every read, positive or denied, must leave whole document/history/managed/Storage
-- and Pal evidence unchanged. A JSON denial is compared as the exact full 404 DTO.
do $reads$
declare
  v_phase text; v_case record; v_actor uuid; v_subject uuid; v_assignment uuid;
  v_doc uuid; v_object uuid; v_classroom uuid; v_expected_classroom uuid;
  v_expected_ok boolean; v_result jsonb; v_expected jsonb; v_state text; v_message text;
  v_before jsonb; v_after jsonb;
begin
  foreach v_phase in array array['visible','hidden'] loop
    update public.classrooms set feature_visibility = jsonb_set(feature_visibility,'{classwork}',
      (case when v_phase = 'hidden' then 'false'::jsonb else 'true'::jsonb end))
    where id::text like 'c243%';
    for v_case in
      select 'verified_member'::text as label, actor, actor as subject, assignment,
        3000 + assignment*10 + actor as object_number, true as visible_ok, false as hidden_ok,
        '00000'::text as expected_state, ''::text as expected_message, 0 as expected_classroom
      from generate_series(2,3) actor cross join (values(20),(21)) assignments(assignment)
      union all select 'ready_member',actor,actor,assignment,4000+assignment*10+actor,true,false,'00000','',0
        from generate_series(2,3) actor cross join (values(20),(21)) assignments(assignment)
      union all select 'owner_ready',1,subject,assignment,4000+assignment*10+subject,true,true,'00000','',0
        from generate_series(2,3) subject cross join generate_series(20,24) assignment
      union all select 'owner_self_ready',1,1,20,4201,true,true,'00000','',0
      union all select 'owner_self_verified',1,1,20,3201,false,false,'00000','',0
      union all select 'owner_verified',1,subject,20,3200+subject,false,false,'00000','',0 from generate_series(2,3) subject
      union all select 'lifecycle_member',actor,actor,assignment,object_base+assignment*10+actor,false,false,'00000','',0
        from generate_series(2,3) actor cross join (values(22),(23),(24)) assignments(assignment) cross join (values(3000),(4000)) objects(object_base)
      union all select 'outsider_own',4,4,20,object_base+204,false,false,'00000','',0 from (values(3000),(4000)) objects(object_base)
      union all select 'outsider_other',4,2,20,4202,false,false,'00000','',0
      union all select 'cross_subject',actor,(case when actor=2 then 3 else 2 end),20,
        4200+(case when actor=2 then 3 else 2 end),false,false,'00000','',0 from generate_series(2,3) actor
      union all select 'owner_subject_not_enrolled',1,4,assignment,4000+assignment*10+4,false,false,'00000','',0 from (values(20),(22),(24)) assignments(assignment)
      union all select cases.label,(case when mode.owner_mode then 1 else subject end),subject,20,
        7000+subject*100+cases.number,false,false,'00000','',0
        from generate_series(2,3) subject cross join (values(false),(true)) mode(owner_mode)
        cross join (values(1,'wrong_purpose'),(2,'wrong_creator'),(3,'wrong_subject'),(4,'wrong_resource'),
          (5,'wrong_resource_type'),(6,'wrong_classroom'),(7,'wrong_bucket'),(8,'reserved')) cases(number,label)
      union all select 'absent_object',actor,2,20,9000,false,false,'00000','',0 from (values(1),(2)) actors(actor)
      union all select 'wrong_expected_classroom',actor,2,20,4202,false,false,'40001','Assignment classroom changed',12 from (values(1),(2)) actors(actor)
      union all select 'absent_doc',actor,2,20,4202,false,false,'P0002','Assignment document not found',0 from (values(1),(2),(3)) actors(actor)
    loop
      v_actor := ('c2430000-0000-4000-8000-' || lpad(v_case.actor::text,12,'0'))::uuid;
      v_subject := ('c2430000-0000-4000-8000-' || lpad(v_case.subject::text,12,'0'))::uuid;
      v_assignment := ('c2430000-0000-4000-8000-' || lpad(v_case.assignment::text,12,'0'))::uuid;
      v_doc := ('c2430000-0000-4000-8000-' || lpad((case when v_case.label='absent_doc' then 9001 else 1000+v_case.assignment*10+v_case.subject end)::text,12,'0'))::uuid;
      v_object := ('c2430000-0000-4000-8000-' || lpad(v_case.object_number::text,12,'0'))::uuid;
      v_classroom := (case when v_case.assignment=24 then 'c2430000-0000-4000-8000-000000000011'::uuid else 'c2430000-0000-4000-8000-000000000010'::uuid end);
      v_expected_classroom := (case when v_case.expected_classroom=12 then 'c2430000-0000-4000-8000-000000000012'::uuid else v_classroom end);
      v_expected_ok := (case when v_phase='hidden' then v_case.hidden_ok else v_case.visible_ok end);
  select jsonb_build_object(
    'docs', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_docs t where assignment_id::text like 'c243%' or student_id::text like 'c243%'),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_history t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c243%')),
    'save_operations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_save_operations t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c243%')),
    'requirements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_requirements t where assignment_id::text like 'c243%'),
    'artifacts', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_artifacts t where student_id::text like 'c243%' or requirement_id::text like 'c243%'),
    'managed_objects', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_objects t where true),
    'storage_metadata', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from storage.objects t where true),
    'cleanup', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_artifact_storage_cleanup t where true),
    'identities', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.user_github_identities t where true),
    'outbox', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pal_event_outbox t where true),
    'bindings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_outbox t where true),
    'generations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_generations t where true),
    'embedded_references', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_json_references t),
    'classes', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classrooms t where id::text like 'c243%'),
    'assignments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignments t where id::text like 'c243%'),
    'enrollments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classroom_enrollments t where classroom_id::text like 'c243%'),
    'pal_settings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_settings t),
    'signal_settings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_classroom_signal_settings t),
    'guards', (select coalesce(jsonb_agg(to_jsonb(t) order by t.oid), '[]'::jsonb) from pg_trigger t where t.tgname in ('guard_pal_membership_evidence', 'guard_pal_signal_activation'))
  ) into v_before;
      v_result := null; v_state := '00000'; v_message := '';
      set local role service_role;
      if current_user <> 'service_role' then raise exception 'Inline read did not execute as service_role'; end if;
      begin
        v_result := public.read_assignment_inline_image_for_context_v1(v_actor,v_expected_classroom,v_doc,v_object);
      exception when others then get stacked diagnostics v_state=returned_sqlstate,v_message=message_text;
      end;
      reset role;
      if current_user <> 'postgres' then raise exception 'Inline evidence role did not return to postgres'; end if;
  select jsonb_build_object(
    'docs', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_docs t where assignment_id::text like 'c243%' or student_id::text like 'c243%'),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_history t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c243%')),
    'save_operations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_save_operations t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c243%')),
    'requirements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_requirements t where assignment_id::text like 'c243%'),
    'artifacts', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_artifacts t where student_id::text like 'c243%' or requirement_id::text like 'c243%'),
    'managed_objects', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_objects t where true),
    'storage_metadata', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from storage.objects t where true),
    'cleanup', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_artifact_storage_cleanup t where true),
    'identities', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.user_github_identities t where true),
    'outbox', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pal_event_outbox t where true),
    'bindings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_outbox t where true),
    'generations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_generations t where true),
    'embedded_references', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_json_references t),
    'classes', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classrooms t where id::text like 'c243%'),
    'assignments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignments t where id::text like 'c243%'),
    'enrollments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classroom_enrollments t where classroom_id::text like 'c243%'),
    'pal_settings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_settings t),
    'signal_settings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_classroom_signal_settings t),
    'guards', (select coalesce(jsonb_agg(to_jsonb(t) order by t.oid), '[]'::jsonb) from pg_trigger t where t.tgname in ('guard_pal_membership_evidence', 'guard_pal_signal_activation'))
  ) into v_after;
      if v_before is distinct from v_after then raise exception 'Hidden inline read changed whole-row evidence: %, %',v_phase,v_case.label; end if;
      if v_state is distinct from v_case.expected_state or v_message is distinct from v_case.expected_message then
        raise exception 'Inline read error mapping changed: %, %, %, %',v_phase,v_case.label,v_state,v_message;
      end if;
      if v_state='00000' then
        v_expected := (case when v_expected_ok then jsonb_build_object('ok',true,
          'classroom_id',v_classroom,'assignment_id',v_assignment,'assignment_doc_id',v_doc,'managed_object_id',v_object)
          else jsonb_build_object('ok',false,'status',404,'error','Image not found') end);
        if v_result is distinct from v_expected then
          if v_case.label in ('owner_ready','owner_self_ready') then raise exception 'Owner hidden inspection failed'; end if;
          if v_case.label='verified_member' and v_phase='visible' then raise exception 'Visible verified learner control failed'; end if;
          raise exception 'Inline read full DTO mismatch: %, %',v_phase,v_case.label;
        end if;
        if v_expected_ok and v_case.label in ('owner_ready','owner_self_ready')
          and (select status from public.managed_storage_objects where id=v_object) is distinct from 'ready'
        then raise exception 'Visible ready owner control failed'; end if;
        if v_expected_ok and v_case.label='verified_member'
          and (select status from public.managed_storage_objects where id=v_object) is distinct from 'verified'
        then raise exception 'Visible verified learner control failed'; end if;
      end if;
    end loop;
  end loop;
end;
$reads$;

-- Persist only valid default/partial objects under the untouched205 constraint.
-- Null/malformed normalizer inputs below are evaluated as expressions, not stored.
do $visible_shapes$
declare
  v_visibility jsonb; v_actor uuid; v_doc public.assignment_docs; v_status text; v_object uuid;
  v_result jsonb; v_before jsonb; v_after jsonb;
begin
  update public.classrooms set feature_visibility=default where id='c2430000-0000-4000-8000-000000000010';
  foreach v_visibility in array array[
    (select feature_visibility from public.classrooms where id='c2430000-0000-4000-8000-000000000010'),
    '{}'::jsonb,'{"tests":false}'::jsonb,'{"classwork":true}'::jsonb
  ] loop
    update public.classrooms set feature_visibility=v_visibility where id='c2430000-0000-4000-8000-000000000010';
    foreach v_actor in array array['c2430000-0000-4000-8000-000000000002'::uuid,'c2430000-0000-4000-8000-000000000003'::uuid] loop
      select * into strict v_doc from public.assignment_docs where assignment_id='c2430000-0000-4000-8000-000000000020' and student_id=v_actor;
      foreach v_status in array array['verified','ready'] loop
        v_object := ('c2430000-0000-4000-8000-' || lpad(((case when v_status='verified' then 3000 else 4000 end)+right(v_doc.id::text,12)::integer-1000)::text,12,'0'))::uuid;
  select jsonb_build_object(
    'docs', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_docs t where assignment_id::text like 'c243%' or student_id::text like 'c243%'),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_history t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c243%')),
    'save_operations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_save_operations t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c243%')),
    'requirements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_requirements t where assignment_id::text like 'c243%'),
    'artifacts', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_artifacts t where student_id::text like 'c243%' or requirement_id::text like 'c243%'),
    'managed_objects', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_objects t where true),
    'storage_metadata', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from storage.objects t where true),
    'cleanup', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_artifact_storage_cleanup t where true),
    'identities', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.user_github_identities t where true),
    'outbox', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pal_event_outbox t where true),
    'bindings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_outbox t where true),
    'generations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_generations t where true),
    'embedded_references', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_json_references t),
    'classes', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classrooms t where id::text like 'c243%'),
    'assignments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignments t where id::text like 'c243%'),
    'enrollments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classroom_enrollments t where classroom_id::text like 'c243%'),
    'pal_settings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_settings t),
    'signal_settings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_classroom_signal_settings t),
    'guards', (select coalesce(jsonb_agg(to_jsonb(t) order by t.oid), '[]'::jsonb) from pg_trigger t where t.tgname in ('guard_pal_membership_evidence', 'guard_pal_signal_activation'))
  ) into v_before;
        set local role service_role;
        if current_user <> 'service_role' then raise exception 'Visible shape did not execute as service_role'; end if;
        v_result := public.read_assignment_inline_image_for_context_v1(v_actor,'c2430000-0000-4000-8000-000000000010',v_doc.id,v_object);
        reset role;
  select jsonb_build_object(
    'docs', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_docs t where assignment_id::text like 'c243%' or student_id::text like 'c243%'),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_history t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c243%')),
    'save_operations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_save_operations t where assignment_doc_id in (select id from public.assignment_docs where assignment_id::text like 'c243%')),
    'requirements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_requirements t where assignment_id::text like 'c243%'),
    'artifacts', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_artifacts t where student_id::text like 'c243%' or requirement_id::text like 'c243%'),
    'managed_objects', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_objects t where true),
    'storage_metadata', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from storage.objects t where true),
    'cleanup', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_artifact_storage_cleanup t where true),
    'identities', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.user_github_identities t where true),
    'outbox', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pal_event_outbox t where true),
    'bindings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_outbox t where true),
    'generations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_generations t where true),
    'embedded_references', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_json_references t),
    'classes', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classrooms t where id::text like 'c243%'),
    'assignments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignments t where id::text like 'c243%'),
    'enrollments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classroom_enrollments t where classroom_id::text like 'c243%'),
    'pal_settings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_settings t),
    'signal_settings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_classroom_signal_settings t),
    'guards', (select coalesce(jsonb_agg(to_jsonb(t) order by t.oid), '[]'::jsonb) from pg_trigger t where t.tgname in ('guard_pal_membership_evidence', 'guard_pal_signal_activation'))
  ) into v_after;
        if v_before is distinct from v_after then raise exception 'Visible shape changed whole-row evidence'; end if;
        if v_result is distinct from jsonb_build_object('ok',true,'classroom_id','c2430000-0000-4000-8000-000000000010'::uuid,
          'assignment_id',v_doc.assignment_id,'assignment_doc_id',v_doc.id,'managed_object_id',v_object)
        then raise exception 'Default-visible inline read shape failed'; end if;
      end loop;
    end loop;
  end loop;
end;
$visible_shapes$;

do $normalizer_inputs$
declare v_case record;
begin
  for v_case in select * from (values
    (null::jsonb,false),('null'::jsonb,false),('{}'::jsonb,false),
    ('{"tests":false}'::jsonb,false),('{"classwork":true}'::jsonb,false),('{"classwork":false}'::jsonb,true),
    ('{"classwork":null}'::jsonb,false),('{"classwork":"false"}'::jsonb,false),
    ('{"classwork":0}'::jsonb,false),('{"classwork":[]}'::jsonb,false),('{"classwork":{}}'::jsonb,false),
    ('false'::jsonb,false),('"false"'::jsonb,false),('0'::jsonb,false),('[]'::jsonb,false)
  ) cases(visibility,hidden) loop
    if coalesce(jsonb_typeof(v_case.visibility)='object' and v_case.visibility->'classwork'='false'::jsonb,false) is distinct from v_case.hidden
    then raise exception 'Inline Classwork normalizer predicate changed'; end if;
  end loop;
end;
$normalizer_inputs$;

-- No same-actor post-revocation transition or concurrency proof is claimed.
-- Never-enrolled/out-of-subject controls are not revocation evidence. Immutable168
-- enrollment identities/retained generations stay guarded; no removal is attempted.
-- Root owns authorized lifecycle integration and full post-rollback verification.
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
    'generations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_generations t where not exists (select 1 from public.classrooms c cross join public.users a where c.id::text like 'c243%' and a.id::text like 'c243%' and t.scope_digest = private.pal_membership_scope(c.id, a.id))),
    'storage_metadata', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from storage.objects t where id::text not like 'c243%' and name not like 'sc243/%' and name not like 'classrooms/c243%'),
    'objects', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_objects t where classroom_id::text not like 'c243%' or classroom_id is null),
    'docs', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_docs t where assignment_id::text not like 'c243%' and student_id::text not like 'c243%'),
    'history', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_history t where assignment_doc_id not in (select id from public.assignment_docs where assignment_id::text like 'c243%' or student_id::text like 'c243%')),
    'save_operations', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_doc_save_operations t where assignment_doc_id not in (select id from public.assignment_docs where assignment_id::text like 'c243%' or student_id::text like 'c243%')),
    'artifacts', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_artifacts t where student_id::text not like 'c243%' and requirement_id::text not like 'c243%'),
    'pal_outbox', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.pal_event_outbox t where student_id::text not like 'c243%'),
    'pal_bindings', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from private.pal_membership_outbox t where classroom_id::text not like 'c243%' and student_id::text not like 'c243%'),
    'cleanup', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_artifact_storage_cleanup t where storage_path not like 'sc243/%' and storage_path not like 'classrooms/c243%'),
    'identities', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.user_github_identities t where user_id::text not like 'c243%'),
    'entitlements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.effective_feature_entitlements t where subject_user_id::text not like 'c243%'),
    'entitlement_audit', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.effective_feature_entitlement_audit t where subject_user_id::text not like 'c243%'),
    'users', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.users t where id::text not like 'c243%'),
    'classes', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classrooms t where id::text not like 'c243%'),
    'assignments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignments t where id::text not like 'c243%'),
    'enrollments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.classroom_enrollments t where classroom_id::text not like 'c243%' and student_id::text not like 'c243%'),
    'requirements', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.assignment_submission_requirements t where assignment_id::text not like 'c243%'),
    'policies', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from pg_policy t where polrelid in ('storage.objects'::regclass, 'storage.buckets'::regclass)),
    'storage_acl', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from pg_class t where oid in ('storage.objects'::regclass, 'storage.buckets'::regclass)),
    'embedded_references', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from public.managed_storage_json_references t where not exists (select 1 from public.managed_storage_objects o where o.id = t.managed_object_id and o.classroom_id::text like 'c243%')),
    'guards', (select coalesce(jsonb_agg(to_jsonb(t) order by t.oid), '[]'::jsonb) from pg_trigger t where t.tgname in ('guard_pal_membership_evidence', 'guard_pal_signal_activation'))
  ) into v_baseline;
  if v_baseline is distinct from current_setting('pika.sc243_baseline')::jsonb then
    raise exception 'sc243 changed global settings/resources or unrelated whole-row evidence';
  end if;
  if not exists(select 1 from pg_trigger where tgname='guard_pal_membership_evidence' and tgrelid='private.pal_membership_generations'::regclass and tgenabled='O')
    or not exists(select 1 from pg_trigger where tgname='guard_pal_signal_activation' and tgrelid='private.pal_classroom_signal_settings'::regclass and tgenabled='O')
  then raise exception 'Immutable Pal guards changed'; end if;
  raise notice 'sc243 inline-read contract checks completed; all synthetic SQL rows roll back';
end;
$unchanged$;
rollback;
SQL
