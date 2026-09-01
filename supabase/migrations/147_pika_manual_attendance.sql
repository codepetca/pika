-- Pika-owned attendance for classrooms that do not use Bara QR check-in.

alter table public.attendance_window_policies
  alter column entry_closes_minutes_before_end set default 0;

create table public.manual_attendance_settings (
  classroom_id uuid primary key references public.classrooms (id) on delete cascade,
  source_mode text not null default 'manual' check (source_mode in ('log', 'manual')),
  session_starts_local time,
  session_ends_local time,
  updated_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((session_starts_local is null) = (session_ends_local is null))
);

create table public.manual_attendance_marks (
  classroom_id uuid not null,
  class_date date not null,
  student_id uuid not null,
  status text not null check (status in ('present', 'late', 'absent')),
  updated_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (classroom_id, class_date, student_id),
  foreign key (classroom_id, student_id)
    references public.classroom_enrollments (classroom_id, student_id)
    on delete cascade
);

create index manual_attendance_marks_classroom_date
  on public.manual_attendance_marks (classroom_id, class_date);

alter table public.manual_attendance_settings enable row level security;
alter table public.manual_attendance_marks enable row level security;

revoke all on table public.manual_attendance_settings, public.manual_attendance_marks
  from public, anon, authenticated;
grant select, insert, update, delete on table public.manual_attendance_settings,
  public.manual_attendance_marks to service_role;

comment on table public.manual_attendance_settings is
  'Teacher-owned Pika manual-attendance display source and optional passive class time.';
comment on table public.manual_attendance_marks is
  'Current teacher overrides for Pika manual attendance; deleting a row restores the configured automatic baseline.';
