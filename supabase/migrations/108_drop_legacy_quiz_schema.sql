-- Permanently remove the retired Quiz schema and its remaining active
-- compatibility contracts. Migration 107 already purged all disposable Quiz
-- rows and activated the direct archive-v2 source graph.

begin;

set local timezone = 'UTC';
set local lock_timeout = '5s';

lock table
  public.quiz_responses,
  public.quiz_student_scores,
  public.quiz_questions,
  public.quizzes,
  public.assessment_drafts,
  public.course_blueprint_assessments,
  public.gradebook_settings,
  public.course_blueprints,
  public.classrooms,
  public.classroom_retired_assessment_records,
  public.classroom_archive_resource_contract,
  public.classroom_archive_resource_contract_versions
in access exclusive mode nowait;

do $preflight$
begin
  if exists (select 1 from public.quiz_responses)
    or exists (select 1 from public.quiz_student_scores)
    or exists (select 1 from public.quiz_questions)
    or exists (select 1 from public.quizzes)
    or exists (
      select 1
      from public.assessment_drafts
      where assessment_type = 'quiz'
    )
    or exists (
      select 1
      from public.course_blueprint_assessments
      where assessment_type = 'quiz'
    )
    or exists (
      select 1
      from public.classroom_retired_assessment_records
      where source_contract = 'pika.classroom-archive@1/legacy-quiz'
    )
  then
    raise exception 'Migration 107 Quiz purge invariants are not satisfied'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.classroom_archive_resource_contract
    where table_name in (
      'quizzes',
      'quiz_questions',
      'quiz_responses',
      'quiz_student_scores'
    )
  ) then
    raise exception 'Live archive registry still contains a Quiz resource'
      using errcode = '23514';
  end if;

  if (
    select count(*)
    from public.classroom_archive_resource_contract_versions
    where format_version = 2
  ) <> 40
    or exists (
      select
        table_name,
        primary_key_columns,
        parent_table,
        parent_column,
        actor_columns,
        restore_after,
        export_position
      from public.classroom_archive_resource_contract
      except
      select
        table_name,
        primary_key_columns,
        parent_table,
        parent_column,
        actor_columns,
        restore_after,
        export_position
      from public.classroom_archive_resource_contract_versions
      where format_version = 2
    )
    or exists (
      select
        table_name,
        primary_key_columns,
        parent_table,
        parent_column,
        actor_columns,
        restore_after,
        export_position
      from public.classroom_archive_resource_contract_versions
      where format_version = 2
      except
      select
        table_name,
        primary_key_columns,
        parent_table,
        parent_column,
        actor_columns,
        restore_after,
        export_position
      from public.classroom_archive_resource_contract
    )
  then
    raise exception 'Live archive registry does not exactly match source contract 2'
      using errcode = '23514';
  end if;

  if to_regclass('public.tests') is null
    or to_regclass('public.test_questions') is null
    or to_regclass('public.test_responses') is null
    or to_regclass('public.test_attempts') is null
  then
    raise exception 'Current Tests schema is incomplete'
      using errcode = '42P01';
  end if;

  if exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.contype = 'f'
      and constraint_record.conrelid in (
        'public.tests'::regclass,
        'public.test_questions'::regclass,
        'public.test_responses'::regclass,
        'public.test_attempts'::regclass
      )
      and constraint_record.confrelid in (
        'public.quizzes'::regclass,
        'public.quiz_questions'::regclass,
        'public.quiz_responses'::regclass,
        'public.quiz_student_scores'::regclass
      )
  ) then
    raise exception 'Current Tests schema depends on the retired Quiz graph'
      using errcode = '2BP01';
  end if;
end;
$preflight$;

-- Version-1 artifacts remain readable at the application discard boundary,
-- but the database no longer advertises or creates source-contract-1 exports.
delete from public.classroom_archive_resource_contract_versions
where format_version = 1;

