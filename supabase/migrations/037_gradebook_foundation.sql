-- Gradebook foundation: settings, weighted assessment metadata, quiz overrides, report card snapshots

-- 1) Gradebook settings per classroom
create table if not exists public.gradebook_settings (
  classroom_id uuid primary key references public.classrooms (id) on delete cascade,
  use_weights boolean not null default false,
  assignments_weight smallint not null default 70 check (assignments_weight >= 0 and assignments_weight <= 100),
  quizzes_weight smallint not null default 30 check (quizzes_weight >= 0 and quizzes_weight <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.update_gradebook_settings_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_gradebook_settings_updated_at on public.gradebook_settings;
create trigger update_gradebook_settings_updated_at
  before update on public.gradebook_settings
  for each row
  execute function public.update_gradebook_settings_updated_at();

-- 2) Assessment metadata for gradebook weighting/calculation
alter table public.assignments
  add column if not exists points_possible numeric(6,2) not null default 30 check (points_possible > 0),
  add column if not exists include_in_final boolean not null default true;

alter table public.quizzes
  add column if not exists points_possible numeric(6,2) not null default 100 check (points_possible > 0),
  add column if not exists include_in_final boolean not null default true;

alter table public.quiz_questions
  add column if not exists correct_option integer check (correct_option is null or correct_option >= 0);

-- 3) Per-student quiz override scores (manual override takes precedence over auto score)
create table if not exists public.quiz_student_scores (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  manual_override_score numeric(6,2) check (manual_override_score is null or manual_override_score >= 0),
  graded_at timestamptz,
  graded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quiz_id, student_id)
);

create index if not exists idx_quiz_student_scores_quiz_id on public.quiz_student_scores (quiz_id);
create index if not exists idx_quiz_student_scores_student_id on public.quiz_student_scores (student_id);

create or replace function public.update_quiz_student_scores_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_quiz_student_scores_updated_at on public.quiz_student_scores;
create trigger update_quiz_student_scores_updated_at
  before update on public.quiz_student_scores
  for each row
  execute function public.update_quiz_student_scores_updated_at();

-- 4) Report card snapshots (midterm/final only)
create table if not exists public.report_cards (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  term text not null check (term in ('midterm', 'final')),
  locked_at timestamptz,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (classroom_id, term)
);

create table if not exists public.report_card_rows (
  id uuid primary key default gen_random_uuid(),
  report_card_id uuid not null references public.report_cards (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  final_percent numeric(5,2) not null check (final_percent >= 0 and final_percent <= 100),
  teacher_comment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_card_id, student_id)
);

create index if not exists idx_report_cards_classroom_term on public.report_cards (classroom_id, term);
create index if not exists idx_report_card_rows_report_card on public.report_card_rows (report_card_id);

create or replace function public.update_report_cards_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_report_cards_updated_at on public.report_cards;
create trigger update_report_cards_updated_at
  before update on public.report_cards
  for each row
  execute function public.update_report_cards_updated_at();

create or replace function public.update_report_card_rows_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_report_card_rows_updated_at on public.report_card_rows;
create trigger update_report_card_rows_updated_at
  before update on public.report_card_rows
  for each row
  execute function public.update_report_card_rows_updated_at();
