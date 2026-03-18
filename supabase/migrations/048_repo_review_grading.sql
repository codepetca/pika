-- Repo review grading: assignment mode, GitHub identity mapping, analysis runs/results

alter table public.assignments
  add column if not exists evaluation_mode text not null default 'document'
    check (evaluation_mode in ('document', 'repo_review'));

create table if not exists public.assignment_repo_reviews (
  assignment_id uuid primary key references public.assignments (id) on delete cascade,
  provider text not null default 'github' check (provider in ('github')),
  repo_owner text not null,
  repo_name text not null,
  default_branch text not null default 'main',
  review_start_at timestamptz,
  review_end_at timestamptz,
  include_pr_reviews boolean not null default true,
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_github_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  github_login text,
  commit_emails text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create unique index if not exists idx_user_github_identities_login
  on public.user_github_identities (lower(github_login))
  where github_login is not null;

create table if not exists public.assignment_repo_review_runs (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  triggered_by uuid not null references public.users (id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  source_ref text,
  metrics_version text not null default 'v1',
  prompt_version text not null default 'v1',
  model text,
  warnings_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_assignment_repo_review_runs_assignment_started
  on public.assignment_repo_review_runs (assignment_id, started_at desc);

create table if not exists public.assignment_repo_review_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.assignment_repo_review_runs (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  github_login text,
  commit_count integer not null default 0,
  active_days integer not null default 0,
  session_count integer not null default 0,
  burst_ratio numeric(6,4) not null default 0 check (burst_ratio >= 0 and burst_ratio <= 1),
  weighted_contribution numeric(12,4) not null default 0,
  relative_contribution_share numeric(6,4) not null default 0
    check (relative_contribution_share >= 0 and relative_contribution_share <= 1),
  spread_score numeric(6,4) not null default 0 check (spread_score >= 0 and spread_score <= 1),
  iteration_score numeric(6,4) not null default 0 check (iteration_score >= 0 and iteration_score <= 1),
  semantic_breakdown_json jsonb not null default '{}'::jsonb,
  timeline_json jsonb not null default '[]'::jsonb,
  evidence_json jsonb not null default '[]'::jsonb,
  draft_score_completion smallint check (draft_score_completion is null or (draft_score_completion >= 0 and draft_score_completion <= 10)),
  draft_score_thinking smallint check (draft_score_thinking is null or (draft_score_thinking >= 0 and draft_score_thinking <= 10)),
  draft_score_workflow smallint check (draft_score_workflow is null or (draft_score_workflow >= 0 and draft_score_workflow <= 10)),
  draft_feedback text,
  confidence numeric(6,4) not null default 0 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  unique (run_id, student_id)
);

create index if not exists idx_assignment_repo_review_results_assignment_student
  on public.assignment_repo_review_results (assignment_id, student_id);

create or replace function public.update_assignment_repo_reviews_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_assignment_repo_reviews_updated_at on public.assignment_repo_reviews;
create trigger update_assignment_repo_reviews_updated_at
  before update on public.assignment_repo_reviews
  for each row
  execute function public.update_assignment_repo_reviews_updated_at();

create or replace function public.update_user_github_identities_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_user_github_identities_updated_at on public.user_github_identities;
create trigger update_user_github_identities_updated_at
  before update on public.user_github_identities
  for each row
  execute function public.update_user_github_identities_updated_at();

alter table public.assignment_repo_reviews enable row level security;
alter table public.user_github_identities enable row level security;
alter table public.assignment_repo_review_runs enable row level security;
alter table public.assignment_repo_review_results enable row level security;

drop policy if exists "Teachers can view repo review configs" on public.assignment_repo_reviews;
create policy "Teachers can view repo review configs"
  on public.assignment_repo_reviews for select
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_repo_reviews.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can manage repo review configs" on public.assignment_repo_reviews;
create policy "Teachers can manage repo review configs"
  on public.assignment_repo_reviews for all
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_repo_reviews.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_repo_reviews.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Users can view their GitHub identity" on public.user_github_identities;
create policy "Users can view their GitHub identity"
  on public.user_github_identities for select
  using (user_id = auth.uid());

drop policy if exists "Users can manage their GitHub identity" on public.user_github_identities;
create policy "Users can manage their GitHub identity"
  on public.user_github_identities for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Teachers can view repo review runs" on public.assignment_repo_review_runs;
create policy "Teachers can view repo review runs"
  on public.assignment_repo_review_runs for select
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_repo_review_runs.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can create repo review runs" on public.assignment_repo_review_runs;
create policy "Teachers can create repo review runs"
  on public.assignment_repo_review_runs for insert
  with check (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_repo_review_runs.assignment_id
        and classrooms.teacher_id = auth.uid()
        and assignment_repo_review_runs.triggered_by = auth.uid()
    )
  );

drop policy if exists "Teachers can update repo review runs" on public.assignment_repo_review_runs;
create policy "Teachers can update repo review runs"
  on public.assignment_repo_review_runs for update
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_repo_review_runs.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can view repo review results" on public.assignment_repo_review_results;
create policy "Teachers can view repo review results"
  on public.assignment_repo_review_results for select
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_repo_review_results.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can manage repo review results" on public.assignment_repo_review_results;
create policy "Teachers can manage repo review results"
  on public.assignment_repo_review_results for all
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_repo_review_results.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_repo_review_results.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

alter table public.assignment_docs
  add column if not exists teacher_feedback_draft text,
  add column if not exists teacher_feedback_draft_updated_at timestamptz,
  add column if not exists feedback_returned_at timestamptz,
  add column if not exists ai_feedback_suggestion text,
  add column if not exists ai_feedback_suggested_at timestamptz,
  add column if not exists ai_feedback_model text;

create table if not exists public.assignment_feedback_entries (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  entry_kind text not null check (entry_kind in ('teacher_feedback', 'grading_feedback')),
  author_type text not null check (author_type in ('teacher', 'ai')),
  body text not null,
  returned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references public.users (id)
);

create index if not exists idx_assignment_feedback_entries_assignment_student_returned
  on public.assignment_feedback_entries (assignment_id, student_id, returned_at desc);

create table if not exists public.assignment_repo_targets (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  selected_repo_url text,
  repo_owner text,
  repo_name text,
  selection_mode text not null default 'auto'
    check (selection_mode in ('auto', 'teacher_selected', 'teacher_override')),
  validation_status text not null default 'missing'
    check (validation_status in ('missing', 'ambiguous', 'valid', 'invalid', 'private', 'inaccessible')),
  validation_message text,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create index if not exists idx_assignment_repo_targets_assignment_repo
  on public.assignment_repo_targets (assignment_id, lower(coalesce(repo_owner, '')), lower(coalesce(repo_name, '')));

alter table public.assignment_repo_review_runs
  add column if not exists repo_owner text,
  add column if not exists repo_name text;

create or replace function public.update_assignment_repo_targets_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_assignment_repo_targets_updated_at on public.assignment_repo_targets;
create trigger update_assignment_repo_targets_updated_at
  before update on public.assignment_repo_targets
  for each row
  execute function public.update_assignment_repo_targets_updated_at();

alter table public.assignment_feedback_entries enable row level security;
alter table public.assignment_repo_targets enable row level security;

drop policy if exists "Teachers can view assignment feedback entries" on public.assignment_feedback_entries;
create policy "Teachers can view assignment feedback entries"
  on public.assignment_feedback_entries for select
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_feedback_entries.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Students can view returned feedback entries" on public.assignment_feedback_entries;
create policy "Students can view returned feedback entries"
  on public.assignment_feedback_entries for select
  using (
    student_id = auth.uid()
  );

drop policy if exists "Teachers can manage assignment feedback entries" on public.assignment_feedback_entries;
create policy "Teachers can manage assignment feedback entries"
  on public.assignment_feedback_entries for all
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_feedback_entries.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_feedback_entries.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can view assignment repo targets" on public.assignment_repo_targets;
create policy "Teachers can view assignment repo targets"
  on public.assignment_repo_targets for select
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_repo_targets.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can manage assignment repo targets" on public.assignment_repo_targets;
create policy "Teachers can manage assignment repo targets"
  on public.assignment_repo_targets for all
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_repo_targets.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_repo_targets.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );
