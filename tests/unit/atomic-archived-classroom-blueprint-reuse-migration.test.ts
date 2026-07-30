import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/114_atomic_archived_classroom_blueprint_reuse.sql',
  ),
  'utf8',
)

describe('atomic archived classroom Blueprint reuse migration', () => {
  it('serializes creation on the archived classroom and links in the transaction', () => {
    expect(migration).toContain(
      'create or replace function public.create_archived_classroom_blueprint_atomic(',
    )
    expect(migration).toMatch(
      /from public\.classrooms[\s\S]{0,180}for update/,
    )
    expect(migration).toContain('if v_classroom.archived_at is null then')
    expect(migration).toContain(
      'if v_classroom.source_blueprint_id is not null then',
    )
    expect(migration).toContain(
      'v_result := public.create_course_blueprint_atomic_v2(',
    )
    expect(migration).toContain('source_blueprint_id = v_blueprint_id')
    expect(migration).toContain(
      'public.archived_classroom_blueprint_snapshot_from_plan(',
    )
    expect(migration).toContain(
      'source_blueprint_version_id = v_version.id',
    )
    expect(migration).toContain(
      "raise exception 'Archived lesson identity mapping failed'",
    )
  })

  it('replays the classroom-scoped winner without creating an orphan', () => {
    expect(migration).toMatch(
      /if v_classroom\.source_blueprint_id is not null then[\s\S]{0,900}'replayed', true/,
    )
    expect(migration).toContain(
      "'reuse_source', 'archived_classroom'",
    )
    expect(migration).toContain(
      'source_classroom_id = p_source_classroom_id',
    )
  })

  it('locks and rechecks hot-archive state before promotion', () => {
    expect(migration).toContain(
      'create or replace function public.apply_archived_classroom_blueprint_proposal_atomic(',
    )
    expect(migration).toMatch(
      /apply_archived_classroom_blueprint_proposal_atomic[\s\S]*from public\.classrooms[\s\S]{0,180}for update/,
    )
    expect(migration).toMatch(
      /v_classroom\.archived_at is null[\s\S]{0,260}apply_course_blueprint_proposal_atomic/,
    )
    expect(migration).toContain(
      'from public.save_course_blueprint_version_atomic(',
    )
    expect(migration).toContain('p_result_snapshot_sha256')
    expect(migration).toMatch(
      /save_course_blueprint_version_atomic\([\s\S]{0,900}source_blueprint_version_id = v_version\.id/,
    )
    expect(migration).toMatch(
      /update public\.lesson_plans[\s\S]{0,220}source_artifact_id = coalesce\(source_artifact_id, artifact_id\)/,
    )
  })

  it('hashes initial Versions with Pika canonical JSON rather than jsonb text', () => {
    expect(migration).toContain(
      'create or replace function public.course_blueprint_canonical_jsonb_text(',
    )
    expect(migration).toContain('order by entry.key')
    expect(migration).toContain('order by item.ordinality')
    expect(migration).not.toContain('convert_to(v_version_snapshot::text')
  })
})
