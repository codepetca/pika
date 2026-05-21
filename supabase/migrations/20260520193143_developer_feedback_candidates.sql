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
  source_keys text[] not null default '{}',
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

create index if not exists idx_developer_feedback_candidates_source_keys
  on public.developer_feedback_candidates using gin (source_keys);

drop trigger if exists update_developer_feedback_candidates_updated_at
  on public.developer_feedback_candidates;

create trigger update_developer_feedback_candidates_updated_at
  before update on public.developer_feedback_candidates
  for each row
  execute function update_updated_at_column();

create or replace function public.upsert_developer_feedback_candidate(
  p_dedupe_key text,
  p_title text,
  p_original_request text,
  p_refined_request text,
  p_implementation_hint text,
  p_affected_area text,
  p_suggested_agent text,
  p_confidence numeric,
  p_source_entry_count integer,
  p_source_classroom_id uuid,
  p_source_date date,
  p_model text
)
returns jsonb
language sql
set search_path = public
as $$
  with upserted as (
    insert into public.developer_feedback_candidates (
      dedupe_key,
      source_type,
      title,
      original_request,
      refined_request,
      implementation_hint,
      affected_area,
      suggested_agent,
      confidence,
      signal_count,
      source_entry_count,
      source_classroom_ids,
      source_dates,
      source_keys,
      last_seen_at,
      last_seen_date,
      model
    )
    values (
      p_dedupe_key,
      'daily_log',
      p_title,
      p_original_request,
      p_refined_request,
      p_implementation_hint,
      p_affected_area,
      p_suggested_agent,
      p_confidence,
      1,
      greatest(0, coalesce(p_source_entry_count, 0)),
      array[p_source_classroom_id],
      array[p_source_date],
      array[p_source_classroom_id::text || ':' || p_source_date::text],
      now(),
      p_source_date,
      p_model
    )
    on conflict (dedupe_key) do update
      set title = excluded.title,
          original_request = excluded.original_request,
          refined_request = excluded.refined_request,
          implementation_hint = excluded.implementation_hint,
          affected_area = excluded.affected_area,
          suggested_agent = excluded.suggested_agent,
          confidence = greatest(public.developer_feedback_candidates.confidence, excluded.confidence),
          signal_count = public.developer_feedback_candidates.signal_count +
            case
              when public.developer_feedback_candidates.source_keys @> excluded.source_keys then 0
              else 1
            end,
          source_entry_count = public.developer_feedback_candidates.source_entry_count +
            case
              when public.developer_feedback_candidates.source_keys @> excluded.source_keys then 0
              else excluded.source_entry_count
            end,
          source_classroom_ids = (
            select coalesce(array_agg(distinct classroom_id order by classroom_id), array[]::uuid[])
            from unnest(public.developer_feedback_candidates.source_classroom_ids || excluded.source_classroom_ids) as source(classroom_id)
          ),
          source_dates = (
            select coalesce(array_agg(distinct source_date order by source_date), array[]::date[])
            from unnest(public.developer_feedback_candidates.source_dates || excluded.source_dates) as source(source_date)
          ),
          source_keys = (
            select coalesce(array_agg(distinct source_key order by source_key), array[]::text[])
            from unnest(public.developer_feedback_candidates.source_keys || excluded.source_keys) as source(source_key)
            where source_key is not null
          ),
          last_seen_at = now(),
          last_seen_date = excluded.last_seen_date,
          model = excluded.model
    returning id, (xmax = 0) as inserted
  )
  select jsonb_build_object('id', id, 'inserted', inserted)
  from upserted;
$$;

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
revoke all on function public.upsert_developer_feedback_candidate(text, text, text, text, text, text, text, numeric, integer, uuid, date, text)
  from public, anon, authenticated;
grant execute on function public.upsert_developer_feedback_candidate(text, text, text, text, text, text, text, numeric, integer, uuid, date, text)
  to service_role;
