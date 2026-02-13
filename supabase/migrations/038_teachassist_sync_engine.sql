-- TeachAssist sync engine persistence tables

create table if not exists public.teachassist_mappings (
  classroom_id uuid primary key references public.classrooms (id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.external_identity_map (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  external_student_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (classroom_id, student_id),
  unique (classroom_id, external_student_key)
);

create table if not exists public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  provider text not null check (provider in ('teachassist')),
  mode text not null check (mode in ('dry_run', 'execute')),
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  source text not null default 'manual',
  source_payload jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_job_items (
  id uuid primary key default gen_random_uuid(),
  sync_job_id uuid not null references public.sync_jobs (id) on delete cascade,
  entity_type text not null check (entity_type in ('attendance', 'mark', 'report_card')),
  entity_key text not null,
  action text not null check (action in ('upsert', 'noop')),
  payload_hash text not null,
  status text not null check (status in ('pending', 'success', 'failed', 'skipped')),
  error_message text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sync_jobs_classroom_created_at on public.sync_jobs (classroom_id, created_at desc);
create index if not exists idx_sync_job_items_job_id on public.sync_job_items (sync_job_id);
create index if not exists idx_sync_job_items_entity_key on public.sync_job_items (entity_type, entity_key);

create or replace function public.update_generic_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_teachassist_mappings_updated_at on public.teachassist_mappings;
create trigger update_teachassist_mappings_updated_at
  before update on public.teachassist_mappings
  for each row execute function public.update_generic_updated_at();

drop trigger if exists update_external_identity_map_updated_at on public.external_identity_map;
create trigger update_external_identity_map_updated_at
  before update on public.external_identity_map
  for each row execute function public.update_generic_updated_at();

drop trigger if exists update_sync_jobs_updated_at on public.sync_jobs;
create trigger update_sync_jobs_updated_at
  before update on public.sync_jobs
  for each row execute function public.update_generic_updated_at();

drop trigger if exists update_sync_job_items_updated_at on public.sync_job_items;
create trigger update_sync_job_items_updated_at
  before update on public.sync_job_items
  for each row execute function public.update_generic_updated_at();
