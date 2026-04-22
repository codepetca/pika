create table if not exists public.test_ai_grading_runs (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'completed_with_errors', 'failed')),
  triggered_by uuid not null references public.users (id),
  model text,
  prompt_guideline_override text,
  requested_student_ids_json jsonb not null default '[]'::jsonb,
  selection_hash text not null,
  requested_count integer not null default 0 check (requested_count >= 0),
  eligible_student_count integer not null default 0 check (eligible_student_count >= 0),
  queued_response_count integer not null default 0 check (queued_response_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  skipped_unanswered_count integer not null default 0 check (skipped_unanswered_count >= 0),
  skipped_already_graded_count integer not null default 0 check (skipped_already_graded_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  error_samples_json jsonb not null default '[]'::jsonb,
  lease_token uuid,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_test_ai_grading_runs_test_created
  on public.test_ai_grading_runs (test_id, created_at desc);

create unique index if not exists idx_test_ai_grading_runs_one_active
  on public.test_ai_grading_runs (test_id)
  where status in ('queued', 'running');

create table if not exists public.test_ai_grading_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.test_ai_grading_runs (id) on delete cascade,
  test_id uuid not null references public.tests (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  question_id uuid not null references public.test_questions (id) on delete cascade,
  response_id uuid not null references public.test_responses (id) on delete cascade,
  queue_position integer not null default 0 check (queue_position >= 0),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_retry_at timestamptz,
  last_error_code text,
  last_error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, response_id),
  unique (run_id, student_id, question_id)
);

create index if not exists idx_test_ai_grading_run_items_run_queue
  on public.test_ai_grading_run_items (run_id, status, queue_position);

create index if not exists idx_test_ai_grading_run_items_test_student
  on public.test_ai_grading_run_items (test_id, student_id);

create or replace function public.update_test_ai_grading_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_test_ai_grading_runs_updated_at on public.test_ai_grading_runs;
create trigger update_test_ai_grading_runs_updated_at
  before update on public.test_ai_grading_runs
  for each row
  execute function public.update_test_ai_grading_updated_at();

drop trigger if exists update_test_ai_grading_run_items_updated_at on public.test_ai_grading_run_items;
create trigger update_test_ai_grading_run_items_updated_at
  before update on public.test_ai_grading_run_items
  for each row
  execute function public.update_test_ai_grading_updated_at();

create or replace function public.claim_test_ai_grading_run(
  p_run_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 60
)
returns setof public.test_ai_grading_runs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update public.test_ai_grading_runs
    set
      status = case
        when test_ai_grading_runs.status = 'queued' then 'running'
        else test_ai_grading_runs.status
      end,
      lease_token = p_lease_token,
      lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
      started_at = coalesce(test_ai_grading_runs.started_at, now()),
      completed_at = null
    where test_ai_grading_runs.id = p_run_id
      and test_ai_grading_runs.status in ('queued', 'running')
      and (
        test_ai_grading_runs.lease_expires_at is null
        or test_ai_grading_runs.lease_expires_at <= now()
      )
    returning test_ai_grading_runs.*;
end;
$$;

grant execute on function public.claim_test_ai_grading_run(uuid, uuid, integer) to authenticated, service_role;

alter table public.test_ai_grading_runs enable row level security;
alter table public.test_ai_grading_run_items enable row level security;

drop policy if exists "Teachers can view test ai grading runs" on public.test_ai_grading_runs;
create policy "Teachers can view test ai grading runs"
  on public.test_ai_grading_runs for select
  using (
    exists (
      select 1
      from public.tests
      join public.classrooms on classrooms.id = tests.classroom_id
      where tests.id = test_ai_grading_runs.test_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can manage test ai grading runs" on public.test_ai_grading_runs;
create policy "Teachers can manage test ai grading runs"
  on public.test_ai_grading_runs for all
  using (
    exists (
      select 1
      from public.tests
      join public.classrooms on classrooms.id = tests.classroom_id
      where tests.id = test_ai_grading_runs.test_id
        and classrooms.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.tests
      join public.classrooms on classrooms.id = tests.classroom_id
      where tests.id = test_ai_grading_runs.test_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can view test ai grading run items" on public.test_ai_grading_run_items;
create policy "Teachers can view test ai grading run items"
  on public.test_ai_grading_run_items for select
  using (
    exists (
      select 1
      from public.tests
      join public.classrooms on classrooms.id = tests.classroom_id
      where tests.id = test_ai_grading_run_items.test_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can manage test ai grading run items" on public.test_ai_grading_run_items;
create policy "Teachers can manage test ai grading run items"
  on public.test_ai_grading_run_items for all
  using (
    exists (
      select 1
      from public.tests
      join public.classrooms on classrooms.id = tests.classroom_id
      where tests.id = test_ai_grading_run_items.test_id
        and classrooms.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.tests
      join public.classrooms on classrooms.id = tests.classroom_id
      where tests.id = test_ai_grading_run_items.test_id
        and classrooms.teacher_id = auth.uid()
    )
  );
