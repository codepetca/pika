-- Store assignment submission requirements on reusable course-blueprint assignments.
alter table public.course_blueprint_assignments
  add column if not exists submission_requirements_json jsonb not null default '[]'::jsonb;

comment on column public.course_blueprint_assignments.submission_requirements_json is
  'Ordered assignment submission requirement drafts copied to assignment_submission_requirements when a blueprint is instantiated.';
