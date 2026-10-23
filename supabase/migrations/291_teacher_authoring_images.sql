-- Teacher-authored Markdown images belong to the classroom independently of
-- student submission documents. Source writes attach references transactionally.
begin;

alter table public.managed_storage_objects
  drop constraint managed_storage_objects_purpose_check;
alter table public.managed_storage_objects
  add constraint managed_storage_objects_purpose_check check (purpose in (
    'student_assignment_artifact', 'student_inline_image', 'teacher_test_material',
    'test_execution_snapshot', 'legacy_classroom_file', 'classroom_archive',
    'gradex_extract', 'teacher_authoring_image'
  ));
alter table public.managed_storage_objects
  add constraint managed_storage_authoring_image_identity check (
    purpose <> 'teacher_authoring_image' or coalesce((
      storage_bucket = 'test-documents' and classroom_id is not null
      and resource_type = 'classroom' and resource_id = classroom_id
      and data_subject_user_id is null
      and content_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')
      and byte_size between 1 and 2097152
    ), false)
  );

-- Feature-owned ledger. Only the trigger writes it; server reads and cleanup use
-- its durable evidence. Source table deletion/cascades remove each reference.
create table public.teacher_authoring_image_references (
  owner_table text not null check (owner_table in (
    'assignments', 'classwork_materials', 'tests', 'test_questions',
    'survey_questions', 'assessment_drafts', 'test_ai_grading_run_items'
  )),
  owner_id uuid not null,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  managed_object_id uuid not null references public.managed_storage_objects(id) on delete restrict,
  primary key (owner_table, owner_id, managed_object_id)
);
create index teacher_authoring_image_reference_object
  on public.teacher_authoring_image_references(managed_object_id);
alter table public.teacher_authoring_image_references enable row level security;
revoke all on table public.teacher_authoring_image_references from public, anon, authenticated, service_role;
grant select on table public.teacher_authoring_image_references to service_role;

