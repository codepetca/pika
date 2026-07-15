-- Keep assignment visibility changes and feedback history in the same transaction.

alter table public.assignment_ai_grading_run_items
  add column if not exists assignment_doc_updated_at timestamptz;

drop trigger if exists guard_assignment_grade_contract on public.assignment_docs;
drop function if exists public.guard_assignment_grade_contract();

create or replace function public.save_assignment_grades_atomic(
  p_assignment_id uuid,
  p_student_ids uuid[],
  p_teacher_id uuid,
  p_expected_doc_updated_at_by_student jsonb,
  p_apply_grade boolean,
  p_score_completion integer,
  p_score_thinking integer,
  p_score_workflow integer,
  p_mark_graded boolean,
  p_apply_comments boolean,
  p_feedback text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom_id uuid;
  v_inserted_ids uuid[] := '{}'::uuid[];
  v_conflict_ids uuid[] := '{}'::uuid[];
  v_docs jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_assignment_id::text, 0));

  select a.classroom_id
  into v_classroom_id
  from public.assignments a
  join public.classrooms c on c.id = a.classroom_id
  where a.id = p_assignment_id
    and c.teacher_id = p_teacher_id
    and c.archived_at is null;

  if not found then
    raise exception 'Assignment mutation is not allowed' using errcode = '42501';
  end if;

  if cardinality(p_student_ids) = 0
    or jsonb_typeof(p_expected_doc_updated_at_by_student) <> 'object'
  then
    raise exception 'Grade revision contract is invalid' using errcode = '22023';
  end if;

  if p_apply_grade and (
    (p_score_completion is not null and p_score_completion not between 0 and 10)
    or (p_score_thinking is not null and p_score_thinking not between 0 and 10)
    or (p_score_workflow is not null and p_score_workflow not between 0 and 10)
    or (
      p_mark_graded
      and (p_score_completion is null or p_score_thinking is null or p_score_workflow is null)
    )
  ) then
    raise exception 'Final assignment grades require integer scores from 0 to 10'
      using errcode = '22023';
  end if;

  if (
    select count(*)
    from public.classroom_enrollments e
    where e.classroom_id = v_classroom_id
      and e.student_id = any(p_student_ids)
  ) <> cardinality(p_student_ids) then
    raise exception 'Student is not enrolled in this classroom' using errcode = '22023';
  end if;

  with inserted as (
    insert into public.assignment_docs (assignment_id, student_id)
    select p_assignment_id, requested.student_id
    from unnest(p_student_ids) as requested(student_id)
    where p_expected_doc_updated_at_by_student ? requested.student_id::text
      and jsonb_typeof(
        p_expected_doc_updated_at_by_student -> requested.student_id::text
      ) = 'null'
    on conflict (assignment_id, student_id) do nothing
    returning student_id
  )
  select coalesce(array_agg(student_id), '{}'::uuid[])
  into v_inserted_ids
  from inserted;

  perform 1
  from public.assignment_docs d
  where d.assignment_id = p_assignment_id
    and d.student_id = any(p_student_ids)
  for update;

  select coalesce(array_agg(requested.student_id order by requested.ordinality), '{}'::uuid[])
  into v_conflict_ids
  from unnest(p_student_ids) with ordinality as requested(student_id, ordinality)
  left join public.assignment_docs d
    on d.assignment_id = p_assignment_id
   and d.student_id = requested.student_id
  where d.id is null
    or not (p_expected_doc_updated_at_by_student ? requested.student_id::text)
    or (
      not (requested.student_id = any(v_inserted_ids))
      and (
        jsonb_typeof(
          p_expected_doc_updated_at_by_student -> requested.student_id::text
        ) = 'null'
        or d.updated_at is distinct from (
          p_expected_doc_updated_at_by_student ->> requested.student_id::text
        )::timestamptz
      )
    );

  if cardinality(v_conflict_ids) > 0 then
    raise exception 'Assignment grade changed; reload and retry' using errcode = '40001';
  end if;

  with updated as (
    update public.assignment_docs d
    set
      score_completion = case when p_apply_grade then p_score_completion else d.score_completion end,
      score_thinking = case when p_apply_grade then p_score_thinking else d.score_thinking end,
      score_workflow = case when p_apply_grade then p_score_workflow else d.score_workflow end,
      graded_at = case
        when not p_apply_grade then d.graded_at
        when p_mark_graded then p_now
        else null
      end,
      graded_by = case
        when not p_apply_grade then d.graded_by
        when p_mark_graded then 'teacher'
        else null
      end,
      teacher_feedback_draft = case
        when p_apply_comments then p_feedback
        else d.teacher_feedback_draft
      end,
      teacher_feedback_draft_updated_at = case
        when p_apply_comments then p_now
        else d.teacher_feedback_draft_updated_at
      end,
      ai_feedback_suggestion = case
        when p_apply_comments then null
        else d.ai_feedback_suggestion
      end,
      ai_feedback_suggested_at = case
        when p_apply_comments then null
        else d.ai_feedback_suggested_at
      end,
      ai_feedback_model = case
        when p_apply_comments then null
        else d.ai_feedback_model
      end
    where d.assignment_id = p_assignment_id
      and d.student_id = any(p_student_ids)
    returning d.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated) order by requested.ordinality), '[]'::jsonb)
  into v_docs
  from unnest(p_student_ids) with ordinality as requested(student_id, ordinality)
  join updated on updated.student_id = requested.student_id;

  return jsonb_build_object('docs', v_docs);
end;
$$;

drop function if exists public.save_assignment_ai_grade_atomic(
  uuid, uuid, uuid, timestamptz, integer, integer, integer, text, text, text, text, timestamptz
);

create or replace function public.save_assignment_ai_grade_atomic(
  p_assignment_id uuid,
  p_student_id uuid,
  p_teacher_id uuid,
  p_expected_doc_updated_at timestamptz,
  p_score_completion integer,
  p_score_thinking integer,
  p_score_workflow integer,
  p_feedback text,
  p_apply_teacher_feedback_draft boolean,
  p_mark_graded boolean,
  p_ai_feedback_suggestion text,
  p_ai_feedback_model text,
  p_graded_by text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom_id uuid;
  v_doc public.assignment_docs%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_assignment_id::text, 0));

  select a.classroom_id
  into v_classroom_id
  from public.assignments a
  join public.classrooms c on c.id = a.classroom_id
  where a.id = p_assignment_id
    and c.teacher_id = p_teacher_id
    and c.archived_at is null;

  if not found then
    raise exception 'Assignment mutation is not allowed' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.classroom_enrollments e
    where e.classroom_id = v_classroom_id
      and e.student_id = p_student_id
  ) then
    raise exception 'Student is not enrolled in this classroom' using errcode = '22023';
  end if;

  if p_score_completion is null
    or p_score_thinking is null
    or p_score_workflow is null
    or p_score_completion not between 0 and 10
    or p_score_thinking not between 0 and 10
    or p_score_workflow not between 0 and 10
  then
    raise exception 'AI grade scores must be integers from 0 to 10' using errcode = '22023';
  end if;

  select d.*
  into v_doc
  from public.assignment_docs d
  where d.assignment_id = p_assignment_id
    and d.student_id = p_student_id
  for update;

  if found then
    if p_expected_doc_updated_at is null
      or v_doc.updated_at is distinct from p_expected_doc_updated_at
    then
      raise exception 'Assignment grade changed; reload and retry' using errcode = '40001';
    end if;
  elsif p_expected_doc_updated_at is not null then
    raise exception 'Assignment grade changed; reload and retry' using errcode = '40001';
  else
    insert into public.assignment_docs (assignment_id, student_id)
    values (p_assignment_id, p_student_id)
    on conflict (assignment_id, student_id) do nothing
    returning * into v_doc;

    if not found then
      raise exception 'Assignment grade changed; reload and retry' using errcode = '40001';
    end if;
  end if;

  update public.assignment_docs d
  set
    score_completion = p_score_completion,
    score_thinking = p_score_thinking,
    score_workflow = p_score_workflow,
    teacher_feedback_draft = case
      when p_apply_teacher_feedback_draft then p_feedback
      else d.teacher_feedback_draft
    end,
    teacher_feedback_draft_updated_at = case
      when p_apply_teacher_feedback_draft then p_now
      else d.teacher_feedback_draft_updated_at
    end,
    ai_feedback_suggestion = p_ai_feedback_suggestion,
    ai_feedback_suggested_at = case
      when p_ai_feedback_suggestion is null then null
      else p_now
    end,
    ai_feedback_model = p_ai_feedback_model,
    graded_at = case when p_mark_graded then p_now else null end,
    graded_by = case when p_mark_graded then coalesce(p_graded_by, 'teacher') else null end
  where d.id = v_doc.id
  returning d.* into v_doc;

  return jsonb_build_object('docs', jsonb_build_array(to_jsonb(v_doc)));
end;
$$;

create or replace function public.save_assignment_ai_grades_atomic(
  p_assignment_id uuid,
  p_teacher_id uuid,
  p_grade_rows jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom_id uuid;
  v_inserted_ids uuid[] := '{}'::uuid[];
  v_conflict_ids uuid[] := '{}'::uuid[];
  v_docs jsonb := '[]'::jsonb;
  v_row_count integer := coalesce(jsonb_array_length(p_grade_rows), 0);
begin
  perform pg_advisory_xact_lock(hashtextextended(p_assignment_id::text, 0));

  select a.classroom_id
  into v_classroom_id
  from public.assignments a
  join public.classrooms c on c.id = a.classroom_id
  where a.id = p_assignment_id
    and c.teacher_id = p_teacher_id
    and c.archived_at is null;

  if not found then
    raise exception 'Assignment mutation is not allowed' using errcode = '42501';
  end if;

  if jsonb_typeof(p_grade_rows) <> 'array' or v_row_count = 0 or v_row_count > 100 then
    raise exception 'AI grade batch is invalid' using errcode = '22023';
  end if;

  if (
    select count(distinct grade.student_id)
    from jsonb_to_recordset(p_grade_rows) as grade(student_id uuid)
    join public.classroom_enrollments e
      on e.classroom_id = v_classroom_id
     and e.student_id = grade.student_id
  ) <> v_row_count then
    raise exception 'Student is not enrolled in this classroom' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_grade_rows) as grade(
      score_completion integer,
      score_thinking integer,
      score_workflow integer
    )
    where grade.score_completion is null
       or grade.score_thinking is null
       or grade.score_workflow is null
       or grade.score_completion not between 0 and 10
       or grade.score_thinking not between 0 and 10
       or grade.score_workflow not between 0 and 10
  ) then
    raise exception 'AI grade scores must be integers from 0 to 10' using errcode = '22023';
  end if;

  with inserted as (
    insert into public.assignment_docs (assignment_id, student_id)
    select p_assignment_id, grade.student_id
    from jsonb_to_recordset(p_grade_rows) as grade(
      student_id uuid,
      expected_doc_updated_at timestamptz
    )
    where grade.expected_doc_updated_at is null
    on conflict (assignment_id, student_id) do nothing
    returning student_id
  )
  select coalesce(array_agg(student_id), '{}'::uuid[])
  into v_inserted_ids
  from inserted;

  perform 1
  from public.assignment_docs d
  join jsonb_to_recordset(p_grade_rows) as grade(student_id uuid)
    on grade.student_id = d.student_id
  where d.assignment_id = p_assignment_id
  for update of d;

  select coalesce(array_agg(grade.student_id), '{}'::uuid[])
  into v_conflict_ids
  from jsonb_to_recordset(p_grade_rows) as grade(
    student_id uuid,
    expected_doc_updated_at timestamptz
  )
  left join public.assignment_docs d
    on d.assignment_id = p_assignment_id
   and d.student_id = grade.student_id
  where d.id is null
     or (
       not (grade.student_id = any(v_inserted_ids))
       and (
         grade.expected_doc_updated_at is null
         or d.updated_at is distinct from grade.expected_doc_updated_at
       )
     );

  if cardinality(v_conflict_ids) > 0 then
    raise exception 'Assignment grade changed; reload and retry' using errcode = '40001';
  end if;

  with grade_rows as (
    select *
    from jsonb_to_recordset(p_grade_rows) as grade(
      student_id uuid,
      score_completion integer,
      score_thinking integer,
      score_workflow integer,
      feedback text,
      apply_teacher_feedback_draft boolean,
      mark_graded boolean,
      ai_feedback_suggestion text,
      ai_feedback_model text,
      graded_by text
    )
  ),
  updated as (
    update public.assignment_docs d
    set
      score_completion = grade.score_completion,
      score_thinking = grade.score_thinking,
      score_workflow = grade.score_workflow,
      teacher_feedback_draft = case
        when grade.apply_teacher_feedback_draft then grade.feedback
        else d.teacher_feedback_draft
      end,
      teacher_feedback_draft_updated_at = case
        when grade.apply_teacher_feedback_draft then p_now
        else d.teacher_feedback_draft_updated_at
      end,
      ai_feedback_suggestion = grade.ai_feedback_suggestion,
      ai_feedback_suggested_at = case
        when grade.ai_feedback_suggestion is null then null
        else p_now
      end,
      ai_feedback_model = grade.ai_feedback_model,
      graded_at = case when grade.mark_graded then p_now else null end,
      graded_by = case
        when grade.mark_graded then coalesce(grade.graded_by, 'teacher')
        else null
      end
    from grade_rows grade
    where d.assignment_id = p_assignment_id
      and d.student_id = grade.student_id
    returning d.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated) order by updated.student_id), '[]'::jsonb)
  into v_docs
  from updated;

  return jsonb_build_object('docs', v_docs);
end;
$$;

create or replace function public.create_assignment_ai_grading_run_atomic(
  p_assignment_id uuid,
  p_teacher_id uuid,
  p_model text,
  p_requested_student_ids uuid[],
  p_selection_hash text,
  p_gradable_count integer,
  p_skipped_missing_count integer,
  p_skipped_empty_count integer,
  p_item_rows jsonb,
  p_now timestamptz default now()
)
returns public.assignment_ai_grading_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_count integer := coalesce(cardinality(p_requested_student_ids), 0);
  v_processed_count integer := greatest(coalesce(p_skipped_missing_count, 0), 0)
    + greatest(coalesce(p_skipped_empty_count, 0), 0);
  v_item_count integer := coalesce(jsonb_array_length(coalesce(p_item_rows, '[]'::jsonb)), 0);
  v_inserted_ids uuid[] := '{}'::uuid[];
  v_classroom_id uuid;
  v_run public.assignment_ai_grading_runs;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_assignment_id::text, 0));

  select a.classroom_id
  into v_classroom_id
    from public.assignments a
    join public.classrooms c on c.id = a.classroom_id
    where a.id = p_assignment_id
      and c.teacher_id = p_teacher_id
      and c.archived_at is null;

  if not found then
    raise exception 'Assignment mutation is not allowed' using errcode = '42501';
  end if;

  if (
    select count(distinct e.student_id)
    from public.classroom_enrollments e
    where e.classroom_id = v_classroom_id
      and e.student_id = any(p_requested_student_ids)
  ) <> v_requested_count then
    raise exception 'Student is not enrolled in this classroom' using errcode = '22023';
  end if;

  if v_item_count <> v_requested_count then
    raise exception 'Assignment AI grading run item payload count mismatch' using errcode = '22023';
  end if;

  with inserted as (
    insert into public.assignment_docs (assignment_id, student_id)
    select p_assignment_id, item.student_id
    from jsonb_to_recordset(coalesce(p_item_rows, '[]'::jsonb)) as item(
      student_id uuid,
      assignment_doc_updated_at timestamptz
    )
    where item.assignment_doc_updated_at is null
    on conflict (assignment_id, student_id) do nothing
    returning student_id
  )
  select coalesce(array_agg(student_id), '{}'::uuid[])
  into v_inserted_ids
  from inserted;

  perform 1
  from public.assignment_docs d
  join jsonb_to_recordset(coalesce(p_item_rows, '[]'::jsonb)) as item(student_id uuid)
    on item.student_id = d.student_id
  where d.assignment_id = p_assignment_id
  for update of d;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_item_rows, '[]'::jsonb)) as item(
      student_id uuid,
      assignment_doc_id uuid,
      assignment_doc_updated_at timestamptz,
      assignment_doc_revision_provided boolean
    )
    left join public.assignment_docs d
      on d.assignment_id = p_assignment_id
     and d.student_id = item.student_id
    where d.id is null
       or (
         coalesce(item.assignment_doc_revision_provided, false)
         and
         item.student_id = any(v_inserted_ids)
         and item.assignment_doc_id is not null
       )
       or (
         coalesce(item.assignment_doc_revision_provided, false)
         and
         not (item.student_id = any(v_inserted_ids))
         and (
           item.assignment_doc_id is distinct from d.id
           or item.assignment_doc_updated_at is null
           or d.updated_at is distinct from item.assignment_doc_updated_at
         )
       )
  ) then
    raise exception 'Assignment grade changed; reload and retry' using errcode = '40001';
  end if;

  insert into public.assignment_ai_grading_runs (
    assignment_id,
    status,
    triggered_by,
    model,
    requested_student_ids_json,
    selection_hash,
    requested_count,
    gradable_count,
    processed_count,
    completed_count,
    skipped_missing_count,
    skipped_empty_count,
    failed_count,
    error_samples_json,
    started_at,
    completed_at
  )
  values (
    p_assignment_id,
    case when greatest(coalesce(p_gradable_count, 0), 0) = 0 then 'completed' else 'queued' end,
    p_teacher_id,
    p_model,
    to_jsonb(coalesce(p_requested_student_ids, array[]::uuid[])),
    p_selection_hash,
    v_requested_count,
    greatest(coalesce(p_gradable_count, 0), 0),
    v_processed_count,
    0,
    greatest(coalesce(p_skipped_missing_count, 0), 0),
    greatest(coalesce(p_skipped_empty_count, 0), 0),
    0,
    '[]'::jsonb,
    case when greatest(coalesce(p_gradable_count, 0), 0) = 0 then p_now else null end,
    case when greatest(coalesce(p_gradable_count, 0), 0) = 0 then p_now else null end
  )
  returning * into v_run;

  insert into public.assignment_ai_grading_run_items (
    run_id,
    assignment_id,
    student_id,
    assignment_doc_id,
    assignment_doc_updated_at,
    queue_position,
    status,
    skip_reason,
    attempt_count,
    next_retry_at,
    last_error_code,
    last_error_message,
    started_at,
    completed_at
  )
  select
    v_run.id,
    p_assignment_id,
    item.student_id,
    item.assignment_doc_id,
    case
      when coalesce(item.assignment_doc_revision_provided, false)
        then item.assignment_doc_updated_at
      else d.updated_at
    end,
    coalesce(item.queue_position, 0),
    item.status,
    item.skip_reason,
    coalesce(item.attempt_count, 0),
    item.next_retry_at,
    item.last_error_code,
    item.last_error_message,
    item.started_at,
    item.completed_at
  from jsonb_to_recordset(coalesce(p_item_rows, '[]'::jsonb)) as item(
    student_id uuid,
    assignment_doc_id uuid,
    assignment_doc_updated_at timestamptz,
    assignment_doc_revision_provided boolean,
    queue_position integer,
    status text,
    skip_reason text,
    attempt_count integer,
    next_retry_at timestamptz,
    last_error_code text,
    last_error_message text,
    started_at timestamptz,
    completed_at timestamptz
  )
  join public.assignment_docs d
    on d.assignment_id = p_assignment_id
   and d.student_id = item.student_id;

  insert into public.assignment_docs (
    assignment_id,
    student_id,
    score_completion,
    score_thinking,
    score_workflow,
    teacher_feedback_draft,
    teacher_feedback_draft_updated_at,
    ai_feedback_suggestion,
    ai_feedback_suggested_at,
    ai_feedback_model,
    graded_at,
    graded_by
  )
  select
    p_assignment_id,
    item.student_id,
    0,
    0,
    0,
    'Missing',
    p_now,
    null,
    null,
    null,
    p_now,
    p_teacher_id::text
  from jsonb_to_recordset(coalesce(p_item_rows, '[]'::jsonb)) as item(
    student_id uuid,
    skip_reason text
  )
  where item.skip_reason in ('missing_doc', 'empty_doc')
  on conflict (assignment_id, student_id) do update
  set
    score_completion = excluded.score_completion,
    score_thinking = excluded.score_thinking,
    score_workflow = excluded.score_workflow,
    teacher_feedback_draft = excluded.teacher_feedback_draft,
    teacher_feedback_draft_updated_at = excluded.teacher_feedback_draft_updated_at,
    ai_feedback_suggestion = excluded.ai_feedback_suggestion,
    ai_feedback_suggested_at = excluded.ai_feedback_suggested_at,
    ai_feedback_model = excluded.ai_feedback_model,
    graded_at = excluded.graded_at,
    graded_by = excluded.graded_by;

  return v_run;
end;
$$;

create or replace function public.return_assignment_feedback_atomic(
  p_assignment_id uuid,
  p_student_id uuid,
  p_teacher_id uuid,
  p_feedback text,
  p_expected_doc_updated_at timestamptz,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom_id uuid;
  v_doc public.assignment_docs%rowtype;
  v_entry public.assignment_feedback_entries%rowtype;
  v_doc_existed boolean := false;
  v_feedback text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_assignment_id::text, 0));

  select a.classroom_id
  into v_classroom_id
  from public.assignments a
  join public.classrooms c on c.id = a.classroom_id
  where a.id = p_assignment_id
    and c.teacher_id = p_teacher_id
    and c.archived_at is null;

  if not found then
    raise exception 'Assignment mutation is not allowed' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.classroom_enrollments e
    where e.classroom_id = v_classroom_id
      and e.student_id = p_student_id
  ) then
    raise exception 'Student is not enrolled in this classroom' using errcode = '22023';
  end if;

  select d.*
  into v_doc
  from public.assignment_docs d
  where d.assignment_id = p_assignment_id
    and d.student_id = p_student_id
  for update;

  if found then
    v_doc_existed := true;
    if v_doc.updated_at is distinct from p_expected_doc_updated_at then
      return jsonb_build_object(
        'applied', false,
        'doc', to_jsonb(v_doc),
        'entry', null
      );
    end if;
  elsif p_expected_doc_updated_at is not null then
    return jsonb_build_object('applied', false, 'doc', null, 'entry', null);
  else
    insert into public.assignment_docs (
      assignment_id,
      student_id,
      content,
      is_submitted,
      submitted_at
    )
    values (
      p_assignment_id,
      p_student_id,
      jsonb_build_object('type', 'doc', 'content', jsonb_build_array()),
      false,
      null
    )
    on conflict (assignment_id, student_id) do nothing
    returning * into v_doc;

    if not found then
      select d.*
      into v_doc
      from public.assignment_docs d
      where d.assignment_id = p_assignment_id
        and d.student_id = p_student_id
      for update;

      return jsonb_build_object(
        'applied', false,
        'doc', to_jsonb(v_doc),
        'entry', null
      );
    end if;
  end if;

  if p_feedback is not null then
    v_feedback := btrim(p_feedback);
  else
    v_feedback := btrim(coalesce(v_doc.teacher_feedback_draft, ''));
  end if;

  if v_feedback = '' then
    raise exception 'Comment draft is required before returning comments' using errcode = '22023';
  end if;

  if v_doc_existed
    and p_feedback is not null
    and v_doc.teacher_feedback_draft is null
    and v_doc.feedback = v_feedback
    and v_doc.feedback_returned_at is not null
  then
    return jsonb_build_object(
      'applied', false,
      'doc', to_jsonb(v_doc),
      'entry', null
    );
  end if;

  insert into public.assignment_feedback_entries (
    assignment_id,
    student_id,
    entry_kind,
    author_type,
    body,
    returned_at,
    created_by
  )
  values (
    p_assignment_id,
    p_student_id,
    'teacher_feedback',
    'teacher',
    v_feedback,
    p_now,
    p_teacher_id
  )
  returning * into v_entry;

  update public.assignment_docs d
  set
    feedback = v_feedback,
    teacher_feedback_draft = null,
    teacher_feedback_draft_updated_at = null,
    ai_feedback_suggestion = null,
    ai_feedback_suggested_at = null,
    ai_feedback_model = null,
    feedback_returned_at = p_now
  where d.id = v_doc.id
  returning * into v_doc;

  return jsonb_build_object(
    'applied', true,
    'doc', to_jsonb(v_doc),
    'entry', to_jsonb(v_entry),
    'created_doc', not v_doc_existed
  );
end;
$$;

create or replace function public.return_assignment_docs_with_feedback_atomic(
  p_assignment_id uuid,
  p_student_ids uuid[],
  p_teacher_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom_id uuid;
  v_enrolled_ids uuid[] := '{}'::uuid[];
  v_unavailable_ids uuid[] := '{}'::uuid[];
  v_blocked_ids uuid[] := '{}'::uuid[];
  v_already_returned_ids uuid[] := '{}'::uuid[];
  v_actionable_ids uuid[] := '{}'::uuid[];
  v_inserted_missing_ids uuid[] := '{}'::uuid[];
  v_returned_ids uuid[] := '{}'::uuid[];
begin
  perform pg_advisory_xact_lock(hashtextextended(p_assignment_id::text, 0));

  select a.classroom_id
  into v_classroom_id
  from public.assignments a
  join public.classrooms c on c.id = a.classroom_id
  where a.id = p_assignment_id
    and c.teacher_id = p_teacher_id
    and c.archived_at is null;

  if not found then
    raise exception 'Assignment mutation is not allowed' using errcode = '42501';
  end if;

  select
    coalesce(array_agg(requested.student_id order by requested.ordinality)
      filter (where enrollment.student_id is not null), '{}'::uuid[]),
    coalesce(array_agg(requested.student_id order by requested.ordinality)
      filter (where enrollment.student_id is null), '{}'::uuid[])
  into v_enrolled_ids, v_unavailable_ids
  from unnest(p_student_ids) with ordinality as requested(student_id, ordinality)
  left join public.classroom_enrollments enrollment
    on enrollment.classroom_id = v_classroom_id
   and enrollment.student_id = requested.student_id;

  with inserted as (
    insert into public.assignment_docs (assignment_id, student_id)
    select p_assignment_id, enrolled.student_id
    from unnest(v_enrolled_ids) as enrolled(student_id)
    on conflict (assignment_id, student_id) do nothing
    returning student_id
  )
  select coalesce(array_agg(student_id), '{}'::uuid[])
  into v_inserted_missing_ids
  from inserted;

  perform 1
  from public.assignment_docs d
  where d.assignment_id = p_assignment_id
    and d.student_id = any(v_enrolled_ids)
  for update;

  select coalesce(array_agg(requested.student_id order by requested.ordinality), '{}'::uuid[])
  into v_blocked_ids
  from unnest(p_student_ids) with ordinality as requested(student_id, ordinality)
  join public.assignment_docs d
    on d.assignment_id = p_assignment_id
   and d.student_id = requested.student_id
  where requested.student_id = any(v_enrolled_ids)
    and num_nonnulls(d.score_completion, d.score_thinking, d.score_workflow) between 1 and 2;

  select coalesce(array_agg(requested.student_id order by requested.ordinality), '{}'::uuid[])
  into v_already_returned_ids
  from unnest(p_student_ids) with ordinality as requested(student_id, ordinality)
  join public.assignment_docs d
    on d.assignment_id = p_assignment_id
   and d.student_id = requested.student_id
  cross join lateral (
    select case
      when d.teacher_cleared_at is null then d.returned_at
      when d.returned_at is null then d.teacher_cleared_at
      else greatest(d.teacher_cleared_at, d.returned_at)
    end as full_return_at
  ) return_state
  where requested.student_id = any(v_enrolled_ids)
    and not (requested.student_id = any(v_blocked_ids))
    and return_state.full_return_at is not null
    and (
      not d.is_submitted
      or d.submitted_at is null
      or d.submitted_at <= return_state.full_return_at
    );

  select coalesce(array_agg(requested.student_id order by requested.ordinality)
    filter (where not (requested.student_id = any(v_inserted_missing_ids))
      and not (requested.student_id = any(v_blocked_ids))
      and not (requested.student_id = any(v_already_returned_ids))), '{}'::uuid[])
  into v_actionable_ids
  from unnest(p_student_ids) with ordinality as requested(student_id, ordinality)
  where requested.student_id = any(v_enrolled_ids);

  insert into public.assignment_feedback_entries (
    assignment_id,
    student_id,
    entry_kind,
    author_type,
    body,
    returned_at,
    created_by
  )
  select
    p_assignment_id,
    d.student_id,
    'grading_feedback',
    'teacher',
    btrim(d.teacher_feedback_draft),
    p_now,
    p_teacher_id
  from public.assignment_docs d
  where d.assignment_id = p_assignment_id
    and d.student_id = any(v_actionable_ids)
    and btrim(coalesce(d.teacher_feedback_draft, '')) <> '';

  select coalesce(array_agg(requested.student_id order by requested.ordinality), '{}'::uuid[])
  into v_returned_ids
  from unnest(p_student_ids) with ordinality as requested(student_id, ordinality)
  where requested.student_id = any(v_actionable_ids)
     or requested.student_id = any(v_inserted_missing_ids);

  update public.assignment_docs d
  set
    is_submitted = false,
    submitted_at = case
      when d.student_id = any(v_inserted_missing_ids) then null
      else d.submitted_at
    end,
    score_completion = case
      when d.student_id = any(v_inserted_missing_ids) then 0
      else d.score_completion
    end,
    score_thinking = case
      when d.student_id = any(v_inserted_missing_ids) then 0
      else d.score_thinking
    end,
    score_workflow = case
      when d.student_id = any(v_inserted_missing_ids) then 0
      else d.score_workflow
    end,
    graded_at = case
      when d.student_id = any(v_inserted_missing_ids) then p_now
      else d.graded_at
    end,
    graded_by = case
      when d.student_id = any(v_inserted_missing_ids) then 'teacher'
      else d.graded_by
    end,
    teacher_cleared_at = p_now,
    returned_at = p_now,
    feedback_returned_at = p_now,
    feedback = case
      when btrim(coalesce(d.teacher_feedback_draft, '')) <> '' then btrim(d.teacher_feedback_draft)
      else d.feedback
    end,
    teacher_feedback_draft = null,
    teacher_feedback_draft_updated_at = null,
    ai_feedback_suggestion = null,
    ai_feedback_suggested_at = null,
    ai_feedback_model = null
  where d.assignment_id = p_assignment_id
    and d.student_id = any(v_returned_ids);

  return jsonb_build_object(
    'returned_count', cardinality(v_returned_ids),
    'cleared_count', cardinality(v_returned_ids),
    'updated_count', cardinality(v_actionable_ids),
    'created_count', cardinality(v_inserted_missing_ids),
    'created_student_ids', to_jsonb(v_inserted_missing_ids),
    'returned_student_ids', to_jsonb(v_returned_ids),
    'blocked_count', cardinality(v_blocked_ids),
    'blocked_student_ids', to_jsonb(v_blocked_ids),
    'already_returned_count', cardinality(v_already_returned_ids),
    'already_returned_student_ids', to_jsonb(v_already_returned_ids),
    'missing_count', cardinality(v_unavailable_ids),
    'missing_student_ids', to_jsonb(v_unavailable_ids),
    'not_enrolled_count', cardinality(v_unavailable_ids),
    'not_enrolled_student_ids', to_jsonb(v_unavailable_ids),
    'mailbox_tracking_available', true
  );
end;
$$;

create or replace function public.finalize_assignment_ai_grading_item_atomic(
  p_item_id uuid,
  p_teacher_id uuid,
  p_score_completion integer,
  p_score_thinking integer,
  p_score_workflow integer,
  p_feedback text,
  p_apply_teacher_feedback_draft boolean,
  p_mark_graded boolean,
  p_ai_feedback_suggestion text,
  p_ai_feedback_model text,
  p_graded_by text,
  p_attempt_count integer,
  p_item_status text,
  p_skip_reason text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_student_id uuid;
  v_item_status text;
  v_triggered_by uuid;
  v_expected_doc_updated_at timestamptz;
  v_result jsonb;
  v_doc_id uuid;
begin
  select item.assignment_id
  into v_assignment_id
  from public.assignment_ai_grading_run_items item
  where item.id = p_item_id;

  if not found then
    raise exception 'Assignment AI grading item not found' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_assignment_id::text, 0));

  select item.student_id, item.status, item.assignment_doc_updated_at, run.triggered_by
  into v_student_id, v_item_status, v_expected_doc_updated_at, v_triggered_by
  from public.assignment_ai_grading_run_items item
  join public.assignment_ai_grading_runs run on run.id = item.run_id
  where item.id = p_item_id
    and item.assignment_id = v_assignment_id
  for update of item;

  if not found or v_triggered_by <> p_teacher_id then
    raise exception 'Assignment AI grading item mutation is not allowed' using errcode = '42501';
  end if;

  if v_item_status in ('completed', 'skipped') then
    select d.id
    into v_doc_id
    from public.assignment_docs d
    where d.assignment_id = v_assignment_id
      and d.student_id = v_student_id;

    if not found then
      raise exception 'Completed assignment AI grading item has no document' using errcode = '40001';
    end if;

    select jsonb_build_object('docs', jsonb_build_array(to_jsonb(d)))
    into v_result
    from public.assignment_docs d
    where d.id = v_doc_id;

    return v_result;
  end if;

  if v_item_status not in ('queued', 'processing')
    or p_item_status not in ('completed', 'skipped')
    or (p_item_status = 'completed' and p_skip_reason is not null)
    or (p_item_status = 'skipped' and p_skip_reason not in ('missing_doc', 'empty_doc'))
  then
    raise exception 'Assignment AI grading item state is invalid' using errcode = '22023';
  end if;

  v_result := public.save_assignment_ai_grade_atomic(
    v_assignment_id,
    v_student_id,
    p_teacher_id,
    v_expected_doc_updated_at,
    p_score_completion,
    p_score_thinking,
    p_score_workflow,
    p_feedback,
    p_apply_teacher_feedback_draft,
    p_mark_graded,
    p_ai_feedback_suggestion,
    p_ai_feedback_model,
    p_graded_by,
    p_now
  );

  v_doc_id := (v_result->'docs'->0->>'id')::uuid;

  update public.assignment_ai_grading_run_items item
  set
    assignment_doc_id = v_doc_id,
    status = p_item_status,
    skip_reason = p_skip_reason,
    attempt_count = greatest(coalesce(p_attempt_count, 0), item.attempt_count),
    next_retry_at = null,
    last_error_code = null,
    last_error_message = null,
    started_at = coalesce(item.started_at, p_now),
    completed_at = p_now
  where item.id = p_item_id;

  return v_result;
