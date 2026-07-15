-- Start stamping new response mutations before the existing-row backfill.

create or replace function public.stamp_test_response_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('pika.classroom_archive_restore', true) = 'on'
    and current_user in ('postgres', 'service_role', 'supabase_admin')
  then
    new.revision := coalesce(new.revision, 1);
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    new.revision := coalesce(old.revision, 0) + 1;
  end if;
  if new.ai_grading_basis is null then
    new.ai_suggested_score := null;
    new.ai_suggested_feedback := null;
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_test_response_revision on public.test_responses;
create trigger stamp_test_response_revision
  before insert or update on public.test_responses
  for each row
  execute function public.stamp_test_response_revision();

create or replace function public.validate_test_ai_grading_item_response_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_response public.test_responses%rowtype;
begin
  if tg_op = 'UPDATE' and (
    new.response_id is distinct from old.response_id
    or new.test_id is distinct from old.test_id
    or new.student_id is distinct from old.student_id
    or new.question_id is distinct from old.question_id
    or (
      old.response_revision is not null
      and new.response_revision is distinct from old.response_revision
    )
  ) then
    raise exception 'AI grading item response snapshot is immutable' using errcode = '22023';
  end if;

  select response.*
  into v_response
  from public.test_responses response
  where response.id = new.response_id
  for share;

  if not found
    or v_response.test_id <> new.test_id
    or v_response.student_id <> new.student_id
    or v_response.question_id <> new.question_id
  then
    raise exception 'AI grading item response identity is invalid' using errcode = '22023';
  end if;

  if current_setting('pika.classroom_archive_restore', true) = 'on'
    and current_user in ('postgres', 'service_role', 'supabase_admin')
  then
    new.response_revision := coalesce(new.response_revision, v_response.revision);
  elsif new.response_revision is null then
    new.response_revision := v_response.revision;
  elsif new.response_revision <> v_response.revision then
    raise exception 'Test response grade changed; reload and retry' using errcode = '40001';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_test_ai_grading_item_response_revision
  on public.test_ai_grading_run_items;
create trigger validate_test_ai_grading_item_response_revision
  before insert or update of response_id, test_id, student_id, question_id, response_revision
  on public.test_ai_grading_run_items
  for each row
  execute function public.validate_test_ai_grading_item_response_revision();
