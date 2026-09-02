-- Stable, rotatable classroom attendance poster handles. The public QR carries
-- only a random handle plus an application-secret MAC; classroom, roster,
-- occurrence, and Bara check-in identifiers never enter the poster URL.

create table public.attendance_classroom_qr_handles (
  classroom_id uuid primary key references public.classrooms (id) on delete cascade,
  handle_id uuid not null unique default gen_random_uuid(),
  generation bigint not null default 1 check (generation > 0),
  created_at timestamptz not null default clock_timestamp(),
  rotated_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.attendance_classroom_qr_handles enable row level security;

revoke all on table public.attendance_classroom_qr_handles
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.attendance_classroom_qr_handles
  to service_role;

comment on table public.attendance_classroom_qr_handles is
  'Pika-only random handles for stable classroom attendance posters; no authorization or Bara credential is stored here.';
