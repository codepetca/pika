-- Atomically return assignment docs and auto-finalize draft-scored docs.
-- This prevents partial commits where one update succeeds and another fails.

create or replace function public.return_assignment_docs_atomic(
  p_assignment_id uuid,
  p_student_ids uuid[],
  p_teacher_id uuid,
  p_now timestamptz default now()
)
returns table (
  returned_count integer,
  skipped_count integer
)
language plpgsql
as $$
begin
  return query
  with candidate_docs as (
    select
      d.id,
      (
        d.graded_at is not null
        or (
          d.graded_at is null
          and d.score_completion is not null
          and d.score_thinking is not null
          and d.score_workflow is not null
        )
      ) as is_eligible,
      (
        d.graded_at is null
        and d.score_completion is not null
        and d.score_thinking is not null
        and d.score_workflow is not null
      ) as should_finalize
    from public.assignment_docs d
    where d.assignment_id = p_assignment_id
      and d.student_id = any(p_student_ids)
    for update
  ),
  updated as (
    update public.assignment_docs d
    set
      returned_at = p_now,
      is_submitted = false,
      graded_at = case
        when c.should_finalize then p_now
        else d.graded_at
      end,
      graded_by = case
        when c.should_finalize then p_teacher_id::text
        else d.graded_by
      end
    from candidate_docs c
    where d.id = c.id
      and c.is_eligible
    returning d.id
  )
  select
    count(*)::integer as returned_count,
    greatest(coalesce(cardinality(p_student_ids), 0) - count(*), 0)::integer as skipped_count
  from updated;
end;
$$;
