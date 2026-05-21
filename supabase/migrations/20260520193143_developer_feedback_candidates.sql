-- Developer feedback candidates from daily logs and direct Send Feedback submissions.
-- Stores sanitized, AI-rewritten product-improvement requests only.
-- Raw student log text and direct identifiers must not be stored here.

create table if not exists public.developer_feedback_candidates (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  source_type text not null default 'daily_log'
    check (source_type in ('daily_log', 'direct_feedback')),
  title text not null,
  original_request text not null,
  refined_request text not null,
  implementation_hint text,
  affected_area text,
  suggested_agent text not null default 'codex'
    check (suggested_agent in ('codex', 'claude', 'either')),
  confidence numeric not null default 0
    check (confidence >= 0 and confidence <= 1),
  signal_count integer not null default 1
    check (signal_count >= 1),
  source_entry_count integer not null default 0
    check (source_entry_count >= 0),
  source_classroom_ids uuid[] not null default '{}',
  source_dates date[] not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_seen_date date,
  model text,
  status text not null default 'new'
    check (status in ('new', 'approved', 'in_progress', 'pr_opened', 'done', 'dismissed')),
  status_note text,
  status_updated_at timestamptz not null default now(),
  direct_feedback_category text
    check (direct_feedback_category is null or direct_feedback_category in ('bug', 'suggestion')),
  submitter_user_id uuid references public.users(id) on delete set null,
  submitter_role text
    check (submitter_role is null or submitter_role in ('student', 'teacher', 'admin')),
  source_metadata jsonb not null default '{}',
  approved_at timestamptz,
  dismissed_at timestamptz,
  started_at timestamptz,
  pr_url text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_developer_feedback_candidates_status_signal
  on public.developer_feedback_candidates (status, signal_count desc, last_seen_at desc);

create index if not exists idx_developer_feedback_candidates_last_seen
  on public.developer_feedback_candidates (last_seen_at desc);

create index if not exists idx_developer_feedback_candidates_source_dates
  on public.developer_feedback_candidates using gin (source_dates);

drop trigger if exists update_developer_feedback_candidates_updated_at
  on public.developer_feedback_candidates;

create trigger update_developer_feedback_candidates_updated_at
  before update on public.developer_feedback_candidates
  for each row
  execute function update_updated_at_column();

alter table public.developer_feedback_candidates enable row level security;

drop policy if exists "No direct access to developer feedback candidates"
  on public.developer_feedback_candidates;

create policy "No direct access to developer feedback candidates"
  on public.developer_feedback_candidates
  for all
  using (false)
  with check (false);

-- The helper runs server-side with the service role key through Supabase's Data API.
-- Do not grant anon/authenticated direct access.
grant select, insert, update, delete on table public.developer_feedback_candidates to service_role;
