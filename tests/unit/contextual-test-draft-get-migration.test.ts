import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { draftGetBoundsAndDriftSql, draftGetContractsManifest, draftGetFixtureSnapshotSql,
  draftGetFixtureStatements, draftGetMigrationManifestSha256, newDraftGetFixture, validateDraftGetTarget,
  type DraftGetTarget } from '../../scripts/check-contextual-test-draft-get-db-contracts'
import { draftGetConcurrencyManifest } from '../../scripts/check-contextual-test-draft-get-concurrency'

const migration = () => readFileSync('supabase/migrations/247_contextual_test_draft_owner_get.sql', 'utf8')

describe('contextual owner Test draft GET source contract (not runtime proof)', () => {
  it('exposes only the two service-only entrypoints and seals the common helper', () => {
    const sql = migration()
    for (const name of ['snapshot_test_draft_for_owner_v1', 'finish_test_draft_get_for_owner_v1']) {
      expect(sql).toContain(`function public.${name}(`)
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]+from public, anon, authenticated`, 's'))
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^;]+to service_role`, 's'))
    }
    expect(sql).toMatch(/revoke all on function private\.test_draft_owner_source_v1\([^;]+from public, anon, authenticated, service_role/s)
    expect(sql).toContain("set search_path = ''")
    expect(sql).not.toMatch(/auth\.uid|users\.role|teacher_entitlements/)
  })

  it('acquires the matching Start advisory before Class, fixed Test, exact draft and revision NOWAIT locks', () => {
    const sql = migration()
    const advisory = sql.indexOf('pg_try_advisory_xact_lock(pg_catalog.hashtextextended(p_test_id::text, 0))')
    const fence = sql.indexOf('public.classroom_purge_try_lock(v_classroom_id)')
    const classroom = sql.indexOf('classroom.id = v_classroom_id for update nowait')
    const test = sql.indexOf('test.classroom_id = v_classroom_id for update nowait')
    const draft = sql.indexOf("draft.assessment_id = p_test_id for update nowait")
    const revision = sql.indexOf('revision.classroom_id = v_classroom_id for update nowait')
    expect(advisory).toBeGreaterThan(-1)
    expect([advisory, fence, classroom, test, draft, revision]).toEqual([advisory, fence, classroom, test, draft, revision].sort((a, b) => a - b))
    expect(sql).toContain('public.guard_classroom_purge_lifecycle(v_classroom_id)')
    expect(sql).not.toMatch(/test_questions[^;]*for update/is)
  })

  it('bounds complete question and UTF-8 source bytes before aggregation and shares the SQL SHA', () => {
    const sql = migration()
    expect(sql).toContain('limit 10001')
    expect(sql).toContain('v_question_count > 10000')
    expect(sql).toContain('2097152')
    expect(sql).toContain('8388608')
    expect(sql.indexOf('v_source_bytes > 8388608')).toBeLessThan(sql.indexOf('select coalesce(pg_catalog.jsonb_agg'))
    expect(sql).toContain("extensions.digest(v_source::text, 'sha256')")
    expect(sql).toContain("v_source->>'source_sha256' is distinct from p_expected_source_sha256")
    expect(sql.match(/private\.test_draft_owner_source_v1\(/g)?.length).toBeGreaterThanOrEqual(4)
    for (const field of ['artifact_id', 'source_artifact_id', 'sample_solution', 'response_max_chars', 'response_monospace']) expect(sql).toContain(field)
    expect(sql).not.toContain('ai_reference_cache_')
  })

  it('binds current owner and active Class and rejects wrong-Class drafts', () => {
    const sql = migration()
    expect(sql).toContain('v_classroom.teacher_id is distinct from p_actor_id')
    expect(sql).toContain('v_classroom.archived_at is not null')
    expect(sql).toContain('v_draft.classroom_id is distinct from v_classroom_id')
    expect(sql).toContain('p_fixed_classroom_id is distinct from v_classroom_id')
    expect(sql).not.toMatch(/set_config\('pika\.|set pika\./)
  })

  it('enforces exact inspect/create/repair modes, retirement and integer version safety', () => {
    const sql = migration()
    expect(sql).toContain("p_operation not in ('inspect', 'create', 'repair')")
    expect(sql).toContain("p_operation = 'create' and v_source->'draft' <> 'null'::jsonb")
    expect(sql).toContain("p_operation in ('inspect', 'repair') and v_source->'draft' = 'null'::jsonb")
    expect(sql).toContain("p_operation = 'repair' and v_test.status <> 'draft'")
    expect(sql).toContain("p_operation <> 'inspect' and v_test.blueprint_archived_at is not null")
    expect(sql).toContain('v_before.version = 2147483647')
    expect(sql).not.toMatch(/on conflict[^;]*do update/is)
  })

  it('asserts final persisted binding, stamps, natural revisions and locked editing policy', () => {
    const sql = migration()
    expect(sql).toContain('get diagnostics v_count = row_count')
    expect(sql).toContain('to_jsonb(v_after) is distinct from to_jsonb(v_expected)')
    expect(sql).toContain('v_blueprint_before + v_delta')
    expect(sql).toContain('v_archive_before + 2 * v_delta')
    expect(sql).toContain("'structureLocked', v_test.questions_locked_at is not null")
    expect(sql).not.toMatch(/(?:insert into|update|delete from) public\.(?:tests|test_questions|classrooms|managed_storage_objects)\b/i)
  })

  it('checks finite phase and absolute deadlines around source, DML and triggers; maps contention without retries', () => {
    const sql = migration()
    expect(sql).toContain("set lock_timeout = '1s'")
    expect(sql).toContain("interval '8 seconds'")
    expect(sql).toContain('pg_catalog.isfinite(p_deadline)')
    expect(sql.match(/clock_timestamp\(\) >= v_phase_deadline/g)?.length).toBeGreaterThanOrEqual(4)
    expect(sql).toMatch(/when sqlstate '40P01' or sqlstate '55P03' or sqlstate '40001' or sqlstate '23505'/)
    expect(sql).not.toMatch(/set statement_timeout|errcode = '40001'/)
  })

  it('prepares inert finite contract and race harnesses with explicit target/source/UUID binding', () => {
    const contracts = readFileSync('scripts/check-contextual-test-draft-get-db-contracts.ts', 'utf8')
    const races = readFileSync('scripts/check-contextual-test-draft-get-concurrency.ts', 'utf8')
    for (const source of [contracts, races]) {
      expect(source).toContain('SOURCE PREPARATION ONLY')
      expect(source).toContain('rollback')
      expect(source).not.toMatch(/db reset|db push|migration up|docker.*exec/)
    }
    expect(contracts).toContain('127.0.0.1')
    expect(contracts).toContain('reviewedSourceSha256')
    expect(contracts).toContain('allowedFixtureIds')
    for (const label of ['contextual_create', 'contextual_repair', 'legacy_same_draft', 'legacy_other_draft_revision', 'start', 'save', 'publish', 'archive', 'owner_transfer', 'test_move']) expect(races).toContain(label)
  })

  it('generates a deterministic closed fixture and finite real SQL manifests without database access', () => {
    const f = newDraftGetFixture('0123456789ab')
    expect(f).toEqual(newDraftGetFixture('0123456789ab'))
    expect(f.allowedFixtureIds).toHaveLength(10016)
    expect(new Set(f.allowedFixtureIds).size).toBe(10016)
    expect(Object.isFrozen(f.allowedFixtureIds)).toBe(true)
    expect(Buffer.byteLength(draftGetFixtureStatements(f))).toBeLessThan(256 * 1024)
    expect(draftGetFixtureSnapshotSql(f)).toContain('public.test_attempts')
    const contracts = draftGetContractsManifest(f)
    expect(contracts.contracts).toContain('Suppressed write leaked effects')
    expect(contracts.contracts).not.toContain('insert into public.users')
    expect(draftGetBoundsAndDriftSql(f)).toContain('generate_series(0,9999)')
    expect(draftGetBoundsAndDriftSql(f)).toContain('10001 truncation accepted')
    expect(draftGetBoundsAndDriftSql(f)).toContain('Cache-only digest drift')
    const races = draftGetConcurrencyManifest(f)
    expect(races.schedules).toHaveLength(12)
    expect(races.schedules.every(row => row.rejectTemplate.includes("sqlstate 'PT409'"))).toBe(true)
  })

  it('rejects canonical ports, hosted targets, forged source or migration manifests before any driver call', () => {
    const f = newDraftGetFixture('0123456789ab')
    const sha = (value: string) => createHash('sha256').update(value).digest('hex')
    const target: DraftGetTarget = Object.freeze({ projectId: f.projectId, apiUrl: 'http://127.0.0.1:54331',
      databaseHost: '127.0.0.1', databasePort: 54332, containerId: 'a'.repeat(64), containerProjectLabel: f.projectId,
      disposable: true, reviewedHead: '7570a9d60591183f0699001f47a6528045a392ee',
      reviewedSourceSha256: sha(migration()), migrationManifestSha256: draftGetMigrationManifestSha256(process.cwd()),
      acceptedManifestSha256: 'b'.repeat(64) })
    expect(validateDraftGetTarget(target, f, process.cwd())).toBe(target)
    for (const patch of [{ databasePort: 54322 }, { databaseHost: 'db.example.com' }, { projectId: 'pika' },
      { reviewedSourceSha256: '0'.repeat(64) }, { migrationManifestSha256: '0'.repeat(64) }]) {
      expect(() => validateDraftGetTarget(Object.freeze({ ...target, ...patch }), f, process.cwd())).toThrow()
    }
  })

  it('prepares each remaining source race and proves the deadline rejection reaches an AFTER draft trigger', () => {
    const f = newDraftGetFixture('0123456789ab')
    const manifest = draftGetContractsManifest(f)
    for (const label of ['question_insert','question_delete','question_move','question_reorder','question_mc_choice','test_delete']) {
      expect(manifest.boundsAndDrift).toContain(`${label} stale source accepted`)
      expect(manifest.boundsAndDrift).toContain(`${label} rollback differs`)
    }
    expect(manifest.contracts).toContain('create sequence private.proof_draft_get_deadline_0123456789ab')
    expect(manifest.contracts).toContain('after update on public.assessment_drafts')
    expect(manifest.contracts).toContain('pg_catalog.nextval')
    expect(manifest.contracts).toContain('pg_catalog.pg_sleep(0.15)')
    expect(manifest.contracts).toContain("interval '100 milliseconds'")
    expect(manifest.contracts).toContain('Post-DML deadline did not reach trigger')
    expect(manifest.contracts).toContain('Post-DML deadline leaked draft/Class/revision')
    expect(draftGetFixtureStatements(f)).toContain("'{\"question_identity_version\":1}'::jsonb")
  })
})