end;
$$;

create or replace function public.complete_assignment_repo_review_run_atomic(
  p_run_id uuid,
  p_teacher_id uuid,
  p_result_rows jsonb,
  p_grade_rows jsonb,
  p_source_ref text,
  p_model text,
  p_warnings jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_triggered_by uuid;
  v_status text;
  v_result_count integer := coalesce(jsonb_array_length(p_result_rows), 0);
  v_grade_count integer := coalesce(jsonb_array_length(p_grade_rows), 0);
  v_grade_result jsonb;
begin
  select run.assignment_id
  into v_assignment_id
  from public.assignment_repo_review_runs run
  where run.id = p_run_id;

  if not found then
    raise exception 'Assignment repo review run not found' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_assignment_id::text, 0));

  select run.triggered_by, run.status
  into v_triggered_by, v_status
  from public.assignment_repo_review_runs run
  where run.id = p_run_id
    and run.assignment_id = v_assignment_id
  for update;

  if not found or v_triggered_by <> p_teacher_id then
    raise exception 'Assignment repo review mutation is not allowed' using errcode = '42501';
  end if;

  if v_status = 'completed' then
    select jsonb_build_object(
      'docs', coalesce(jsonb_agg(to_jsonb(d) order by d.student_id), '[]'::jsonb)
    )
    into v_grade_result
    from public.assignment_docs d
    join public.assignment_repo_review_results result
      on result.assignment_id = d.assignment_id
     and result.student_id = d.student_id
    where result.run_id = p_run_id;

    return v_grade_result;
  end if;

  if v_status not in ('queued', 'running')
    or jsonb_typeof(p_result_rows) <> 'array'
    or jsonb_typeof(p_grade_rows) <> 'array'
    or v_result_count = 0
    or v_result_count <> v_grade_count
    or v_result_count > 100
  then
    raise exception 'Assignment repo review completion payload is invalid' using errcode = '22023';
  end if;

  v_grade_result := public.save_assignment_ai_grades_atomic(
    v_assignment_id,
    p_teacher_id,
    p_grade_rows,
    p_now
  );

  insert into public.assignment_repo_review_results (
    run_id,
    assignment_id,
    student_id,
    github_login,
    commit_count,
    active_days,
    session_count,
    burst_ratio,
    weighted_contribution,
    relative_contribution_share,
    spread_score,
    iteration_score,
    semantic_breakdown_json,
    timeline_json,
    evidence_json,
    draft_score_completion,
    draft_score_thinking,
    draft_score_workflow,
    draft_feedback,
    confidence
  )
  select
    p_run_id,
    v_assignment_id,
    result.student_id,
    result.github_login,
    result.commit_count,
    result.active_days,
    result.session_count,
    result.burst_ratio,
    result.weighted_contribution,
    result.relative_contribution_share,
    result.spread_score,
    result.iteration_score,
    result.semantic_breakdown_json,
    result.timeline_json,
    result.evidence_json,
    result.draft_score_completion,
    result.draft_score_thinking,
    result.draft_score_workflow,
    result.draft_feedback,
    result.confidence
  from jsonb_to_recordset(p_result_rows) as result(
    student_id uuid,
    github_login text,
    commit_count integer,
    active_days integer,
    session_count integer,
    burst_ratio double precision,
    weighted_contribution double precision,
    relative_contribution_share double precision,
    spread_score double precision,
    iteration_score double precision,
    semantic_breakdown_json jsonb,
    timeline_json jsonb,
    evidence_json jsonb,
    draft_score_completion integer,
    draft_score_thinking integer,
    draft_score_workflow integer,
    draft_feedback text,
    confidence double precision
  );

  update public.assignment_repo_review_runs run
  set
    status = 'completed',
    completed_at = p_now,
    source_ref = p_source_ref,
    model = p_model,
    warnings_json = coalesce(p_warnings, '[]'::jsonb)
  where run.id = p_run_id;

  return v_grade_result;
