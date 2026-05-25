-- Harden direct Supabase Data API access ahead of WorkOS AuthKit migration.
--
-- Pika's application authorization happens in Next.js API routes with
-- requireAuth()/requireRole() and the Supabase service-role client. WorkOS user
-- IDs must map to local public.users.id UUIDs instead of replacing them.

alter table public.users
  add column if not exists workos_user_id text;

create unique index if not exists users_workos_user_id_unique
  on public.users (workos_user_id)
  where workos_user_id is not null;

comment on column public.users.workos_user_id is
  'External WorkOS AuthKit user id. public.users.id remains Pika''s internal app user id.';

alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.gradebook_settings enable row level security;
alter table public.quiz_student_scores enable row level security;
alter table public.report_cards enable row level security;
alter table public.report_card_rows enable row level security;

drop policy if exists "No direct access to announcements" on public.announcements;
create policy "No direct access to announcements"
  on public.announcements
  for all
  to public
  using (false)
  with check (false);

drop policy if exists "No direct access to announcement_reads" on public.announcement_reads;
create policy "No direct access to announcement_reads"
  on public.announcement_reads
  for all
  to public
  using (false)
  with check (false);

drop policy if exists "No direct access to gradebook_settings" on public.gradebook_settings;
create policy "No direct access to gradebook_settings"
  on public.gradebook_settings
  for all
  to public
  using (false)
  with check (false);

drop policy if exists "No direct access to quiz_student_scores" on public.quiz_student_scores;
create policy "No direct access to quiz_student_scores"
  on public.quiz_student_scores
  for all
  to public
  using (false)
  with check (false);

drop policy if exists "No direct access to report_cards" on public.report_cards;
create policy "No direct access to report_cards"
  on public.report_cards
  for all
  to public
  using (false)
  with check (false);

drop policy if exists "No direct access to report_card_rows" on public.report_card_rows;
create policy "No direct access to report_card_rows"
  on public.report_card_rows
  for all
  to public
  using (false)
  with check (false);

-- Existing app code does not use browser-side Supabase table/RPC access.
-- Keep server API routes working by preserving the service_role boundary, and
-- remove direct PostgREST/GraphQL/RPC privileges from anon/authenticated.
revoke all privileges on all tables in schema public from public, anon, authenticated;
revoke all privileges on all sequences in schema public from public, anon, authenticated;
revoke all privileges on all functions in schema public from public, anon, authenticated;

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Security advisor hardening for existing public functions.
alter function public.reorder_assignments_preserve_materials(p_classroom_id uuid, p_assignment_ids jsonb) set search_path = public;
alter function public.reorder_classwork_items(p_classroom_id uuid, p_items jsonb) set search_path = public;
alter function public.return_assignment_docs_atomic(p_assignment_id uuid, p_student_ids uuid[], p_teacher_id uuid, p_now timestamp with time zone) set search_path = public;
alter function public.set_classwork_material_position() set search_path = public;
alter function public.set_survey_position() set search_path = public;
alter function public.update_announcements_updated_at() set search_path = public;
alter function public.update_assessment_drafts_updated_at() set search_path = public;
alter function public.update_assignment_ai_grading_updated_at() set search_path = public;
alter function public.update_assignment_docs_updated_at() set search_path = public;
alter function public.update_assignment_repo_targets_updated_at() set search_path = public;
alter function public.update_assignment_submission_artifacts_updated_at() set search_path = public;
alter function public.update_assignment_submission_requirements_updated_at() set search_path = public;
alter function public.update_assignments_updated_at() set search_path = public;
alter function public.update_classwork_materials_updated_at() set search_path = public;
alter function public.update_course_blueprints_updated_at() set search_path = public;
alter function public.update_gradebook_settings_updated_at() set search_path = public;
alter function public.update_quiz_questions_updated_at() set search_path = public;
alter function public.update_quiz_student_scores_updated_at() set search_path = public;
alter function public.update_quizzes_updated_at() set search_path = public;
alter function public.update_report_card_rows_updated_at() set search_path = public;
alter function public.update_report_cards_updated_at() set search_path = public;
alter function public.update_survey_questions_updated_at() set search_path = public;
alter function public.update_survey_responses_updated_at() set search_path = public;
alter function public.update_surveys_updated_at() set search_path = public;
alter function public.update_test_ai_grading_updated_at() set search_path = public;
alter function public.update_test_attempts_updated_at() set search_path = public;
alter function public.update_test_questions_updated_at() set search_path = public;
alter function public.update_test_student_availability_updated_at() set search_path = public;
alter function public.update_tests_updated_at() set search_path = public;
alter function public.update_updated_at_column() set search_path = public;
alter function public.update_user_github_identities_updated_at() set search_path = public;
alter function public.validate_test_response_shape() set search_path = public;

-- Pika schema changes are migration-managed and owned by postgres in local and
-- hosted Supabase migration runs.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant all on tables to service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

-- These buckets are intentionally public-read because existing product URLs use
-- getPublicUrl(). Uploads/deletes now go through server API routes with the
-- service-role client instead of direct authenticated storage policies.
drop policy if exists "Allow authenticated uploads" on storage.objects;
drop policy if exists "Allow owner deletes" on storage.objects;
drop policy if exists "Allow authenticated uploads for test documents" on storage.objects;
drop policy if exists "Allow owner deletes for test documents" on storage.objects;
