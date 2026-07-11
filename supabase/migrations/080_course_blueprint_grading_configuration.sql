-- Preserve reusable gradebook configuration when classrooms round-trip through blueprints.

alter table if exists public.course_blueprint_assignments
  add column if not exists gradebook_weight integer not null default 10
  check (gradebook_weight >= 1 and gradebook_weight <= 999);

alter table if exists public.course_blueprint_assessments
  add column if not exists points_possible integer,
  add column if not exists gradebook_weight integer not null default 10
    check (gradebook_weight >= 1 and gradebook_weight <= 999),
  add column if not exists include_in_final boolean not null default true;

comment on column public.course_blueprint_assignments.gradebook_weight is
  'Default final-grade weight applied when the blueprint creates a classroom assignment.';

comment on column public.course_blueprint_assessments.points_possible is
  'Assessment-level point scale copied into classrooms created from this blueprint.';

comment on column public.course_blueprint_assessments.gradebook_weight is
  'Default final-grade weight applied when the blueprint creates a classroom assessment.';

comment on column public.course_blueprint_assessments.include_in_final is
  'Whether classrooms created from this blueprint include the assessment in final-grade calculations.';
