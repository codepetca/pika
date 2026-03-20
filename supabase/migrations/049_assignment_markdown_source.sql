-- Add canonical markdown instructions for teacher-authored assignments.
-- Existing rows are backfilled from description; richer legacy content is
-- converted on read/edit in the app until all records are resaved.

alter table public.assignments
add column if not exists instructions_markdown text;

update public.assignments
set instructions_markdown = coalesce(description, '')
where instructions_markdown is null;

comment on column public.assignments.instructions_markdown is
  'Canonical limited-markdown instructions for teacher-authored assignments';

alter table public.lesson_plans
add column if not exists content_markdown text;

comment on column public.lesson_plans.content_markdown is
  'Canonical limited-markdown lesson plan content. Legacy Tiptap JSON remains mirrored in content during rollout.';
