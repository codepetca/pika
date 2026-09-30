-- A stale document revision is an application conflict, not a transient
-- serialization failure. PostgREST 14 can retry custom 40001 errors indefinitely.
-- Keep the existing authorization, locking, and atomic-write contract intact.

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
    raise exception 'Assignment grade changed; reload and retry' using errcode = 'PT409';
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
