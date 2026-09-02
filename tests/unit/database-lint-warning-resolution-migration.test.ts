import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/149_resolve_current_database_lint_warnings.sql',
  ),
  'utf8',
)
const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/ci.yml'),
  'utf8',
)

describe('database lint warning resolution migration', () => {
  it('fails closed when an installed function differs from the reviewed definition', () => {
    expect(migration).toContain('v_occurrences <> 1')
    expect(migration).toContain("using errcode = '55000'")
    expect(migration).toContain('pg_catalog.pg_get_functiondef')
    expect(migration).toContain(
      'drop function private.replace_function_definition_fragment_v149',
    )
  })

  it('preserves archive type validation while discarding only its unread result', () => {
    expect(migration).toContain(
      "'private.stage_classroom_archive_restore_rows_v094(uuid,uuid,text,jsonb)'::regprocedure",
    )
    expect(migration).toContain(
      "'public.stage_classroom_archive_restore_rows_v2(uuid,uuid,text,jsonb,integer)'::regprocedure",
    )
    expect(migration).toContain("E'      ) using v_row;'")
    expect(migration).toContain("E'      )\\n      using v_row;'")
  })

  it('uses the retained actor and clock parameters as database contracts', () => {
    const advisoryLock = migration.indexOf(
      'pg_advisory_xact_lock(hashtextextended(p_test_id::text, 0))',
    )
    const classroomLock = migration.indexOf(
      "E'  from public.classrooms classroom\\n'",
    )
    const testLock = migration.indexOf(
      "E'  from public.tests test\\n'",
      classroomLock + 1,
    )

    expect(advisoryLock).toBeGreaterThan(-1)
    expect(classroomLock).toBeGreaterThan(advisoryLock)
    expect(testLock).toBeGreaterThan(classroomLock)
    expect(migration).toContain('v_classroom_teacher_id is distinct from p_updated_by')
    expect(migration).toContain('v_archived_at is not null')
    expect(migration).toContain("using errcode = ''42501''")
    expect(migration).toContain('if p_now is null')
  })

  it('preserves artifact-before-document locking without iterator variables', () => {
    const artifactLock = migration.indexOf(
      "E'  from public.assignment_submission_artifacts artifact\\n'",
    )
    const documentLock = migration.indexOf(
      "E'  from public.assignment_docs doc\\n'",
      artifactLock + 1,
    )

    expect(artifactLock).toBeGreaterThan(-1)
    expect(documentLock).toBeGreaterThan(artifactLock)
    expect(migration).toContain("E'  for update of artifact;'")
    expect(migration).toContain("E'  for update;'")
  })

  it('removes only the confirmed dead refactor declarations', () => {
    expect(migration).toContain("E'  v_expected integer;\\n'")
    expect(migration).toContain("E'  v_result jsonb;\\n'")
    expect(migration).toContain("E'  v_responses jsonb;\\n'")
    expect(migration).toContain(
      "E'  perform public.upsert_attendance_window_policy_v1('",
    )
  })

  it('aligns fresh-replay volatility with the complete function call graph', () => {
    expect(migration).toContain(
      'alter function private.assignment_tiptap_plain_text(jsonb) stable;',
    )
    expect(migration).toContain(
      'alter function public.course_blueprint_canonical_jsonb_text(jsonb) stable;',
    )
    expect(migration).toContain(
      'alter function public.managed_storage_legacy_object_id(text, text) stable;',
    )
    expect(migration).toContain(
      'alter function public.student_purge_conflict(uuid, uuid) volatile;',
    )
    expect(migration).toContain(
      'alter function public.get_cleanup_history_cron_health_snapshot(integer, integer) volatile;',
    )
  })

  it('gates warning-level lint and the runtime lock contract in CI', () => {
    expect(workflow).toContain(
      'supabase db lint --local --level warning --fail-on warning',
    )
    expect(workflow).toContain(
      'bash scripts/check-database-lint-warning-resolutions.sh',
    )
  })
})
