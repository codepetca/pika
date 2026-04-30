-- Add tests as a first-class gradebook weighting category.
alter table if exists public.gradebook_settings
  add column if not exists tests_weight smallint not null default 0 check (tests_weight >= 0 and tests_weight <= 100);

-- Existing rows keep a zero tests weight; new rows created outside the app get the new default.
alter table if exists public.gradebook_settings
  alter column tests_weight set default 30;