create or replace function public.managed_storage_object_is_referenced(p_object_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select
    exists (select 1 from public.assignment_submission_artifacts where managed_object_id = p_object_id)
    or exists (select 1 from public.managed_storage_json_references where managed_object_id = p_object_id)
    or exists (select 1 from public.teacher_authoring_image_references where managed_object_id = p_object_id)
    or exists (select 1 from public.classroom_archives where managed_object_id = p_object_id)
    or exists (
      select 1 from public.classroom_archive_restore_expected_objects expected
      join public.classroom_archive_operations operation on operation.id = expected.operation_id
      where expected.managed_object_id = p_object_id
        and operation.status = 'snapshot_ready'
        and operation.snapshot_expires_at > clock_timestamp()
    )
    or exists (select 1 from public.classroom_gradex_extracts where managed_object_id = p_object_id)
$$;

create function public.sync_teacher_authoring_image_references()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_payload jsonb;
  v_classroom_id uuid;
  v_owner_id uuid;
  v_id uuid;
  v_object public.managed_storage_objects;
begin
  v_owner_id := case when tg_op = 'DELETE' then old.id else new.id end;
  if tg_op <> 'DELETE' then
    v_payload := case when tg_table_name = 'test_ai_grading_run_items'
      then pg_catalog.jsonb_build_object('question_grading_snapshot',pg_catalog.to_jsonb(new)->'question_grading_snapshot')
      else pg_catalog.to_jsonb(new) end;
  end if;
  -- Markdown is authoritative; stale compatibility nodes cannot keep a removed
  -- image live or grant reader access after an AI/source-only edit.
  if tg_table_name = 'classwork_materials'
    and pg_catalog.jsonb_typeof(v_payload->'content'->'attrs'->'authoring_markdown') = 'string' then
    v_payload := pg_catalog.jsonb_build_object('source',v_payload->'content'->'attrs'->'authoring_markdown');
  elsif tg_table_name = 'assignments'
    and pg_catalog.jsonb_typeof(v_payload->'instructions_markdown') = 'string' then
    v_payload := pg_catalog.jsonb_build_object('source',v_payload->'instructions_markdown');
  end if;
  if coalesce(v_payload::text, '') not like '%/api/storage/authoring-images?object_id=%'
    and not exists (select 1 from public.teacher_authoring_image_references
      where owner_table = tg_table_name and owner_id = v_owner_id)
  then return case when tg_op = 'DELETE' then old else new end; end if;
  perform public.lock_managed_storage_protocol();
  delete from public.teacher_authoring_image_references
    where owner_table = tg_table_name and owner_id = v_owner_id;
  if tg_op <> 'DELETE' then
    if tg_table_name in ('assignments','classwork_materials','tests','assessment_drafts') then
      v_classroom_id := new.classroom_id;
    elsif tg_table_name in ('test_questions','test_ai_grading_run_items') then
      select classroom_id into v_classroom_id from public.tests where id = new.test_id;
    elsif tg_table_name = 'survey_questions' then
      select classroom_id into v_classroom_id from public.surveys where id = new.survey_id;
    end if;
    for v_id in
      select distinct (matches)[1]::uuid from pg_catalog.regexp_matches(
        v_payload::text,
        '/api/storage/authoring-images\?object_id=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})',
        'g'
      ) matches order by 1
    loop
      select * into v_object from public.managed_storage_objects where id = v_id for update;
      if not found or v_classroom_id is null or v_object.classroom_id is distinct from v_classroom_id
        or v_object.purpose <> 'teacher_authoring_image'
        or v_object.storage_bucket <> 'test-documents' then
        raise exception using errcode = '23514', message = 'authoring_image_reference_not_attachable';
      end if;
      -- Sequential question saves and Undo may restore the last removed source
      -- reference. Revive only this feature's unclaimed one-hour retention state;
      -- the protocol and exact object row remain locked for the entire adoption.
      if v_object.status = 'cleanup_pending'
        and v_object.cleanup_reason_code = 'authoring_image_reference_removed'
        and v_object.next_attempt_at > pg_catalog.clock_timestamp()
        and v_object.attempt_count = 0
        and v_object.lease_token is null and v_object.lease_expires_at is null
        and v_object.verified_at is not null and v_object.ready_at is not null then
        update public.managed_storage_objects
          set status = 'ready', cleanup_reason_code = null, last_error_code = null,
            updated_at = pg_catalog.clock_timestamp()
          where id = v_id returning * into v_object;
      end if;
      if v_object.status not in ('verified','ready') then
        raise exception using errcode = '23514', message = 'authoring_image_reference_not_attachable';
      end if;
      perform public.managed_storage_mark_ready(v_id);
      insert into public.teacher_authoring_image_references(owner_table,owner_id,classroom_id,managed_object_id)
        values (tg_table_name,v_owner_id,v_classroom_id,v_id);
    end loop;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.sync_teacher_authoring_image_references() from public,anon,authenticated,service_role;
create trigger assignments_authoring_image_references
  after insert or update or delete on public.assignments for each row execute function public.sync_teacher_authoring_image_references();
create trigger materials_authoring_image_references
  after insert or update or delete on public.classwork_materials for each row execute function public.sync_teacher_authoring_image_references();
create trigger tests_authoring_image_references
  after insert or update or delete on public.tests for each row execute function public.sync_teacher_authoring_image_references();
create trigger test_questions_authoring_image_references
  after insert or update or delete on public.test_questions for each row execute function public.sync_teacher_authoring_image_references();
create trigger survey_questions_authoring_image_references
  after insert or update or delete on public.survey_questions for each row execute function public.sync_teacher_authoring_image_references();
create trigger assessment_drafts_authoring_image_references
  after insert or update or delete on public.assessment_drafts for each row execute function public.sync_teacher_authoring_image_references();

create trigger test_ai_grading_run_items_authoring_image_references
  after insert or update or delete on public.test_ai_grading_run_items for each row execute function public.sync_teacher_authoring_image_references();

-- Bulk source imports may replace a question graph in one transaction. Check
-- final reference state at commit so delete/reinsert never invalidates a kept image.
create function public.queue_removed_teacher_authoring_image()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.lock_managed_storage_protocol();
  if not public.managed_storage_object_is_referenced(old.managed_object_id)
    and not coalesce(public.is_classroom_archive_maintenance_mode('restore'), false)
    and not coalesce(public.is_classroom_archive_maintenance_mode('compaction'), false) then
    perform public.queue_managed_storage_cleanup(old.managed_object_id,'authoring_image_reference_removed');
    -- Delay only a never-attempted, unleased authoring-image removal. Generic
    -- cleanup admission/claims and every other managed-storage purpose stay fixed.
    update public.managed_storage_objects
      set next_attempt_at = pg_catalog.clock_timestamp() + interval '1 hour',
        updated_at = pg_catalog.clock_timestamp()
      where id = old.managed_object_id and purpose = 'teacher_authoring_image'
        and status = 'cleanup_pending'
        and cleanup_reason_code = 'authoring_image_reference_removed'
        and attempt_count = 0 and lease_token is null and lease_expires_at is null
        and verified_at is not null and ready_at is not null;
  end if;
  return old;
end;
$$;
revoke all on function public.queue_removed_teacher_authoring_image() from public,anon,authenticated,service_role;
create constraint trigger removed_teacher_authoring_image_cleanup
  after delete on public.teacher_authoring_image_references
  deferrable initially deferred for each row execute function public.queue_removed_teacher_authoring_image();

commit;
