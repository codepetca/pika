import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerRecoveryFixture } from '../../scripts/contextual-test-owner-recovery-proof-fixture'
import { testOwnerRecoveryNativePlan, validateTestOwnerRecoveryNativePlanSql, runTestOwnerRecoveryNativeContracts,
  runTestOwnerRecoveryNativeRaces } from '../../scripts/contextual-test-owner-recovery-native-contracts'
import { buildTestOwnerRecoveryNativeContractsManifest } from '../../scripts/contextual-test-draft-save-native-contracts'
import type { DraftSaveDriver, DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'

// A synthetic source seal exercises inert framing. It does not accept candidate260
// for native execution or change its coordinator-owned pending seal.
vi.mock('../../scripts/test-owner-recovery-reviewed-migration', async () => {
  const { readFileSync } = await import('node:fs'), { createHash } = await import('node:crypto'), { default: assert } = await import('node:assert/strict')
  const name = '260_contextual_test_owner_recovery.sql', sql = readFileSync(`supabase/migrations/${name}`, 'utf8')
  const sha256 = createHash('sha256').update(sql).digest('hex')
  return { TEST_OWNER_RECOVERY_REVIEWED_MIGRATION: Object.freeze({ name, sha256 }),
    validateTestOwnerRecoveryReviewedMigration: (m: { name: string; sql: string; sha256: string }) => {
      assert.equal(m.name, name); assert.equal(m.sql, sql); assert.equal(m.sha256, sha256)
    } }
})
const original = newAssignmentListProofFixture(new Date('2026-10-11T12:00:00Z')), f = newTestOwnerRecoveryFixture(original)
const observed = Object.freeze([1, 2].map(i => Object.freeze({ actorId: f.actors[i].id, attemptId: randomUUID(), revision: 19 + i })))
const plan = () => testOwnerRecoveryNativePlan(original, observed, 'b'.repeat(40), process.cwd())
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const target = (m: ReturnType<typeof plan>, phase: 'contracts' | 'concurrency'): DraftSaveTarget => Object.freeze({
  projectId: m.projectId, containerProjectLabel: m.projectId, apiUrl: 'http://127.0.0.1:54331', databaseHost: '127.0.0.1', databasePort: 54332,
  containerId: 'a'.repeat(64), disposable: true, reviewedHead: m.reviewedHead, migrationManifestSha256: m.migrationManifestSha256,
  reviewedSourceSha256: m.sourceSha256, acceptedManifestSha256: digest(JSON.stringify(m[phase])),
})
describe('fixed recovery260 profile reuses the closed native engine', () => {
  it('binds complete260 inventory, real observed identities and fixed finite SQL', () => {
    const m = plan()
    expect(m.migrations).toHaveLength(268); expect(m.nativeVerified).toBe(false)
    expect(m.contracts.checks).toHaveLength(13); expect(m.concurrency.schedules).toHaveLength(10)
    expect(m.setup).not.toMatch(/\b(?:insert|update|delete|commit)\b/i)
    expect(m.preparation).toContain(`draft_revision=${observed[0].revision}`)
    expect(m.preparation).toContain(`id='${observed[0].attemptId}'`)
    expect(m.preparation).toContain('Observed Start binding differs')
    expect(m.preparation).toContain("'closed'")
    expect(validateTestOwnerRecoveryNativePlanSql(m, m.preparation)).toBe(false)
    expect(m.snapshot).toContain('public.test_attempt_history'); expect(m.snapshot).toContain('public.classroom_archive_revisions')
    for (const sql of [m.setup, m.snapshot, m.contracts.sql, ...m.concurrency.schedules.flatMap(s => [s.holderSql, s.rejectSql])]) {
      expect(validateTestOwnerRecoveryNativePlanSql(m, sql)).toBe(true)
      expect(validateTestOwnerRecoveryNativePlanSql(m, sql + ' select 1;')).toBe(false)
    }
    expect(validateTestOwnerRecoveryNativePlanSql(Object.freeze({ ...m, setup: 'select 1;' }), 'select 1;')).toBe(false)
    expect(() => testOwnerRecoveryNativePlan(original, [...observed], 'b'.repeat(40), process.cwd())).toThrow()
    expect(() => testOwnerRecoveryNativePlan(original, Object.freeze([observed[0], observed[0]]), 'b'.repeat(40), process.cwd())).toThrow()
  })
  it.each(['missing260', 'bad262name', 'bad262digest', 'bad262bytes', 'self-hashed262bytes', 'bad261name', 'bad261digest', 'bad261bytes', 'self-hashed261bytes', 'future269', 'altered259', 'self-hashed260'])('refuses incomplete/altered predecessor chain %s', defect => {
    const migrations = platform.loadAssignmentListReviewedMigrations(process.cwd()).map(m => ({ ...m }))
    if (defect === 'missing260') migrations.splice(259,1)
    if (defect === 'future269') migrations.push({ name: '269_unknown.sql', sql: 'select 1;', sha256: digest('select 1;') })
    if (defect === 'bad262name') migrations[261].name = '262_unknown.sql'
    if (defect === 'bad262digest') migrations[261].sha256 = 'f'.repeat(64)
    if (defect === 'bad262bytes' || defect === 'self-hashed262bytes') migrations[261].sql += '\n'
    if (defect === 'self-hashed262bytes') migrations[261].sha256 = digest(migrations[261].sql)
    if (defect === 'bad261name') migrations[260].name = '261_unknown.sql'
    if (defect === 'bad261digest') migrations[260].sha256 = 'f'.repeat(64)
    if (defect === 'bad261bytes' || defect === 'self-hashed261bytes') migrations[260].sql += '\n'
    if (defect === 'self-hashed261bytes') migrations[260].sha256 = digest(migrations[260].sql)
    if (defect === 'altered259') migrations[258].sql += '\n'
    if (defect === 'self-hashed260') { migrations[259].sql += '\n'; migrations[259].sha256 = digest(migrations[259].sql) }
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValueOnce(migrations)
    try { expect(plan).toThrow() } finally { loader.mockRestore() }
  })
  it('uses unchanged engine caps/termination and same service-only privilege boundary', () => {
    const m = buildTestOwnerRecoveryNativeContractsManifest(original, observed, 'b'.repeat(40), process.cwd())
    expect(m.capabilities).toMatchObject({ sessions: 2, totalMs: 900000, controlCalls: 4000 })
    expect(m.privilege.expectedEvidence).toEqual({ status: 503, rpcCalls: 1, rawCode: '42501' })
    expect(m.privilege.catalog).toContain('public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamp with time zone)')
    expect(m.privilege.restore).toContain('grant execute'); expect(m.termination).toContain('backend_start')
    expect(digest(readFileSync('supabase/migrations/259_contextual_test_owner_grading.sql', 'utf8'))).toBe('698948d58fabdceb9df2869dfa99dc3cd22be6640a198da6de31b17fb9fa3540')
  })
  it('requires exact contract receipts and closes on success/failure', async () => {
    const m = plan(), t = target(m, 'contracts'), close = vi.fn(async () => {}), execute = vi.fn(async () => [{ result: { checks: m.contracts.checks } }])
    const driver: DraftSaveDriver = { verifyTarget: vi.fn(async () => t), openSession: vi.fn(async name => ({ name, execute, rollbackAndClose: close })) }
    expect(await runTestOwnerRecoveryNativeContracts(m, t, driver)).toEqual({ checks: m.contracts.checks, nativeVerified: false })
    execute.mockResolvedValueOnce([{ result: { checks: [] } }])
    await expect(runTestOwnerRecoveryNativeContracts(m, t, driver)).rejects.toThrow(); expect(close).toHaveBeenCalledTimes(2)
    driver.openSession = vi.fn()
    await expect(runTestOwnerRecoveryNativeContracts(Object.freeze({ ...m, sourceSha256: '0'.repeat(64) }), t, driver)).rejects.toThrow()
    await expect(runTestOwnerRecoveryNativeContracts(m, Object.freeze({ ...t, databasePort: 54322 }), driver)).rejects.toThrow()
    expect(driver.openSession).not.toHaveBeenCalled()
  })
  it('validates every holder witness and closes both mock sessions', async () => {
    const m = plan(), t = target(m, 'concurrency'), close = vi.fn(async () => {}), sqls: string[] = []
    const driver: DraftSaveDriver = { verifyTarget: vi.fn(async () => t), openSession: vi.fn(async name => ({ name, rollbackAndClose: close, execute: async sql => {
      sqls.push(sql); const s = m.concurrency.schedules.find(s => s.holderSql === sql || s.rejectSql === sql)!
      return [{ result: s.holderSql === sql ? { held: true, transaction: true, scope: true, backend_pid: 11, application_name: name, label: s.label, relation: s.relation }
        : { rejected: true, code: s.code, rows_unchanged: true, label: s.label } }]
    } })) }
    expect((await runTestOwnerRecoveryNativeRaces(m, t, driver)).outcomes).toHaveLength(10)
    expect(sqls).toHaveLength(20); expect(close).toHaveBeenCalledTimes(20)
    driver.openSession = vi.fn(async name => ({ name, rollbackAndClose: close, execute: async () => [{ result: { held: false } }] }))
    await expect(runTestOwnerRecoveryNativeRaces(m, t, driver)).rejects.toThrow(); expect(close).toHaveBeenCalledTimes(22)
  })
})

describe('complete reviewed268 source profile (offline)', () => {
  it.each([263, 264, 265, 266, 267, 268])('accepts exact complete source profile %i', count => {
    const migrations = platform.loadAssignmentListReviewedMigrations(process.cwd()).slice(0, count)
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    try { expect(() => plan()).not.toThrow() } finally { loader.mockRestore() }
  })
  it.each([263, 264, 265, 266, 267, 268].flatMap(number => ['name', 'digest', 'bytes', 'self-hashed-bytes'].map(defect => ({ number, defect }))))('rejects altered migration $number: $defect', ({ number, defect }) => {
    const migrations = platform.loadAssignmentListReviewedMigrations(process.cwd()).map(migration => ({ ...migration }))
    const tail = migrations[number - 1]
    if (defect === 'name') tail.name = `${number}_unknown.sql`
    if (defect === 'digest') tail.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') tail.sql += '\n'
    if (defect === 'self-hashed-bytes') tail.sha256 = createHash('sha256').update(tail.sql).digest('hex')
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    try { expect(() => plan()).toThrow() } finally { loader.mockRestore() }
  })
  it('rejects a contiguous unknown269 source tail', () => {
    const migrations = platform.loadAssignmentListReviewedMigrations(process.cwd()).map(migration => ({ ...migration }))
    migrations.push({ name: '269_unknown.sql', sql: 'select 1;', sha256: createHash('sha256').update('select 1;').digest('hex') })
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    try { expect(() => plan()).toThrow() } finally { loader.mockRestore() }
  })
})
