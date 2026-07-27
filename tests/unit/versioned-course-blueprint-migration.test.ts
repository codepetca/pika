import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/111_versioned_course_blueprint_identity.sql'
  ),
  'utf8'
)

describe('versioned course blueprint migration contract', () => {
  it('adds portable identity to reusable Blueprint and classroom artifacts', () => {
    expect(migration).toContain('add column if not exists artifact_id uuid')
    expect(migration).toContain('add column if not exists source_artifact_id uuid')
    expect(migration).toContain('course_blueprint_assignments_artifact_unique')
    expect(migration).toContain('test_questions_test_artifact_unique')
    expect(migration).toContain('assignment_requirements_artifact_unique')
    expect(migration).toContain('classwork_materials_classroom_artifact_unique')
    expect(migration).toContain('surveys_classroom_artifact_unique')
    expect(migration).toContain('survey_questions_survey_artifact_unique')
    expect(migration).toContain('create table if not exists public.course_blueprint_materials')
    expect(migration).toContain('create table if not exists public.course_blueprint_surveys')
    expect(migration).toContain('gradebook_use_weights boolean not null default false')
    expect(migration).toContain('track_authenticity boolean not null default false')
  })

  it('stores immutable content-addressed Blueprint Versions', () => {
    expect(migration).toContain('create table if not exists public.course_blueprint_versions')
    expect(migration).toContain('snapshot_sha256 text not null')
    expect(migration).toContain('before update or delete on public.course_blueprint_versions')
    expect(migration).not.toContain('pg_trigger_depth()')
    expect(migration).toMatch(
      /if tg_op = 'DELETE'[\s\S]{0,500}not exists \([\s\S]{0,160}from public\.course_blueprints/
    )
    expect(migration).toMatch(
      /if tg_op = 'DELETE'[\s\S]{0,700}not exists \([\s\S]{0,160}from public\.users/
    )
    expect(migration).toContain(
      'foreign key (created_by) references public.users (id) on delete cascade'
    )
    expect(migration).toContain('create or replace function public.save_course_blueprint_version_atomic(')
    expect(migration).toContain("raise exception 'Blueprint Draft changed; rebuild the Version'")
  })

  it('provides stale-safe proposal and external editing foundations', () => {
    expect(migration).toContain('create table if not exists public.course_blueprint_change_proposals')
    expect(migration).toContain('base_blueprint_revision bigint not null')
    expect(migration).toContain('create table if not exists public.course_blueprint_editing_sessions')
    expect(migration).toContain("authority_mode in ('pika', 'repository')")
    expect(migration).toContain(
      'create or replace function public.create_course_blueprint_classroom_proposal_atomic('
    )
    expect(migration).toContain(
      'create or replace function public.apply_course_blueprint_classroom_proposal_atomic('
    )
    expect(
      migration.match(/pg_catalog\.pg_advisory_xact_lock\(/g)
    ).toHaveLength(2)
    expect(migration).toMatch(
      /apply_course_blueprint_proposal_atomic[\s\S]*v_source_classroom\.blueprint_source_revision[\s\S]*v_proposal\.base_classroom_revision/
    )
    expect(migration).toMatch(
      /planned_site_published = v_blueprint\.planned_site_published/
    )
    expect(migration).not.toMatch(
      /planned_site_published = coalesce\([\s\S]{0,120}p_candidate_snapshot/
    )
  })

  it('preserves student-bearing classroom artifacts during Blueprint upgrades', () => {
    expect(migration).toContain('blueprint_archived_at timestamptz')
    expect(migration).toContain('assignments_active_blueprint_source_unique')
    expect(migration).toContain('tests_active_blueprint_source_unique')
    expect(migration).toMatch(
      /from public\.assignment_docs[\s\S]{0,500}update public\.assignments[\s\S]{0,120}blueprint_archived_at = now\(\)/
    )
    expect(migration).toMatch(
      /from public\.test_attempts[\s\S]{0,500}update public\.tests set blueprint_archived_at = now\(\)/
    )
    expect(migration).toMatch(
      /insert into public\.tests[\s\S]{0,900}\n\s*'draft',/
    )
    expect(migration).toContain('applied_classroom_revision = v_result_revision')
    expect(migration).toContain(
      "p_classroom_plan->'calendar_guard'->'class_day_dates'"
    )
  })

  it('keeps runtime activity out of classroom structural revisions', () => {
    expect(migration).toContain('drop trigger if exists touch_classroom_blueprint_source_from_announcements')
    expect(migration).toMatch(
      /after update of[\s\S]{0,300}\bdue_at\b[\s\S]{0,300}on public\.assignments/
    )
    expect(migration).not.toMatch(
      /after update of[\s\S]{0,300}\bstatus\b[\s\S]{0,100}on public\.tests/
    )
    expect(migration).toContain('touch_classroom_blueprint_source_from_assessment_draft')
    expect(migration).toContain('when (old.content is distinct from new.content)')
    expect(migration).toContain('touch_classroom_blueprint_source_from_materials_update')
    expect(migration).toContain('touch_classroom_blueprint_source_from_surveys_update')
    expect(migration).toContain('touch_classroom_blueprint_source_from_gradebook_update')
    expect(
      migration.match(
        /current_setting\('pika\.classroom_archive_restore', true\) = 'on'/g,
      ),
    ).toHaveLength(5)
    expect(migration).not.toMatch(
      /after update of[\s\S]{0,220}\breleased_at\b[\s\S]{0,100}on public\.classwork_materials/
    )
    expect(migration).not.toMatch(
      /after update of[\s\S]{0,220}\bopens_at\b[\s\S]{0,100}on public\.surveys/
    )
  })

  it('maps migration 081 writes to stable identity in the same transaction', () => {
    expect(migration).toContain('create or replace function public.create_course_blueprint_atomic_v2(')
    expect(migration).toContain('create or replace function public.instantiate_course_blueprint_atomic_v2(')
    expect(migration).toContain("perform set_config('pika.identity_mapping', 'on', true)")
    expect(migration).toContain('source_blueprint_version_id = p_blueprint_version_id')
    expect(migration).toContain("jsonb_array_elements(coalesce(p_plan->'materials', '[]'::jsonb))")
    expect(migration).toContain("jsonb_array_elements(coalesce(p_plan->'surveys', '[]'::jsonb))")
    expect(migration).toContain('insert into public.gradebook_settings')
    expect(migration).toMatch(
      /if p_operation_type = 'capture' then[\s\S]{0,500}update public\.assignments[\s\S]{0,300}source_artifact_id = \(v_item->>'artifact_id'\)::uuid/
    )
    expect(migration).toContain(
      "raise exception 'Captured Test question identity mapping failed'"
    )
  })
})
