-- Atomically attach a fetched link snapshot without overwriting concurrent
-- document edits or mutating tests in archived classrooms.

create or replace function public.sync_test_document_snapshot_atomic(
  p_teacher_id uuid,
  p_test_id uuid,
  p_document_id text,
  p_expected_url text,
  p_snapshot_path text,
  p_snapshot_content_type text,
  p_synced_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_archived_at timestamptz;
  v_documents jsonb;
  v_document jsonb;
  v_document_index integer;
  v_owner_id uuid;
  v_previous_snapshot_path text;
  v_test public.tests%rowtype;
begin
  select c.teacher_id, c.archived_at
    into v_owner_id, v_archived_at
  from public.tests t
  join public.classrooms c on c.id = t.classroom_id
  where t.id = p_test_id
  for update of t, c;

  if not found then
    raise exception using errcode = 'P0002', message = 'test_not_found';
  end if;

  if v_owner_id is distinct from p_teacher_id then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  if v_archived_at is not null then
    raise exception using errcode = '55000', message = 'classroom_archived';
  end if;

  select t.*
    into strict v_test
  from public.tests t
  where t.id = p_test_id;

  v_documents := coalesce(v_test.documents, '[]'::jsonb);

  select document.value, (document.ordinality - 1)::integer
    into v_document, v_document_index
  from jsonb_array_elements(v_documents) with ordinality as document(value, ordinality)
  where document.value ->> 'id' = p_document_id
  limit 1;

  if v_document is null
    or v_document ->> 'source' is distinct from 'link'
    or v_document ->> 'url' is distinct from p_expected_url
  then
    raise exception using errcode = '40001', message = 'document_conflict';
  end if;

  v_previous_snapshot_path := nullif(v_document ->> 'snapshot_path', '');
  v_document := (v_document - 'snapshot_path' - 'snapshot_content_type' - 'synced_at')
    || jsonb_build_object(
      'snapshot_path', p_snapshot_path,
      'snapshot_content_type', p_snapshot_content_type,
      'synced_at', p_synced_at
    );
  v_documents := jsonb_set(
    v_documents,
    array[v_document_index::text],
    v_document,
    false
  );

  update public.tests
  set documents = v_documents
  where id = p_test_id
  returning * into strict v_test;

  return jsonb_build_object(
    'previous_snapshot_path', v_previous_snapshot_path,
    'test', to_jsonb(v_test)
  );
end;
$$;

revoke all on function public.sync_test_document_snapshot_atomic(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.sync_test_document_snapshot_atomic(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamptz
) to service_role;
