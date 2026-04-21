create table if not exists public.assignment_ai_grading_runs (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'completed_with_errors', 'failed')),
  triggered_by uuid not null references public.users (id),
  model text,
  requested_student_ids_json jsonb not null default '[]'::jsonb,
  selection_hash text not null,
  requested_count integer not null default 0 check (requested_count >= 0),
  gradable_count integer not null default 0 check (gradable_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  skipped_missing_count integer not null default 0 check (skipped_missing_count >= 0),
  skipped_empty_count integer not null default 0 check (skipped_empty_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  error_samples_json jsonb not null default '[]'::jsonb,
  lease_token uuid,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_assignment_ai_grading_runs_assignment_created
  on public.assignment_ai_grading_runs (assignment_id, created_at desc);

create unique index if not exists idx_assignment_ai_grading_runs_one_active
  on public.assignment_ai_grading_runs (assignment_id)
  where status in ('queued', 'running');

create table if not exists public.assignment_ai_grading_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.assignment_ai_grading_runs (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  assignment_doc_id uuid references public.assignment_docs (id) on delete set null,
  queue_position integer not null default 0 check (queue_position >= 0),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'skipped', 'failed')),
  skip_reason text
    check (skip_reason is null or skip_reason in ('missing_doc', 'empty_doc')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_retry_at timestamptz,
  last_error_code text,
  last_error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, student_id)
);

create index if not exists idx_assignment_ai_grading_run_items_run_queue
  on public.assignment_ai_grading_run_items (run_id, status, queue_position);

create index if not exists idx_assignment_ai_grading_run_items_assignment_student
  on public.assignment_ai_grading_run_items (assignment_id, student_id);

create or replace function public.update_assignment_ai_grading_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_assignment_ai_grading_runs_updated_at on public.assignment_ai_grading_runs;
create trigger update_assignment_ai_grading_runs_updated_at
  before update on public.assignment_ai_grading_runs
  for each row
  execute function public.update_assignment_ai_grading_updated_at();

drop trigger if exists update_assignment_ai_grading_run_items_updated_at on public.assignment_ai_grading_run_items;
create trigger update_assignment_ai_grading_run_items_updated_at
  before update on public.assignment_ai_grading_run_items
  for each row
  execute function public.update_assignment_ai_grading_updated_at();

create or replace function public.claim_assignment_ai_grading_run(
  p_run_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 60
)
returns setof public.assignment_ai_grading_runs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update public.assignment_ai_grading_runs
    set
      status = case
        when assignment_ai_grading_runs.status = 'queued' then 'running'
        else assignment_ai_grading_runs.status
      end,
      lease_token = p_lease_token,
      lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
      started_at = coalesce(assignment_ai_grading_runs.started_at, now()),
      completed_at = null
    where assignment_ai_grading_runs.id = p_run_id
      and assignment_ai_grading_runs.status in ('queued', 'running')
      and (
        assignment_ai_grading_runs.lease_expires_at is null
        or assignment_ai_grading_runs.lease_expires_at <= now()
      )
    returning assignment_ai_grading_runs.*;
end;
$$;

grant execute on function public.claim_assignment_ai_grading_run(uuid, uuid, integer) to authenticated, service_role;

alter table public.assignment_ai_grading_runs enable row level security;
alter table public.assignment_ai_grading_run_items enable row level security;

drop policy if exists "Teachers can view assignment ai grading runs" on public.assignment_ai_grading_runs;
create policy "Teachers can view assignment ai grading runs"
  on public.assignment_ai_grading_runs for select
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_ai_grading_runs.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can manage assignment ai grading runs" on public.assignment_ai_grading_runs;
create policy "Teachers can manage assignment ai grading runs"
  on public.assignment_ai_grading_runs for all
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_ai_grading_runs.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_ai_grading_runs.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can view assignment ai grading run items" on public.assignment_ai_grading_run_items;
create policy "Teachers can view assignment ai grading run items"
  on public.assignment_ai_grading_run_items for select
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_ai_grading_run_items.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can manage assignment ai grading run items" on public.assignment_ai_grading_run_items;
create policy "Teachers can manage assignment ai grading run items"
  on public.assignment_ai_grading_run_items for all
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_ai_grading_run_items.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_ai_grading_run_items.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );
