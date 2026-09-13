-- Forward correction for the removed-membership academic stage.173 is immutable.
-- A repo-review request can hold student work in memory before its run INSERT.
-- Serialize that INSERT with removal/cleanup and reject it while any student
-- purge fence remains in the classroom, before the route sends remote work.
-- Existing runs still block cleanup through173's remote-copy policy.
begin;

create or replace function public.reject_student_indirect_change_during_purge()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_rows jsonb[] := case when tg_op = 'INSERT' then array[to_jsonb(new)]
    when tg_op = 'DELETE' then array[to_jsonb(old)] else array[to_jsonb(old), to_jsonb(new)] end;
  v_classroom_id uuid;
  v_student_id uuid;
begin
  if tg_op='DELETE' and private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old)) then return old; end if;
  if tg_table_name='classroom_roster' and tg_op='UPDATE'
    and private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old),to_jsonb(new)) then return new; end if;
  if current_setting('pika.student_purge_finalize', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  foreach v_row in array v_rows loop
    v_classroom_id := null;
    v_student_id := null;
    if tg_table_name in ('assignment_doc_history', 'assignment_doc_save_operations') then
      select assignment.classroom_id, doc.student_id into v_classroom_id, v_student_id
      from public.assignment_docs doc join public.assignments assignment on assignment.id = doc.assignment_id
      where doc.id = nullif(v_row->>'assignment_doc_id', '')::uuid;
    elsif tg_table_name = 'test_attempt_history' then
      select test.classroom_id, attempt.student_id into v_classroom_id, v_student_id
      from public.test_attempts attempt join public.tests test on test.id = attempt.test_id
      where attempt.id = nullif(v_row->>'test_attempt_id', '')::uuid;
    elsif tg_table_name in ('assignment_ai_grading_runs', 'assignment_repo_review_runs') then
      select assignment.classroom_id into v_classroom_id from public.assignments assignment
      where assignment.id = nullif(v_row->>'assignment_id', '')::uuid;
    elsif tg_table_name = 'test_ai_grading_runs' then
      select test.classroom_id into v_classroom_id from public.tests test
      where test.id = nullif(v_row->>'test_id', '')::uuid;
    elsif tg_table_name = 'log_summaries' then
      v_classroom_id := nullif(v_row->>'classroom_id', '')::uuid;
    elsif tg_table_name = 'developer_feedback_candidates' then
      if exists (select 1 from public.student_purge_fences fence
        where (v_row->'source_classroom_ids') ? fence.classroom_id::text)
      then raise exception using errcode = '55000', message = 'student_purge_active'; end if;
      continue;
    end if;
    if v_classroom_id is not null then
      if v_student_id is null then
        perform pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:' || v_classroom_id::text, 0));
      else
        perform public.student_purge_lock(v_classroom_id, v_student_id);
      end if;
      if exists (select 1 from public.student_purge_fences fence
        where fence.classroom_id = v_classroom_id
          and (v_student_id is null or fence.student_id = v_student_id))
      then raise exception using errcode = '55000', message = 'student_purge_active'; end if;
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger student_purge_indirect_guard_assignment_repo_review_runs
  before insert or update or delete on public.assignment_repo_review_runs
  for each row execute function public.reject_student_indirect_change_during_purge();

revoke all on function public.reject_student_indirect_change_during_purge()
  from public,anon,authenticated,service_role;
commit;
