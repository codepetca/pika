-- Add per-assessment gradebook weights. These are separate from points_possible:
-- points_possible controls the raw score scale, gradebook_weight controls final-grade contribution.
alter table if exists public.assignments
  add column if not exists gradebook_weight integer not null default 10
  check (gradebook_weight >= 1 and gradebook_weight <= 999);

alter table if exists public.quizzes
  add column if not exists gradebook_weight integer not null default 10
  check (gradebook_weight >= 1 and gradebook_weight <= 999);

alter table if exists public.tests
  add column if not exists gradebook_weight integer not null default 10
  check (gradebook_weight >= 1 and gradebook_weight <= 999);
