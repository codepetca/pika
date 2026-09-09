-- Generic per-teacher UI dismissal/progress state: onboarding coachmarks,
-- getting-started checklists, and future one-time guidance all read and
-- write this single keyed table instead of getting a table of their own.
-- Authorization happens in server routes via requireAuth() + the
-- service-role client, matching the rest of the app's Supabase access
-- pattern, so this table itself stays fully locked down.

create table public.teacher_ui_state (
  teacher_id uuid not null references public.users (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 200),
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (teacher_id, key)
);

alter table public.teacher_ui_state enable row level security;
revoke all on table public.teacher_ui_state from public, anon, authenticated, service_role;

comment on table public.teacher_ui_state is
  'Per-teacher dismissal/progress state for onboarding coachmarks, getting-started checklists, and other one-time UI guidance. Written only via authenticated server routes using the service-role client; no direct table grants.';
comment on column public.teacher_ui_state.key is
  'Feature-scoped key, e.g. onboarding:classroom:<classroom_id>. One row per (teacher, key); callers decide the JSON shape of value.';
