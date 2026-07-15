import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationFilenames = [
  '089_expand_test_grading_revisions.sql',
  '090_install_test_grading_revision_triggers.sql',
  '091_backfill_test_grading_revisions.sql',
  '092_add_test_grading_constraints.sql',
  '093_validate_test_grading_constraints.sql',
  '094_atomic_test_grading_contracts.sql',
  '095_scope_classroom_archive_restore_context.sql',
]
const migrationFiles = new Map(migrationFilenames.map((filename) => [filename, readFileSync(
  resolve(process.cwd(), 'supabase/migrations', filename),
  'utf8',
)]))
const migration = migrationFilenames.map((filename) => migrationFiles.get(filename)).join('\n')
const databaseHarness = readFileSync(
  resolve(process.cwd(), 'scripts/check-atomic-test-grading.sh'),
  'utf8',
)
const restoreHarness = readFileSync(
  resolve(process.cwd(), 'scripts/check-classroom-archive-restore-database.sh'),
  'utf8',
)
const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8')
const gradingRunner = readFileSync(
  resolve(process.cwd(), 'src/lib/server/test-ai-grading-runs.ts'),
  'utf8',
)
const rolloutGuide = readFileSync(
  resolve(process.cwd(), 'docs/guidance/atomic-test-grading-rollout.md'),
  'utf8',
)

const serviceRoleFunctions = [
  'save_test_response_grades_atomic',
  'clear_test_open_response_grades_atomic',
  'save_test_unanswered_grades_atomic',
  'create_test_ai_grading_run_atomic',
  'set_test_ai_grading_item_state_atomic',
  'finalize_test_ai_grading_item_atomic',
  'claim_test_ai_grading_run',
  'renew_test_ai_grading_run_lease',
  'delete_test_atomic',
  'normalize_classroom_archive_restore_row',
]
const gradingMutationFunctions = [...serviceRoleFunctions.slice(0, 6), 'delete_test_atomic']

