-- CodePetPal v1 classroom opt-in and event outbox.
-- Pika keeps raw classroom/student IDs locally and sends only pseudonymous IDs
-- through the server-side CodePetPal proxy/outbox.

alter table public.classrooms
  add column if not exists codepetpal_enabled boolean not null default false;

create table if not exists public.integration_event_outbox (
  id uuid primary key default gen_random_uuid(),
  integration_key text not null default 'codepetpal',
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  event_type text not null,
  idempotency_key text not null unique,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_event_outbox_event_type_check check (
    event_type in (
      'daily_entry_created',
      'assignment_submitted',
      'calendar_milestone_reached',
      'resource_viewed',
      'quiz_completed_without_score'
    )
  ),
  constraint integration_event_outbox_status_check check (
    status in ('pending', 'sending', 'sent', 'failed')
  )
);

create index if not exists idx_integration_event_outbox_drain
  on public.integration_event_outbox (integration_key, status, next_attempt_at, created_at);

create index if not exists idx_integration_event_outbox_classroom_student
  on public.integration_event_outbox (classroom_id, student_id, created_at desc);

create or replace function public.update_integration_event_outbox_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_integration_event_outbox_updated_at on public.integration_event_outbox;
create trigger update_integration_event_outbox_updated_at
  before update on public.integration_event_outbox
  for each row
  execute function public.update_integration_event_outbox_updated_at();

alter table public.integration_event_outbox enable row level security;