drop function if exists public.begin_classroom_archive_export(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
);
drop function if exists public.complete_classroom_archive_export(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  bigint,
  jsonb,
  jsonb,
  jsonb
);

drop policy "Students can view quizzes" on public.quizzes;
drop policy "Students can view quiz questions" on public.quiz_questions;

drop table public.quiz_responses;
drop table public.quiz_student_scores;
drop table public.quiz_questions;
drop table public.quizzes;

drop function public.update_quiz_student_scores_updated_at();
drop function public.update_quiz_questions_updated_at();
drop function public.update_quizzes_updated_at();

drop table private.legacy_quiz_backfill_ledger;
drop function private.legacy_quiz_payload_sha256_v1(jsonb);
drop function private.legacy_quiz_canonical_json_v1(jsonb);
drop function private.legacy_quiz_json_object_index_v1(text);
drop function private.legacy_quiz_json_number_v1(jsonb);
drop function private.legacy_quiz_deterministic_uuid_v1(text[]);
drop function private.reject_legacy_quiz_source_write();

alter table public.gradebook_settings
  drop column quizzes_weight;

update public.course_blueprints
set planned_site_config = planned_site_config - 'quizzes'
where planned_site_config ? 'quizzes';
alter table public.course_blueprints
  alter column planned_site_config set default
    '{"overview": true, "outline": true, "resources": true, "assignments": true, "tests": true, "lesson_plans": true}'::jsonb;

update public.classrooms
set actual_site_config = actual_site_config - 'quizzes'
where actual_site_config ? 'quizzes';
alter table public.classrooms
  alter column actual_site_config set default
    '{"overview": true, "outline": true, "resources": true, "assignments": true, "tests": true, "lesson_plans": true, "announcements": true, "lesson_plan_scope": "current_week"}'::jsonb;

do $catalog_contract$
begin
  if to_regclass('public.quizzes') is not null
    or to_regclass('public.quiz_questions') is not null
    or to_regclass('public.quiz_responses') is not null
    or to_regclass('public.quiz_student_scores') is not null
  then
    raise exception 'Retired Quiz tables remain in the catalog';
  end if;

  if exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'private')
      and relation.relname ~* '(^|_)quiz(zes)?(_|$)'
  ) or exists (
    select 1
    from pg_proc procedure_record
    join pg_namespace namespace on namespace.oid = procedure_record.pronamespace
    where namespace.nspname in ('public', 'private')
      and procedure_record.proname ~* '(^|_)quiz(zes)?(_|$)'
  ) or exists (
    select 1
    from pg_attribute attribute_record
    join pg_class relation on relation.oid = attribute_record.attrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'private')
      and attribute_record.attnum > 0
      and not attribute_record.attisdropped
      and attribute_record.attname ~* '(^|_)quiz(zes)?(_|$)'
  ) or exists (
    select 1
    from pg_trigger trigger_record
    where not trigger_record.tgisinternal
      and trigger_record.tgname ~* '(^|_)quiz(zes)?(_|$)'
  ) or exists (
    select 1
    from pg_policies policy_record
    where policy_record.schemaname in ('public', 'private')
      and (
        policy_record.tablename ~* '(^|_)quiz(zes)?(_|$)'
        or policy_record.policyname ~* '(^|_)quiz(zes)?(_|$)'
      )
  ) then
    raise exception 'Retired Quiz catalog objects remain';
  end if;

  if exists (
    select 1
    from public.course_blueprints
    where planned_site_config ? 'quizzes'
  ) or exists (
    select 1
    from public.classrooms
    where actual_site_config ? 'quizzes'
  ) then
    raise exception 'Retired Quiz site configuration remains';
  end if;

  if exists (
    select 1
    from public.classroom_archive_resource_contract_versions
    where format_version = 1
  ) then
    raise exception 'Retired archive source contract remains active';
  end if;
end;
$catalog_contract$;

commit;
