-- Backfill return metadata columns for legacy test_attempts schemas that predate return flow.
alter table if exists public.test_attempts
  add column if not exists returned_at timestamptz;

alter table if exists public.test_attempts
  add column if not exists returned_by uuid references public.users (id);

create index if not exists idx_test_attempts_test_returned
  on public.test_attempts (test_id, returned_at);
