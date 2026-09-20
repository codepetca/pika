-- Bind contextual assignment-document restores to the exact selected history
-- revision. History patches are reconstructed while the document and relevant
-- history rows are locked, and only database-derived content and metrics are
-- passed to the atomic save boundary.

begin;

create or replace function private.assignment_json_pointer_path_v1(p_pointer text)
returns text[]
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  v_token text;
  v_path text[] := array[]::text[];
begin
  if p_pointer = '' then
    return v_path;
  end if;
  if left(p_pointer, 1) <> '/' or p_pointer ~ '~([^01]|$)' then
    raise exception using errcode = '22023', message = 'Invalid assignment history JSON pointer';
  end if;

  foreach v_token in array regexp_split_to_array(substr(p_pointer, 2), '/') loop
    v_path := array_append(v_path, replace(replace(v_token, '~1', '/'), '~0', '~'));
  end loop;
  return v_path;
end;
$function$;

create or replace function private.apply_assignment_json_patch_v1(
  p_document jsonb,
  p_patch jsonb
)
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  v_document jsonb := p_document;
  v_operation jsonb;
  v_operation_name text;
  v_path text[];
  v_path_length integer;
  v_parent_path text[];
  v_parent jsonb;
  v_last_token text;
  v_array_index bigint;
begin
  if jsonb_typeof(p_patch) <> 'array' then
    raise exception using errcode = '22023', message = 'Invalid assignment history patch';
  end if;

  for v_operation in select value from jsonb_array_elements(p_patch) loop
    if jsonb_typeof(v_operation) <> 'object'
      or jsonb_typeof(v_operation->'op') <> 'string'
      or jsonb_typeof(v_operation->'path') <> 'string'
    then
      raise exception using errcode = '22023', message = 'Invalid assignment history patch operation';
    end if;

    v_operation_name := v_operation->>'op';
    if v_operation_name not in ('add', 'remove', 'replace')
      or (v_operation_name in ('add', 'replace') and not (v_operation ? 'value'))
    then
      raise exception using errcode = '22023', message = 'Unsupported assignment history patch operation';
    end if;

    v_path := private.assignment_json_pointer_path_v1(v_operation->>'path');
    v_path_length := coalesce(array_length(v_path, 1), 0);
    if v_path_length = 0 then
      if v_operation_name = 'remove' then
        raise exception using errcode = '22023', message = 'Invalid assignment history root removal';
      end if;
      v_document := v_operation->'value';
      continue;
    end if;

    v_parent_path := case
      when v_path_length = 1 then array[]::text[]
      else v_path[1:v_path_length - 1]
    end;
    v_parent := case
      when v_path_length = 1 then v_document
      else v_document #> v_parent_path
    end;
    v_last_token := v_path[v_path_length];

    if v_parent is null or jsonb_typeof(v_parent) not in ('object', 'array') then
      raise exception using errcode = '22023', message = 'Invalid assignment history patch path';
    end if;

    if jsonb_typeof(v_parent) = 'array' then
      if v_operation_name = 'add' and v_last_token = '-' then
        v_array_index := jsonb_array_length(v_parent);
        v_path[v_path_length] := v_array_index::text;
      elsif v_last_token !~ '^(0|[1-9][0-9]*)$' then
        raise exception using errcode = '22023', message = 'Invalid assignment history array index';
      else
        begin
          v_array_index := v_last_token::bigint;
        exception when numeric_value_out_of_range then
          raise exception using errcode = '22023', message = 'Invalid assignment history array index';
        end;
        if v_array_index > 2147483647 then
          raise exception using errcode = '22023', message = 'Invalid assignment history array index';
        end if;
      end if;

      if (v_operation_name = 'add' and v_array_index > jsonb_array_length(v_parent))
        or (v_operation_name in ('remove', 'replace') and v_array_index >= jsonb_array_length(v_parent))
      then
        raise exception using errcode = '22023', message = 'Invalid assignment history array index';
      end if;
    elsif v_operation_name in ('remove', 'replace')
      and v_document #> v_path is null
    then
      raise exception using errcode = '22023', message = 'Invalid assignment history patch path';
    end if;

    if v_operation_name = 'add' and jsonb_typeof(v_parent) = 'array' then
      v_document := jsonb_insert(v_document, v_path, v_operation->'value', false);
    elsif v_operation_name in ('add', 'replace') then
      v_document := jsonb_set(v_document, v_path, v_operation->'value', v_operation_name = 'add');
    else
      v_document := v_document #- v_path;
    end if;
  end loop;

  return v_document;
end;
$function$;

revoke all on function private.assignment_json_pointer_path_v1(text)
  from public, anon, authenticated;
revoke all on function private.apply_assignment_json_patch_v1(jsonb, jsonb)
  from public, anon, authenticated;

create or replace function public.restore_assignment_doc_for_member_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_history_id uuid,
  p_content jsonb,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_snapshot jsonb,
  p_word_count integer,
  p_char_count integer,
  p_save_session_id uuid,
  p_save_sequence bigint,
  p_metric_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_initial_classroom_id uuid;
  v_assignment_classroom_id uuid;
  v_assignment_is_draft boolean;
  v_assignment_released_at timestamptz;
  v_archived_at timestamptz;
  v_doc public.assignment_docs;
  v_target public.assignment_doc_history;
  v_baseline public.assignment_doc_history;
  v_history public.assignment_doc_history;
  v_target_content jsonb;
  v_result jsonb;
