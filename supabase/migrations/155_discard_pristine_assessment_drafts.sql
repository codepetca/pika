-- Discard newly-created Assignment and Test drafts only when the persisted
-- record still matches the untouched authoring state observed by the client.
-- These functions share the writer lock order used by the corresponding save
-- paths so a same-teacher edit in another tab always wins over cleanup.

create or replace function public.discard_pristine_assignment_draft_atomic(
  p_assignment_id uuid,
  p_teacher_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.assignments%rowtype;
  v_archived_at timestamptz;
  v_owner_id uuid;
begin
  if p_assignment_id is null
    or p_teacher_id is null
    or p_expected_updated_at is null
  then
    raise exception using errcode = '22023', message = 'invalid_assignment_discard_payload';
  end if;

  -- Requirement writes use this advisory lock before locking the Assignment.
  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || p_assignment_id::text, 0)
  );

  select assignment.*
    into v_assignment
  from public.assignments assignment
  where assignment.id = p_assignment_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'assignment_not_found';
  end if;

  select classroom.teacher_id, classroom.archived_at
    into v_owner_id, v_archived_at
  from public.classrooms classroom
  where classroom.id = v_assignment.classroom_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'assignment_classroom_not_found';
  end if;
  if v_owner_id is distinct from p_teacher_id then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if v_archived_at is not null or v_assignment.blueprint_archived_at is not null then
    raise exception using errcode = '55000', message = 'assignment_archived';
  end if;

  if v_assignment.updated_at is distinct from p_expected_updated_at
    or v_assignment.is_draft is distinct from true
    or v_assignment.released_at is not null
    or btrim(v_assignment.title) !~
      '^Untitled([[:space:]]+[0-9]{4}-[0-9]{2}-[0-9]{2}([[:space:]]+[0-9]{2}:[0-9]{2}:[0-9]{2})?|[[:space:]]*\([0-9]{4}-[0-9]{2}-[0-9]{2}[^)]*\))?$'
    or nullif(btrim(coalesce(v_assignment.instructions_markdown, '')), '') is not null
    or nullif(btrim(coalesce(v_assignment.description, '')), '') is not null
    or exists (
      select 1
      from public.assignment_submission_requirements requirement
      where requirement.assignment_id = p_assignment_id
    )
    or exists (
      select 1
      from public.assignment_docs document
      where document.assignment_id = p_assignment_id
    )
  then
    return jsonb_build_object(
      'discarded', false,
      'reason', 'draft_changed',
      'assignment', to_jsonb(v_assignment)
    );
  end if;

  delete from public.assignments assignment
  where assignment.id = p_assignment_id;

  return jsonb_build_object('discarded', true);
end;
$$;

create or replace function public.discard_pristine_test_draft_atomic(
  p_test_id uuid,
  p_teacher_id uuid,
  p_expected_draft_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archived_at timestamptz;
  v_classroom_id uuid;
  v_draft public.assessment_drafts%rowtype;
  v_owner_id uuid;
  v_test public.tests%rowtype;
begin
  if p_test_id is null
    or p_teacher_id is null
    or p_expected_draft_version is null
    or p_expected_draft_version < 1
  then
    raise exception using errcode = '22023', message = 'invalid_test_discard_payload';
  end if;

  select test.classroom_id
    into v_classroom_id
  from public.tests test
  where test.id = p_test_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'test_not_found';
  end if;

  -- Match save_test_draft_atomic's Classroom -> Test -> Draft writer order.
  select classroom.teacher_id, classroom.archived_at
    into v_owner_id, v_archived_at
  from public.classrooms classroom
  where classroom.id = v_classroom_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'test_classroom_not_found';
  end if;
  if v_owner_id is distinct from p_teacher_id then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  select test.*
    into v_test
  from public.tests test
  where test.id = p_test_id
    and test.classroom_id = v_classroom_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'test_not_found';
  end if;
  if v_archived_at is not null or v_test.blueprint_archived_at is not null then
    raise exception using errcode = '55000', message = 'test_archived';
  end if;

  select draft.*
    into v_draft
  from public.assessment_drafts draft
  where draft.assessment_type = 'test'
    and draft.assessment_id = p_test_id
  for update;

  if not found then
    return jsonb_build_object(
      'discarded', false,
      'reason', 'draft_changed',
      'test', to_jsonb(v_test)
    );
  end if;

  if v_draft.version is distinct from p_expected_draft_version
    or v_test.status is distinct from 'draft'
    or btrim(v_test.title) !~
      '^Untitled([[:space:]]+[0-9]{4}-[0-9]{2}-[0-9]{2}([[:space:]]+[0-9]{2}:[0-9]{2}:[0-9]{2})?|[[:space:]]*\([0-9]{4}-[0-9]{2}-[0-9]{2}[^)]*\))?$'
    or v_test.show_results is distinct from false
    or jsonb_typeof(coalesce(v_test.documents, '[]'::jsonb)) is distinct from 'array'
    or jsonb_array_length(coalesce(v_test.documents, '[]'::jsonb)) <> 0
    or btrim(coalesce(v_draft.content->>'title', '')) !~
      '^Untitled([[:space:]]+[0-9]{4}-[0-9]{2}-[0-9]{2}([[:space:]]+[0-9]{2}:[0-9]{2}:[0-9]{2})?|[[:space:]]*\([0-9]{4}-[0-9]{2}-[0-9]{2}[^)]*\))?$'
    or coalesce((v_draft.content->>'show_results')::boolean, false) is distinct from false
    or jsonb_typeof(v_draft.content->'questions') is distinct from 'array'
    or jsonb_array_length(v_draft.content->'questions') <> 0
    or exists (
      select 1 from public.test_questions question where question.test_id = p_test_id
    )
    or exists (
      select 1 from public.test_attempts attempt where attempt.test_id = p_test_id
    )
    or exists (
      select 1 from public.test_responses response where response.test_id = p_test_id
    )
  then
    return jsonb_build_object(
      'discarded', false,
      'reason', 'draft_changed',
      'test', to_jsonb(v_test)
    );
  end if;

  delete from public.tests test
  where test.id = p_test_id;

  return jsonb_build_object('discarded', true);
end;
$$;

revoke all on function public.discard_pristine_assignment_draft_atomic(uuid, uuid, timestamptz)
from public, anon, authenticated;
revoke all on function public.discard_pristine_test_draft_atomic(uuid, uuid, integer)
from public, anon, authenticated;

grant execute on function public.discard_pristine_assignment_draft_atomic(uuid, uuid, timestamptz)
to service_role;
grant execute on function public.discard_pristine_test_draft_atomic(uuid, uuid, integer)
to service_role;

comment on function public.discard_pristine_assignment_draft_atomic(uuid, uuid, timestamptz) is
  'Atomically deletes a newly-created untouched Assignment draft, fenced by its observed updated_at.';
comment on function public.discard_pristine_test_draft_atomic(uuid, uuid, integer) is
  'Atomically deletes a newly-created untouched Test draft, fenced by its observed draft version.';
