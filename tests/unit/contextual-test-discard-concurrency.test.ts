import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerPristineDiscardFixture } from '../../scripts/contextual-test-pristine-discard-proof-fixture'
import { TEST_OWNER_PRISTINE_DISCARD_CONCURRENCY_CAPS, testOwnerPristineDiscardConcurrencyManifest,
  validateTestOwnerPristineDiscardConcurrencySql, runTestOwnerPristineDiscardConcurrency } from '../../scripts/check-contextual-test-discard-concurrency'
import { draftSaveMigrationManifestSha256, type DraftSaveDriver } from '../../scripts/check-contextual-test-draft-save-db-contracts'

const f = newTestOwnerPristineDiscardFixture(newAssignmentListProofFixture(new Date('2026-10-06T03:00:00Z')))
const manifest = testOwnerPristineDiscardConcurrencyManifest(f)

describe('contextual pristine Test discard finite two-session source', () => {
  it('freezes finite rollback schedules and purpose-bound disjoint identities', () => {
    expect(manifest).toEqual(testOwnerPristineDiscardConcurrencyManifest(f))
    expect(manifest.caps).toEqual({ totalMs: 180000, dispatches: 180, requestMs: 12000, closeMs: 12000,
      sessions: 2, schedules: 14, sqlBytes: 256 * 1024, responseBytes: 8 * 1024 * 1024 })
    expect(manifest.schedules).toHaveLength(TEST_OWNER_PRISTINE_DISCARD_CONCURRENCY_CAPS.schedules)
    expect(Object.isFrozen(manifest)).toBe(true); expect(Object.isFrozen(manifest.schedules[0])).toBe(true)
    expect(new Set(manifest.extraAllocatedIds).size).toBe(manifest.extraAllocatedIds.length)
    expect(manifest.extraAllocatedIds.every(id => !f.allocatedIds.includes(id))).toBe(true)
    expect(manifest.begin).toContain('discard_pristine_test_draft_for_owner_v1')
    expect(manifest.rollback).toBe('rollback;')
  })

  it('covers contextual/legacy writers and every required held authority resource', () => {
    expect(manifest.schedules.map(s => s.label)).toEqual(['contextual-discard','legacy-156-discard','test-row','draft-row',
      'classroom-row','archive-revision','managed-settings','actor-row','owner-transfer','archive-class','test-advisory',
      'class-operation-advisory','membership-operation-advisory','direct-fk-child-insert'])
    for (const schedule of manifest.schedules) {
      expect(schedule.holderSql).toContain(f.cases[0].testId)
      expect(schedule.observeSql).toContain('pg_backend_pid()')
      expect(schedule.rejectSql).toContain("sqlstate 'PT409'")
      expect(schedule.rejectSql).toContain('rows_unchanged')
      expect(schedule.holderSql).not.toMatch(/truncate |setval\(|restart identity/i)
    }
  })

  it('accepts only exact sealed SQL and records explicit inherited gaps', () => {
    const statements = [manifest.begin, manifest.rollback, ...manifest.schedules.flatMap(s => [s.holderSql, s.observeSql, s.rejectSql, ...(s.afterSql ? [s.afterSql] : [])])]
    for (const sql of statements) { expect(validateTestOwnerPristineDiscardConcurrencySql(manifest, sql)).toBe(true); expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(manifest.caps.sqlBytes) }
    expect(validateTestOwnerPristineDiscardConcurrencySql(manifest, 'select 1;')).toBe(false)
    expect(validateTestOwnerPristineDiscardConcurrencySql(manifest, manifest.schedules[0].holderSql + ' ')).toBe(false)
    expect(manifest.limitations).toContain('legacy no-FK gradebook override writer can insert after discard commit; no orphan-proof claim')
    expect(manifest.limitations).toContain('managed-resource partial index requires actual planner evidence; catalog shape alone is not a plan claim')
    expect(manifest.evidence).toContain('rollback')
  })

  it('settles both exact sessions for every schedule through the sealed driver', async () => {
    const digest = (value: string) => createHash('sha256').update(value).digest('hex')
    const repository = process.cwd(); const closed: string[] = []; const opened: string[] = []
    const target = Object.freeze({ projectId: `pika_assignment_list_${f.tag.slice(-12)}`, apiUrl: 'http://127.0.0.1:54331',
      databaseHost: '127.0.0.1', databasePort: 54332, containerId: 'a'.repeat(64), containerProjectLabel: `pika_assignment_list_${f.tag.slice(-12)}`,
      disposable: true as const, reviewedHead: 'b'.repeat(40), migrationManifestSha256: draftSaveMigrationManifestSha256(repository),
      reviewedSourceSha256: digest(readFileSync(`${repository}/supabase/migrations/251_contextual_test_pristine_owner_discard.sql`, 'utf8')),
      acceptedManifestSha256: digest(JSON.stringify(manifest)) })
    const driver: DraftSaveDriver = { async verifyTarget() { return target }, async openSession(name) {
      opened.push(name); return { name, async execute(statement) {
        if (statement.includes("'held',exists")) return [{ result: { held: true, transaction: true, scope: true } }]
        if (statement.includes("'rejected',true")) return [{ result: { rejected: true, code: 'PT409', rows_unchanged: true } }]
        return []
      }, async rollbackAndClose() { closed.push(name) } }
    } }
    const result = await runTestOwnerPristineDiscardConcurrency(f, target, repository, driver)
    expect(result.schedules).toEqual(manifest.schedules.map(schedule => schedule.label)); expect(result.dispatches).toBe(70)
    expect(opened).toHaveLength(28); expect(closed).toEqual(opened)
    expect(new Set(opened)).toEqual(new Set([`${target.projectId}_draft_holder`, `${target.projectId}_draft_contender`]))
  })
})