describe('atomic test grading contract', () => {
  it('commits expand, trigger, backfill, constraint, validation, and contract work separately', () => {
    expect(migrationFiles.get('089_expand_test_grading_revisions.sql')).toContain(
      'add column if not exists revision bigint default 1',
    )
    expect(migrationFiles.get('090_install_test_grading_revision_triggers.sql')).toContain(
      'create trigger stamp_test_response_revision',
    )
    expect(migrationFiles.get('091_backfill_test_grading_revisions.sql')).not.toContain(
      'alter column response_revision set not null',
    )
    expect(migrationFiles.get('092_add_test_grading_constraints.sql')).toContain('not valid')
    expect(migrationFiles.get('093_validate_test_grading_constraints.sql')).toContain(
      'alter column response_revision set not null',
    )
    expect(migrationFiles.get('094_atomic_test_grading_contracts.sql')).not.toContain(
      'alter table public.test_responses',
    )
    expect(migrationFiles.get('095_scope_classroom_archive_restore_context.sql')).toContain(
      'exception when others then',
    )
  })

  it('keeps grading and lease mutation RPCs service-role only', () => {
    for (const functionName of gradingMutationFunctions) {
      expect(migration).toMatch(
        new RegExp(
          `create or replace function public\\.${functionName}\\([\\s\\S]+?security definer[\\s\\S]+?set search_path = ''`,
        ),
      )
    }

    for (const functionName of serviceRoleFunctions) {
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.${functionName}\\([\\s\\S]+?from public, anon, authenticated;`,
        ),
      )
      expect(migration).toMatch(
        new RegExp(`grant execute on function public\\.${functionName}\\([\\s\\S]+?to service_role;`),
      )
    }
  })

  it('stamps every response mutation and snapshots the source revision on AI items', () => {
    expect(migration).toContain('add column if not exists revision bigint')
    expect(migration).toContain('new.revision := coalesce(old.revision, 0) + 1')
    expect(migration).toContain('if new.ai_grading_basis is null then')
    expect(migration).toContain('new.ai_suggested_score := null')
    expect(migration).toContain('new.ai_suggested_feedback := null')
    expect(migration).toContain('before insert or update on public.test_responses')
    expect(migration).toContain('add column if not exists response_revision bigint')
    expect(migration).toContain('new.response_revision := v_response.revision')
    expect(migration).toContain('AI grading item response snapshot is immutable')
    expect(migration).toContain('question_grading_snapshot jsonb')
    expect(migration).toContain("last_error_code = 'question_revision_conflict'")
    expect(migration).toMatch(
      /question_grading_snapshot = case[\s\S]+when p_status = 'processing'[\s\S]+coalesce\(item\.question_grading_snapshot, p_question_grading_snapshot\)[\s\S]+else item\.question_grading_snapshot/,
    )
    expect(gradingRunner).toContain('question_grading_snapshot: buildTestQuestionGradingSnapshot({ testTitle, question })')
    expect(gradingRunner).toContain(".eq('updated_at', question.updated_at)")
    expect(migration).toContain("raise exception 'Test response grade changed; reload and retry'")
  })

  it('locks a deterministic response set and rejects stale batch members transactionally', () => {
    expect(migration).toMatch(
      /from public\.test_responses response[\s\S]+order by response\.id[\s\S]+for update;/,
    )
    expect(migration).toContain('if v_response.revision <> v_expected_revision then')
    expect(migration).toContain("using errcode = '40001'")
    expect(databaseHarness).toContain('Stale grade batch partially committed')
    expect(databaseHarness).toContain('Stale unanswered preflight overwrote a manual grade')
    expect(databaseHarness).toContain('Concurrent unanswered inserts were incoherent')
    expect(databaseHarness).toContain('Missing-response retry overwrote a concurrent manual grade')
    expect(databaseHarness).toContain('Submission committed after preflight was omitted from grading')
    expect(databaseHarness).toContain('Eligible student cohort changed without invalidating the preflight')
    expect(databaseHarness).toContain('Attempt inserted after preflight was omitted from eligible cohort')
    expect(databaseHarness).toContain('Stale bulk clear erased a newer grade')
    expect(databaseHarness).toContain('Concurrent response insert escaped bulk clear snapshot')
    expect(databaseHarness).toContain('Question mutation deadlocked with grading')
    expect(databaseHarness).toContain('Concurrent test deletion deadlocked with grading')
    expect(databaseHarness).toContain('No-op clear advanced an ungraded response revision')
    expect(databaseHarness).toContain("jsonb_object_keys(v_result->'responses'->0)")
    expect(migration).toMatch(
      /with candidates as materialized[\s\S]+join jsonb_to_recordset\(p_expected_responses\)[\s\S]+expected\.expected_response_revision = response\.revision/,
    )
  })

  it('fences item state and finalization with the active run lease', () => {
    expect(migration.match(/v_run\.lease_token is distinct from p_lease_token/g)).toHaveLength(2)
    expect(migration.match(/v_run\.lease_expires_at <= clock_timestamp\(\)/g)).toHaveLength(2)
    expect(migration).not.toMatch(/lease_expires_at (?:<=|>) now\(\)/)
    expect(migration).toContain("v_run.status not in ('queued', 'running')")
    expect(migration).toContain("raise exception 'Test AI grading lease changed; stop this worker'")
    expect(gradingRunner).toContain('await renewTestAiGradingRunLease({')
    expect(gradingRunner.match(/\.gt\('lease_expires_at'/g)).toHaveLength(2)
    expect(databaseHarness).toContain('Lease-fenced item mutation changed state')
    expect(databaseHarness).toContain('Lease-fenced finalization changed state')
    expect(databaseHarness).toContain('Transaction-time lease check accepted an expired worker')
    expect(databaseHarness).toContain('Concurrent lease claim produced multiple owners')
    expect(databaseHarness).toContain('Lease renewal did not fence a concurrent reclaimer')
  })

  it('finalizes response and item together with replay and stale-source outcomes', () => {
    expect(gradingRunner).toContain("supabase.rpc(\n    'create_test_ai_grading_run_atomic'")
    expect(gradingRunner).toContain('p_unanswered_rows: unansweredRows')
    expect(gradingRunner).toContain('p_eligible_student_ids: eligibleStudentIds')
    expect(gradingRunner).not.toContain("supabase.rpc('save_test_unanswered_grades_atomic'")
    expect(gradingRunner).not.toContain(".from('test_responses')\n      .upsert(unanswered")
    expect(gradingRunner).toContain('hasPersistedTestResponseGrade(existing)')
    expect(gradingRunner).not.toContain(".from('test_ai_grading_run_items')\n    .insert(")
    expect(migration).toContain("return jsonb_build_object('outcome', 'replayed'")
    expect(migration).toContain("return jsonb_build_object('outcome', 'stale', 'response', null)")
    expect(migration).toContain("last_error_code = 'source_revision_conflict'")
    expect(migration).toContain('ai_suggested_score = round(p_score, 2)')
    expect(migration).toContain('ai_suggested_feedback = p_feedback')
    expect(migration).not.toContain("'__invalid__'")
    expect(migration).toMatch(
      /update public\.test_responses response[\s\S]+update public\.test_ai_grading_run_items item[\s\S]+return jsonb_build_object\('outcome', 'saved'/,
    )
    expect(databaseHarness).toContain('Forced item failure partially committed AI response')
    expect(databaseHarness).toContain('AI finalization replay was not idempotent')
    expect(databaseHarness).toContain('Concurrent run creation was not atomic')
    expect(databaseHarness).toContain('AI-first clear ordering left incoherent state')
    expect(databaseHarness).toContain('No-op clear fenced an active AI item')
    expect(databaseHarness).toContain('Attempt deletion allowed a delayed grade to resurrect a response')
    expect(databaseHarness).toContain('Question mutation did not fence the stale AI grade')
  })

  it('fails legacy active runs closed and adapts old archives without changing new snapshots', () => {
    expect(migration).toContain("last_error_code = 'revision_baseline_unavailable'")
    expect(migration).toContain('normalize_classroom_archive_restore_row')
    expect(migration).toContain("current_setting('pika.classroom_archive_restore', true) = 'on'")
    expect(migration).toContain("current_user in ('postgres', 'service_role', 'supabase_admin')")
    expect(migration).toContain('is_classroom_archive_maintenance_mode')
    expect(databaseHarness).toContain('Authenticated role forged classroom archive maintenance mode')
    expect(restoreHarness).toContain("jsonb_set(row, '{revision}', 'null'::jsonb)")
    expect(restoreHarness).toContain("'{response_revision}'")
    expect(restoreHarness).toContain('Archived completed AI grade')
    expect(restoreHarness).toContain("'status', 'failed'")
    expect(migration).toContain("p_table_name = 'test_ai_grading_runs'")
    expect(restoreHarness).toContain('Rejected restore leaked archive restore context')
    expect(restoreHarness).toContain('Successful restore leaked archive restore context')
  })

  it('runs the database harness after migrations are replayed in ephemeral Supabase', () => {
    expect(workflow).toContain('Verify atomic test grading')
    expect(workflow).toContain('bash scripts/check-atomic-test-grading.sh')
  })

  it('documents and gates the migration-first expand deployment', () => {
    expect(rolloutGuide).toContain('database migration must be applied first')
    expect(rolloutGuide).toContain('Pause new background test auto-grading runs')
    expect(rolloutGuide).toContain('Drain all previous application instances')
    expect(rolloutGuide).toContain('separately numbered migration')
  })
})
