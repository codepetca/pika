-- Fence pristine Test cleanup against both draft-content saves and independent
-- Test-row writers (such as reordering), and remove the unlinked draft row.

revoke execute on function public.discard_pristine_test_draft_atomic(uuid, uuid, integer)
from service_role;

drop function public.discard_pristine_test_draft_atomic(uuid, uuid, integer);

create function public.discard_pristine_test_draft_atomic(
  p_test_id uuid,
  p_teacher_id uuid,
  p_expected_draft_version integer,
  p_expected_test_updated_at timestamptz
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
    or p_expected_test_updated_at is null
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
    or v_test.updated_at is distinct from p_expected_test_updated_at
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

  delete from public.assessment_drafts draft
  where draft.id = v_draft.id;

  delete from public.tests test
  where test.id = p_test_id;

  return jsonb_build_object('discarded', true);
end;
$$;

revoke all on function public.discard_pristine_test_draft_atomic(uuid, uuid, integer, timestamptz)
from public, anon, authenticated;

grant execute on function public.discard_pristine_test_draft_atomic(uuid, uuid, integer, timestamptz)
to service_role;

comment on function public.discard_pristine_test_draft_atomic(uuid, uuid, integer, timestamptz) is
  'Atomically deletes a newly-created untouched Test and its draft, fenced by the observed draft version and Test updated_at.';
