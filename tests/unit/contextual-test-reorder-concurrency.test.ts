import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerReorderFixture } from '../../scripts/contextual-test-reorder-proof-fixture'
import { runTestOwnerReorderConcurrency, testOwnerReorderConcurrencyManifest, validateTestOwnerReorderConcurrencySql } from '../../scripts/check-contextual-test-reorder-concurrency'
import type { DraftSaveDriver, DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'

const fixture = newTestOwnerReorderFixture(newAssignmentListProofFixture(new Date('2026-10-07T04:00:00Z')))
const manifest = testOwnerReorderConcurrencyManifest(fixture)
const target: DraftSaveTarget = Object.freeze({ projectId: manifest.projectId, apiUrl: 'http://127.0.0.1:54331',
  databaseHost: '127.0.0.1', databasePort: 54332, containerId: 'a'.repeat(64), containerProjectLabel: manifest.projectId,
  disposable: true, reviewedHead: 'b'.repeat(40), migrationManifestSha256: 'c'.repeat(64), reviewedSourceSha256: manifest.sourceSha256,
  acceptedManifestSha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex') })

describe('inert owner Test reorder rollback race schedules', () => {
  it('seals real writer operations and precise contention, not generic caller SQL', () => {
    expect(manifest.schedules).toHaveLength(21)
    expect(Object.isFrozen(manifest.schedules)).toBe(true)
    const sql = manifest.schedules.map(s => s.holderSql).join('\n')
    for (const name of ['reorder_tests_for_owner_v1', 'create_test_for_owner_v1', 'discard_pristine_test_draft_for_owner_v1',
      'finish_test_draft_save_for_owner_v1', 'publish_test_from_draft_for_owner_v1']) expect(sql).toContain(`public.${name}(`)
    for (const schedule of manifest.schedules) {
      expect(validateTestOwnerReorderConcurrencySql(manifest, schedule.holderSql)).toBe(true)
      expect(validateTestOwnerReorderConcurrencySql(manifest, schedule.rejectSql)).toBe(true)
      expect(validateTestOwnerReorderConcurrencySql(manifest, schedule.holderSql + ' select 1;')).toBe(false)
      expect(schedule.holderSql).toContain('pg_backend_pid()')
      expect(schedule.holderSql).toContain('xact_start')
      expect(schedule.rejectSql).toContain(`code is distinct from '${schedule.rejectedCode}'`)
      expect(schedule.rejectSql).toContain('rows_unchanged')
    }
    expect(manifest.limitations.join(' ')).toContain('after-commit')
    expect(manifest.limitations.join(' ')).toContain('Blueprint')
    expect(manifest.schedules.find(s => s.label === 'legacy-reparent')!.holderSql).toContain('gradebook_category_id=null')
    expect(manifest.schedules.find(s => s.label === 'declined-archived-blueprint-reuse114')!.holderSql).toContain('public.create_archived_classroom_blueprint_atomic(')
    expect(manifest.schedules.find(s => s.label === 'declined-archived-blueprint-reuse114')!.holderSql).toContain('source_classroom_not_archived')
    expect(manifest.schedules.find(s => s.label === 'actual-purge-lifecycle-guard122')!.holderSql).toContain('public.guard_classroom_purge_lifecycle(')
    expect(manifest.schedules.find(s => s.label === 'reorder-versus-actual-purge-guard122')!.rejectedCode).toBe('40001')
    expect(validateTestOwnerReorderConcurrencySql(manifest, 'delete from public.users;')).toBe(false)
  })

  it('always settles both exact owned sessions, including a failed contender', async () => {
    const close = [vi.fn(async () => {}), vi.fn(async () => {})]
    let opened = 0
    const driver: DraftSaveDriver = { verifyTarget: vi.fn(async () => target), openSession: vi.fn(async name => {
      const index = opened++
      return { name, execute: vi.fn(async () => { throw new Error('synthetic dispatch failure') }), rollbackAndClose: close[index] }
    }) }
    await expect(runTestOwnerReorderConcurrency(manifest, target, driver)).rejects.toThrow('synthetic dispatch failure')
    expect(opened).toBe(2)
    expect(close[0]).toHaveBeenCalledOnce(); expect(close[1]).toHaveBeenCalledOnce()
  })

  it('rejects drifted manifest identity before any session opens', async () => {
    const driver: DraftSaveDriver = { verifyTarget: vi.fn(async () => target), openSession: vi.fn() }
    await expect(runTestOwnerReorderConcurrency(manifest, Object.freeze({ ...target, acceptedManifestSha256: 'd'.repeat(64) }), driver)).rejects.toThrow()
    expect(driver.openSession).not.toHaveBeenCalled()
  })
})
