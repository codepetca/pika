-- Planned/actual course site metadata and blueprint provenance for classroom cloning.

alter table if exists public.course_blueprints
  add column if not exists planned_site_slug text,
  add column if not exists planned_site_published boolean not null default false,
  add column if not exists planned_site_config jsonb not null default
    '{"overview": true, "outline": true, "resources": true, "assignments": true, "quizzes": true, "tests": true, "lesson_plans": true}'::jsonb;

alter table if exists public.classrooms
  add column if not exists source_blueprint_id uuid references public.course_blueprints (id) on delete set null,
  add column if not exists source_blueprint_origin jsonb,
  add column if not exists actual_site_slug text,
  add column if not exists actual_site_published boolean not null default false,
  add column if not exists actual_site_config jsonb not null default
    '{"overview": true, "outline": true, "resources": true, "assignments": true, "quizzes": true, "tests": true, "lesson_plans": true, "announcements": true, "lesson_plan_scope": "current_week"}'::jsonb,
  add column if not exists course_overview_markdown text not null default '',
  add column if not exists course_outline_markdown text not null default '';

create unique index if not exists idx_course_blueprints_planned_site_slug_unique
  on public.course_blueprints (lower(planned_site_slug))
  where planned_site_slug is not null;

create unique index if not exists idx_classrooms_actual_site_slug_unique
  on public.classrooms (lower(actual_site_slug))
  where actual_site_slug is not null;

create index if not exists idx_classrooms_source_blueprint_id
  on public.classrooms (source_blueprint_id);