begin
  if p_actor_id is null
    or p_assignment_id is null
    or p_history_id is null
    or p_content is null
    or p_expected_updated_at is null
    or p_save_session_id is null
    or p_save_sequence is null
    or p_save_sequence <= 0
    or p_metric_session_id is null
  then
    raise exception using errcode = '22023', message = 'Invalid assignment restore request';
  end if;
  if (p_patch is not null and jsonb_typeof(p_patch) <> 'array')
    or (p_snapshot is not null and jsonb_typeof(p_snapshot) <> 'object')
    or coalesce(p_word_count, 0) < 0
    or coalesce(p_char_count, 0) < 0
  then
    raise exception using errcode = '22023', message = 'Invalid assignment restore evidence';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || p_assignment_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(p_assignment_id::text || ':' || p_actor_id::text, 0)
  );

  select assignment.classroom_id
  into v_initial_classroom_id
  from public.assignments as assignment
  where assignment.id = p_assignment_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || v_initial_classroom_id::text, 0)
  );
  perform private.try_lock_classroom_membership_change(
    v_initial_classroom_id,
    p_actor_id
  );

  select
    assignment.classroom_id,
    assignment.is_draft,
    assignment.released_at,
    classroom.archived_at
  into
    v_assignment_classroom_id,
    v_assignment_is_draft,
    v_assignment_released_at,
    v_archived_at
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = p_assignment_id
  for share of classroom, assignment;

  if not found
    or v_assignment_classroom_id is distinct from v_initial_classroom_id
  then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;

  if v_archived_at is not null
    or v_assignment_is_draft
    or v_assignment_released_at > clock_timestamp()
  then
    raise exception using errcode = 'P0002', message = 'Assignment not found';
  end if;

  perform 1
  from public.classroom_enrollments as enrollment
  where enrollment.classroom_id = v_assignment_classroom_id
    and enrollment.student_id = p_actor_id
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;

  select doc.*
  into v_doc
  from public.assignment_docs as doc
  where doc.assignment_id = p_assignment_id
    and doc.student_id = p_actor_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment doc not found';
  end if;

  select history.*
  into v_target
  from public.assignment_doc_history as history
  where history.id = p_history_id
    and history.assignment_doc_id = v_doc.id
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'History entry not found';
  end if;

  select history.*
  into v_baseline
  from public.assignment_doc_history as history
  where history.assignment_doc_id = v_doc.id
    and history.snapshot is not null
    and (history.created_at, history.id) <= (v_target.created_at, v_target.id)
  order by history.created_at desc, history.id desc
  limit 1
  for share;

  if not found then
    raise exception using errcode = '22023', message = 'Assignment history baseline is missing';
  end if;

  v_target_content := v_baseline.snapshot;
  for v_history in
    select history.*
    from public.assignment_doc_history as history
    where history.assignment_doc_id = v_doc.id
      and (history.created_at, history.id) > (v_baseline.created_at, v_baseline.id)
      and (history.created_at, history.id) <= (v_target.created_at, v_target.id)
    order by history.created_at, history.id
    for share
  loop
    if v_history.snapshot is not null then
      v_target_content := v_history.snapshot;
    elsif v_history.patch is not null then
      v_target_content := private.apply_assignment_json_patch_v1(
        v_target_content,
        v_history.patch
      );
    else
      raise exception using errcode = '22023', message = 'Assignment history entry has no content';
    end if;
  end loop;

  if v_target_content is distinct from p_content then
    raise exception using errcode = '22023', message = 'Assignment restore content does not match history target';
  end if;

  v_result := public.save_assignment_doc_atomic(
    p_assignment_id,
    p_actor_id,
    v_target_content,
    p_expected_updated_at,
    'restore',
    0,
    0,
    null,
    v_target_content,
    v_target.word_count,
    v_target.char_count,
    p_save_session_id,
    p_save_sequence,
    p_metric_session_id
  );

  if jsonb_typeof(v_result) is distinct from 'object'
    or jsonb_typeof(v_result->'ok') is distinct from 'boolean'
  then
    raise exception using errcode = '22023', message = 'Invalid assignment restore result';
  end if;

  if (v_result->>'ok')::boolean and (
    v_result->'doc'->>'assignment_id' is distinct from p_assignment_id::text
    or v_result->'doc'->>'student_id' is distinct from p_actor_id::text
    or v_result->'doc'->'content' is distinct from v_target_content
    or (
      v_result->'history_entry' is not null
      and v_result->'history_entry' <> 'null'::jsonb
      and (
        v_result->'history_entry'->>'assignment_doc_id'
          is distinct from v_result->'doc'->>'id'
        or v_result->'history_entry'->'snapshot' is distinct from v_target_content
        or v_result->'history_entry'->'patch' is distinct from 'null'::jsonb
        or (v_result->'history_entry'->>'word_count')::integer is distinct from v_target.word_count
        or (v_result->'history_entry'->>'char_count')::integer is distinct from v_target.char_count
      )
    )
  ) then
    raise exception using errcode = '22023', message = 'Invalid assignment restore result';
  end if;

  return v_result || jsonb_build_object('classroom_id', v_assignment_classroom_id);
end;
$function$;

revoke all on function public.restore_assignment_doc_for_member_v1(
  uuid, uuid, uuid, jsonb, timestamptz, jsonb, jsonb,
  integer, integer, uuid, bigint, uuid
) from public, anon, authenticated;
grant execute on function public.restore_assignment_doc_for_member_v1(
  uuid, uuid, uuid, jsonb, timestamptz, jsonb, jsonb,
  integer, integer, uuid, bigint, uuid
) to service_role;

comment on function public.restore_assignment_doc_for_member_v1(
  uuid, uuid, uuid, jsonb, timestamptz, jsonb, jsonb,
  integer, integer, uuid, bigint, uuid
) is
  'Dormant service-only assignment restore with current member, live assignment, locked exact history reconstruction and atomic save enforcement.';

commit;
