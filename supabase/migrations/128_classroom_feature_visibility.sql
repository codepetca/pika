alter table public.classrooms
  add column feature_visibility jsonb not null default '{
    "attendance": true,
    "classwork": true,
    "tests": true,
    "gradebook": true,
    "calendar": true,
    "syllabus": true,
    "announcements": true,
    "achievements": true
  }'::jsonb;

alter table public.classrooms
  add constraint classrooms_feature_visibility_shape_check
  check (
    jsonb_typeof(feature_visibility) = 'object'
    and jsonb_typeof(feature_visibility -> 'attendance') = 'boolean'
    and jsonb_typeof(feature_visibility -> 'classwork') = 'boolean'
    and jsonb_typeof(feature_visibility -> 'tests') = 'boolean'
    and jsonb_typeof(feature_visibility -> 'gradebook') = 'boolean'
    and jsonb_typeof(feature_visibility -> 'calendar') = 'boolean'
    and jsonb_typeof(feature_visibility -> 'syllabus') = 'boolean'
    and jsonb_typeof(feature_visibility -> 'announcements') = 'boolean'
    and jsonb_typeof(feature_visibility -> 'achievements') = 'boolean'
  );

comment on column public.classrooms.feature_visibility is
  'Classroom-scoped navigation feature preferences. Existing content is preserved when a feature is hidden.';

-- Cold archives created before this migration do not contain feature_visibility.
-- Restore validates an exact current-schema row, so adapt those classroom roots
-- to the same safe all-enabled default used for existing hot classrooms.
create or replace function public.normalize_classroom_archive_restore_row(
  p_operation_id uuid,
  p_table_name text,
  p_row jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_response_revision bigint;
  v_missing_response_revision boolean;
begin
  if p_table_name = 'classrooms' then
    if not (p_row ? 'feature_visibility') then
      p_row := p_row || jsonb_build_object(
        'feature_visibility',
        '{
          "attendance": true,
          "classwork": true,
          "tests": true,
          "gradebook": true,
          "calendar": true,
          "syllabus": true,
          "announcements": true,
          "achievements": true
        }'::jsonb
      );
    end if;
    return p_row;
  end if;

  if p_table_name = 'assignment_docs' then
    if not (p_row ? 'save_session_id') then
      p_row := p_row || jsonb_build_object('save_session_id', null);
    end if;
    if not (p_row ? 'save_sequence') then
      p_row := p_row || jsonb_build_object('save_sequence', null);
    end if;
    return p_row;
  end if;

  if p_table_name = 'test_responses' then
    if not (p_row ? 'revision') or jsonb_typeof(p_row->'revision') = 'null' then
      p_row := p_row || jsonb_build_object('revision', 1);
    end if;
    if not (p_row ? 'ai_suggested_score') then
      p_row := p_row || jsonb_build_object('ai_suggested_score', null);
    end if;
    if not (p_row ? 'ai_suggested_feedback') then
      p_row := p_row || jsonb_build_object('ai_suggested_feedback', null);
    end if;
    return p_row;
  end if;

  if p_table_name = 'test_ai_grading_run_items' then
    v_missing_response_revision := not (p_row ? 'response_revision')
      or jsonb_typeof(p_row->'response_revision') = 'null';
    if v_missing_response_revision then
      select coalesce((staged.row_data->>'revision')::bigint, 1)
      into v_response_revision
      from public.classroom_archive_restore_staging staged
      where staged.operation_id = p_operation_id
        and staged.table_name = 'test_responses'
        and staged.row_id::text = p_row->>'response_id';

      p_row := p_row || jsonb_build_object(
        'response_revision', coalesce(v_response_revision, 1)
      );
    end if;
    if p_row->>'status' in ('queued', 'processing') then
      p_row := p_row || jsonb_build_object(
        'status', 'failed',
        'next_retry_at', null,
        'last_error_code', case
          when v_missing_response_revision then 'revision_baseline_unavailable'
          when p_row->>'last_error_code' is null then 'archive_restore_invalidated'
          else p_row->>'last_error_code'
        end,
        'last_error_message', 'Retry this response in a new AI grading run',
        'completed_at', coalesce(p_row->'updated_at', p_row->'created_at')
      );
    end if;
    if not (p_row ? 'question_grading_snapshot') then
      p_row := p_row || jsonb_build_object('question_grading_snapshot', null);
    end if;
    return p_row;
  end if;

  if p_table_name = 'test_ai_grading_runs'
    and p_row->>'status' in ('queued', 'running')
  then
    p_row := p_row || jsonb_build_object(
      'status', 'failed',
      'processed_count', coalesce((p_row->>'queued_response_count')::integer, 0),
      'failed_count', greatest(
        coalesce((p_row->>'failed_count')::integer, 0),
        coalesce((p_row->>'queued_response_count')::integer, 0)
          - coalesce((p_row->>'completed_count')::integer, 0)
      ),
      'lease_token', null,
      'lease_expires_at', null,
      'completed_at', coalesce(p_row->'updated_at', p_row->'created_at')
    );
    return p_row;
  end if;

  return p_row;
end;
$$;