end;
$$;

-- Serialize roster cleanup with every assignment mutation in the classroom.
create or replace function public.remove_classroom_roster_entries_atomic(
  p_classroom_id uuid,
  p_roster_ids uuid[]
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_requested_count integer := 0;
  v_roster_count integer := 0;
  v_student_ids uuid[] := array[]::uuid[];
  v_assignment_ids uuid[] := array[]::uuid[];
  v_assignment_id uuid;
  v_deleted_entries integer := 0;
  v_deleted_assignment_docs integer := 0;
  v_deleted_enrollments integer := 0;
  v_deleted_roster_entries integer := 0;
begin
  with requested as (
    select distinct roster_id
    from unnest(coalesce(p_roster_ids, array[]::uuid[])) as requested(roster_id)
  )
  select count(*) into v_requested_count
  from requested;

  if v_requested_count = 0 then
    return jsonb_build_object(
      'requested_count', 0,
      'deleted_roster_entries', 0,
      'deleted_entries', 0,
      'deleted_assignment_docs', 0,
      'deleted_enrollments', 0
    );
  end if;

  perform 1
  from public.classrooms classroom
  where classroom.id = p_classroom_id
  for update;

  if not found then
    raise exception 'Classroom not found' using errcode = '22023';
  end if;

  select coalesce(array_agg(id order by id), array[]::uuid[])
  into v_assignment_ids
  from public.assignments
  where classroom_id = p_classroom_id;

  foreach v_assignment_id in array v_assignment_ids loop
    perform pg_advisory_xact_lock(hashtextextended(v_assignment_id::text, 0));
  end loop;

  with requested as (
    select distinct roster_id
    from unnest(coalesce(p_roster_ids, array[]::uuid[])) as requested(roster_id)
  ),
  target_roster as materialized (
    select roster.id, lower(trim(roster.email)) as email
    from public.classroom_roster roster
    join requested on requested.roster_id = roster.id
    where roster.classroom_id = p_classroom_id
    for update of roster
  )
  select
    count(*),
    coalesce(array_agg(users.id) filter (where users.id is not null), array[]::uuid[])
  into v_roster_count, v_student_ids
  from target_roster
  left join public.users users
    on lower(trim(users.email)) = target_roster.email;

  if v_roster_count <> v_requested_count then
    raise exception 'One or more roster entries not found in classroom'
      using errcode = '22023';
  end if;

  if coalesce(array_length(v_student_ids, 1), 0) > 0 then
    with deleted_entries as (
      delete from public.entries
      where classroom_id = p_classroom_id
        and student_id = any(v_student_ids)
      returning id
    )
    select count(*) into v_deleted_entries
    from deleted_entries;

    if coalesce(array_length(v_assignment_ids, 1), 0) > 0 then
      with deleted_assignment_docs as (
        delete from public.assignment_docs
        where student_id = any(v_student_ids)
          and assignment_id = any(v_assignment_ids)
        returning id
      )
      select count(*) into v_deleted_assignment_docs
      from deleted_assignment_docs;
    end if;

    with deleted_enrollments as (
      delete from public.classroom_enrollments
      where classroom_id = p_classroom_id
        and student_id = any(v_student_ids)
      returning id
    )
    select count(*) into v_deleted_enrollments
    from deleted_enrollments;
  end if;

  with requested as (
    select distinct roster_id
    from unnest(coalesce(p_roster_ids, array[]::uuid[])) as requested(roster_id)
  ),
  deleted_roster as (
    delete from public.classroom_roster roster
    using requested
    where roster.classroom_id = p_classroom_id
      and roster.id = requested.roster_id
    returning roster.id
  )
  select count(*) into v_deleted_roster_entries
  from deleted_roster;

  return jsonb_build_object(
    'requested_count', v_requested_count,
    'deleted_roster_entries', v_deleted_roster_entries,
    'deleted_entries', v_deleted_entries,
    'deleted_assignment_docs', v_deleted_assignment_docs,
    'deleted_enrollments', v_deleted_enrollments
  );
end;
$$;

revoke all on function public.save_assignment_grades_atomic(uuid, uuid[], uuid, jsonb, boolean, integer, integer, integer, boolean, boolean, text, timestamptz) from public;
revoke all on function public.save_assignment_ai_grade_atomic(uuid, uuid, uuid, timestamptz, integer, integer, integer, text, boolean, boolean, text, text, text, timestamptz) from public;
revoke all on function public.save_assignment_ai_grades_atomic(uuid, uuid, jsonb, timestamptz) from public;
revoke all on function public.create_assignment_ai_grading_run_atomic(uuid, uuid, text, uuid[], text, integer, integer, integer, jsonb, timestamptz) from public;
revoke all on function public.return_assignment_feedback_atomic(uuid, uuid, uuid, text, timestamptz, timestamptz) from public;
revoke all on function public.return_assignment_docs_with_feedback_atomic(uuid, uuid[], uuid, timestamptz) from public;
revoke all on function public.finalize_assignment_ai_grading_item_atomic(uuid, uuid, integer, integer, integer, text, boolean, boolean, text, text, text, integer, text, text, timestamptz) from public;
revoke all on function public.complete_assignment_repo_review_run_atomic(uuid, uuid, jsonb, jsonb, text, text, jsonb, timestamptz) from public;
grant execute on function public.save_assignment_grades_atomic(uuid, uuid[], uuid, jsonb, boolean, integer, integer, integer, boolean, boolean, text, timestamptz) to service_role;
grant execute on function public.save_assignment_ai_grade_atomic(uuid, uuid, uuid, timestamptz, integer, integer, integer, text, boolean, boolean, text, text, text, timestamptz) to service_role;
grant execute on function public.save_assignment_ai_grades_atomic(uuid, uuid, jsonb, timestamptz) to service_role;
grant execute on function public.create_assignment_ai_grading_run_atomic(uuid, uuid, text, uuid[], text, integer, integer, integer, jsonb, timestamptz) to service_role;
grant execute on function public.return_assignment_feedback_atomic(uuid, uuid, uuid, text, timestamptz, timestamptz) to service_role;
grant execute on function public.return_assignment_docs_with_feedback_atomic(uuid, uuid[], uuid, timestamptz) to service_role;
grant execute on function public.finalize_assignment_ai_grading_item_atomic(uuid, uuid, integer, integer, integer, text, boolean, boolean, text, text, text, integer, text, text, timestamptz) to service_role;
grant execute on function public.complete_assignment_repo_review_run_atomic(uuid, uuid, jsonb, jsonb, text, text, jsonb, timestamptz) to service_role;
