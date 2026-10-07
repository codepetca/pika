import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerReorderFixture } from '../../scripts/contextual-test-reorder-proof-fixture'
import { runTestOwnerReorderConcurrency, testOwnerReorderConcurrencyManifest, validateTestOwnerReorderConcurrencySql } from '../../scripts/check-contextual-test-reorder-concurrency'
import type { DraftSaveDriver, DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'
import { testOwnerGuardSql } from '../../scripts/contextual-test-owner-detail-proof-fixture'
import * as ownerFixture from '../../scripts/contextual-test-owner-detail-proof-fixture'

const fixture = newTestOwnerReorderFixture(newAssignmentListProofFixture(new Date('2026-10-07T04:00:00Z')))
const manifest = testOwnerReorderConcurrencyManifest(fixture)
const target: DraftSaveTarget = Object.freeze({ projectId: manifest.projectId, apiUrl: 'http://127.0.0.1:54331',
  databaseHost: '127.0.0.1', databasePort: 54332, containerId: 'a'.repeat(64), containerProjectLabel: manifest.projectId,
  disposable: true, reviewedHead: 'b'.repeat(40), migrationManifestSha256: 'c'.repeat(64), reviewedSourceSha256: manifest.sourceSha256,
  acceptedManifestSha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex') })

describe('inert owner Test reorder rollback race schedules', () => {
  it('retains every inherited guard predicate while admitting only the exact two race sessions in one writable transaction', () => {
    const prefix = "begin read only;set local lock_timeout='3s';set local statement_timeout='30s';"
    const terminal = "end;$guard$;select 'ok';rollback;"
    const identity = `current_setting('application_name')<>'${manifest.projectId}_fixture'`
    const original = testOwnerGuardSql(manifest.projectId)
    expect(original.startsWith(prefix) && original.endsWith(terminal)).toBe(true)
    expect(original.split(identity)).toHaveLength(2)
    const inherited = original.slice(prefix.length, -terminal.length).replace(identity,
      `current_setting('application_name') not in ('${manifest.projectId}_draft_holder','${manifest.projectId}_draft_contender')`)
    for (const schedule of manifest.schedules) for (const sql of [schedule.holderSql, schedule.rejectSql]) {
      expect(sql).toContain(inherited)
      expect(sql.startsWith("begin;set local lock_timeout='1s';set local statement_timeout='12s';")).toBe(true)
      expect(sql).not.toContain(identity)
      expect(sql).not.toContain('begin read only')
      expect(sql).not.toContain("select 'ok';rollback;")
      expect(sql).toContain("to_regprocedure('public.reorder_tests_for_owner_v1(uuid,uuid,uuid[],timestamptz)') is null")
      expect(sql).toContain("current_database()<>'postgres' or current_user<>'postgres'")
      expect(validateTestOwnerReorderConcurrencySql(manifest, sql.replace('_draft_holder', '_fixture'))).toBe(false)
    }
  })

  it('rejects changed inherited wrappers or a missing/duplicated setup identity before generating any race SQL', () => {
    const original = testOwnerGuardSql(manifest.projectId)
    const identity = `current_setting('application_name')<>'${manifest.projectId}_fixture'`
    for (const changed of [original.replace('begin read only;', 'begin;'),
      original.replace("lock_timeout='3s'", "lock_timeout='2s'"), original.replace("statement_timeout='30s'", "statement_timeout='12s'"),
      original.replace("select 'ok';rollback;", 'rollback;'), original.replace(identity, 'true'),
      original.replace(identity, `${identity} or ${identity}`)]) {
      const spy = vi.spyOn(ownerFixture, 'testOwnerGuardSql').mockReturnValue(changed)
      try { expect(() => testOwnerReorderConcurrencyManifest(fixture)).toThrow() } finally { spy.mockRestore() }
    }
  })

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
