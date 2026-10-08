import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerCreateFixture } from '../../scripts/contextual-test-owner-create-proof-fixture'
import { draftSaveMigrationManifestSha256, type DraftSaveDriver, type DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'
import { TEST_OWNER_CREATE_CONCURRENCY_CAPS, testOwnerCreateConcurrencyManifest, validateOwnerCreateTarget,
  validateTestOwnerCreateConcurrencySql, runTestOwnerCreateConcurrency } from '../../scripts/check-contextual-test-create-concurrency'

const repository = process.cwd()
const f = newTestOwnerCreateFixture(newAssignmentListProofFixture(new Date('2026-10-06T03:30:00Z')))
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const manifest = testOwnerCreateConcurrencyManifest(f)
const target: DraftSaveTarget = Object.freeze({ projectId: `pika_assignment_list_${f.tag.slice(-12)}`,
  containerProjectLabel: `pika_assignment_list_${f.tag.slice(-12)}`, containerId: 'a'.repeat(64), disposable: true,
  apiUrl: 'http://127.0.0.1:54331', databaseHost: '127.0.0.1', databasePort: 54332,
  reviewedHead: 'b'.repeat(40), migrationManifestSha256: draftSaveMigrationManifestSha256(repository),
  reviewedSourceSha256: hash(readFileSync(resolve(repository, 'supabase/migrations/250_contextual_test_owner_create.sql'), 'utf8')),
  acceptedManifestSha256: hash(JSON.stringify(manifest)) })

function mockDriver(options: { failSql?: string; failOpen?: number; failClose?: string; drift?: boolean; driftOnVerify?: number;
  exhaust?: boolean; exhaustOnVerify?: number; oversized?: boolean; throwUndefined?: boolean; badObserve?: boolean; badReject?: boolean } = {}) {
  const closed: string[] = []; const calls: { name: string; sql: string; timeout: number }[] = []; let opens = 0; let verifications = 0
  const driver: DraftSaveDriver = {
    verifyTarget: vi.fn(async () => {
      verifications++
      if (options.exhaustOnVerify === verifications) vi.setSystemTime(new Date(Date.now() + TEST_OWNER_CREATE_CONCURRENCY_CAPS.totalMs))
      return options.drift || options.driftOnVerify === verifications ? Object.freeze({ ...target, containerId: 'c'.repeat(64) }) : target
    }),
    openSession: vi.fn(async name => {
      if (++opens === options.failOpen) throw new Error('session dropped')
      return { name, execute: vi.fn(async (sql: string, timeout: number) => {
        calls.push({ name, sql, timeout })
        if (options.throwUndefined) throw undefined
        if (sql === options.failSql) throw new Error('dispatch failed')
        if (options.exhaust) vi.setSystemTime(new Date(Date.now() + TEST_OWNER_CREATE_CONCURRENCY_CAPS.totalMs))
        if (options.oversized) return [{ result: 'x'.repeat(TEST_OWNER_CREATE_CONCURRENCY_CAPS.responseBytes + 1) }]
        if (manifest.schedules.some(s => sql === s.observeSql)) return [{ result: { held: !options.badObserve, transaction: true, scope: true } }]
        if (manifest.schedules.some(s => sql === s.rejectSql)) return [{ result: { rejected: true, code: 'PT409', rowsUnchanged: !options.badReject } }]
        return []
      }), rollbackAndClose: vi.fn(async () => { closed.push(name); if (options.failClose === name) throw new Error('close failed') }) }
    }),
  }
  return { driver, closed, calls }
}
afterEach(() => vi.useRealTimers())

describe('migration250 finite rollback CREATE races', () => {
  it('builds exactly nine frozen schedules with finite, disjoint extra legacy IDs', () => {
    expect(manifest.schedules.map(s => s.label)).toEqual(['contextual_create', 'owner_transfer', 'archive', 'purge_fence',
      'archive_revision', 'category_replacement_row', 'managed_settings', 'legacy_test_insert', 'actor_row'])
    expect(manifest).toEqual(testOwnerCreateConcurrencyManifest(f))
    expect(manifest.sourceFile).toBe('250_contextual_test_owner_create.sql')
    expect(Object.isFrozen(manifest.schedules[0])).toBe(true)
    expect(Object.isFrozen(manifest.schedules)).toBe(true)
    expect(manifest.extraAllocatedIds).toHaveLength(2)
    expect(new Set(manifest.extraAllocatedIds).size).toBe(2)
    expect(manifest.extraAllocatedIds.every(id => !f.forbiddenWitnessIds.includes(id))).toBe(true)
    expect(manifest.caps).toEqual({ totalMs: 180000, dispatches: 180, requestMs: 12000, sessions: 2, schedules: 9, sqlBytes: 262144, responseBytes: 8388608 })
  })
  it('seals exact guards, scopes, source and rollback SQL without a249 template', () => {
    expect(manifest.begin).toContain("current_database()<>'postgres'")
    for (const setting of ['pal_membership_settings', 'pal_classroom_signal_settings', 'student_provider_cleanup_settings', 'removed_student_academic_settings']) expect(manifest.begin).toContain(setting)
    expect(manifest.begin).toContain('create_test_for_owner_v1(uuid,uuid,text,timestamp with time zone)')
    expect(manifest.begin).not.toContain('Migration249')
    expect(manifest.begin).not.toMatch(/set.*pika\.(identity_mapping|archive)/i)
    for (const schedule of manifest.schedules) {
      expect(schedule.rejectSql).toContain("sqlstate 'PT409'")
      expect(schedule.rejectSql).toContain("n.nspname in ('public','private','storage')")
      expect(schedule.rejectSql).toContain('owner_create_before is distinct from')
      expect(schedule.observeSql).toContain('pg_backend_pid()')
      expect(schedule.observeSql).toContain('xact_start is not null')
      expect(schedule.holderSql).toContain(f.classes[0].id)
      expect(schedule.holderSql).not.toMatch(/delete from|truncate |setval\(|restart identity/i)
    }
    expect(manifest.schedules.find(s => s.label === 'actor_row')!.holderSql).toContain('for update nowait')
    expect(manifest.schedules.find(s => s.label === 'category_replacement_row')!.holderSql).toContain('order by is_default desc,position,id')
    expect(manifest.schedules.find(s => s.label === 'legacy_test_insert')!.holderSql).toContain('insert into public.tests')
    expect(manifest.rollback).toBe('rollback;')
  })
  it('accepts only exact manifest statements, not arbitrary SQL or SHA substitution', () => {
    for (const sql of [manifest.begin, manifest.rollback, ...manifest.schedules.flatMap(s => [s.holderSql, ...(s.holderWitnessSql ?? []), s.observeSql, s.rejectSql, ...(s.afterSql ? [s.afterSql] : [])])]) {
      expect(validateTestOwnerCreateConcurrencySql(manifest, sql)).toBe(true)
      expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(manifest.caps.sqlBytes)
      expect(validateTestOwnerCreateConcurrencySql(manifest, sql + ' ')).toBe(false)
    }
    expect(validateTestOwnerCreateConcurrencySql(manifest, 'select 1;')).toBe(false)
    expect(validateTestOwnerCreateConcurrencySql(manifest, manifest.schedules[0].rejectSql.replace(f.actors[0].id, f.actors[1].id))).toBe(false)
    expect(validateTestOwnerCreateConcurrencySql(manifest, 'x'.repeat(manifest.caps.sqlBytes + 1))).toBe(false)
  })
  it('checks every forbidden UUID in at most six sealed bounded holder witness chunks', () => {
    const checks = manifest.schedules[0].holderWitnessSql!
    expect(checks.length).toBeGreaterThan(0); expect(checks.length).toBeLessThanOrEqual(6)
    const joined = checks.join('\n')
    for (const id of f.forbiddenWitnessIds) expect(joined).toContain(id)
    expect(manifest.schedules[0].holderSql).toContain("set_config('pika.proof_test_owner_create_holder_ids',ids::text,true)")
    for (const sql of checks) {
      expect(sql).toContain("current_setting('pika.proof_test_owner_create_holder_ids',true)::uuid[]")
      expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(262144)
      expect(sql).not.toMatch(/select .* from public\./)
    }
  })
  it('excludes all previously committed SDK witness identities before the rollback holder call', () => {
    const sql = manifest.schedules[0].holderSql
    expect(sql).toContain('prior_ids uuid[]')
    expect(sql).toContain('ids && prior_ids')
    expect(sql.indexOf('into prior_ids')).toBeLessThan(sql.indexOf('r:=public.create_test_for_owner_v1'))
    expect(sql).toContain('select artifact_id as id from public.tests')
    expect(sql).toContain('select id from public.assessment_drafts')
    for (const classroom of f.classes) expect(sql).toContain(classroom.id)
  })
  it('validates250 bytes plus the complete chain and exact disposable resource identity', () => {
    expect(validateOwnerCreateTarget(target, f, repository)).toBe(target)
    for (const patch of [{ databasePort: 54322 }, { apiUrl: 'https://remote.supabase.co' }, { databaseHost: 'localhost' },
      { disposable: false }, { projectId: 'production' }, { containerProjectLabel: 'other' }, { containerId: 'a' },
      { reviewedHead: 'b' }, { reviewedSourceSha256: '0'.repeat(64) }, { migrationManifestSha256: '0'.repeat(64) }]) {
      expect(() => validateOwnerCreateTarget(Object.freeze({ ...target, ...patch }) as DraftSaveTarget, f, repository)).toThrow()
    }
    expect(() => validateOwnerCreateTarget({ ...target }, f, repository)).toThrow()
    expect(() => testOwnerCreateConcurrencyManifest({ ...f })).toThrow()
  })
  it('runs only sealed dispatches, observes rejection before raw progression, then closes both', async () => {
    const m = mockDriver(); const result = await runTestOwnerCreateConcurrency(f, target, repository, m.driver)
    expect(result.schedules).toEqual(manifest.schedules.map(s => s.label))
    expect(result.kind).toBe('two-session-contention')
    expect(result.sourceSha256).toBe(target.reviewedSourceSha256)
    expect(result.manifestSha256).toBe(target.acceptedManifestSha256)
    expect(result.dispatches).toBe(m.calls.length)
    expect(result.dispatches).toBeLessThanOrEqual(180)
    expect(m.closed).toHaveLength(18)
    expect(m.driver.openSession).toHaveBeenCalledTimes(18)
    for (const call of m.calls) { expect(call.timeout).toBeGreaterThan(0); expect(call.timeout).toBeLessThanOrEqual(12000) }
    for (const schedule of manifest.schedules) if (schedule.afterSql) expect(m.calls.findIndex(c => c.sql === schedule.afterSql)).toBeGreaterThan(m.calls.findIndex(c => c.sql === schedule.rejectSql))
    expect(m.calls.every(c => validateTestOwnerCreateConcurrencySql(manifest, c.sql))).toBe(true)
  })
  it('rejects manifest substitution before opening sessions', async () => {
    const m = mockDriver()
    await expect(runTestOwnerCreateConcurrency(f, Object.freeze({ ...target, acceptedManifestSha256: '0'.repeat(64) }), repository, m.driver)).rejects.toThrow()
    expect(m.driver.openSession).not.toHaveBeenCalled()
  })
  it.each([{ badObserve: true }, { badReject: true }, { failSql: manifest.schedules[0].rejectSql }, { drift: true }])('fails closed for %j and closes every opened session', async options => {
    const m = mockDriver(options)
    await expect(runTestOwnerCreateConcurrency(f, target, repository, m.driver)).rejects.toThrow()
    expect(m.closed.length).toBe(options.drift ? 0 : 2)
    expect(m.calls.some(c => c.sql === manifest.schedules[0].afterSql)).toBe(false)
  })
  it('closes the first session when the second open fails', async () => {
    const m = mockDriver({ failOpen: 2 })
    await expect(runTestOwnerCreateConcurrency(f, target, repository, m.driver)).rejects.toThrow('session dropped')
    expect(m.closed).toEqual([`${target.projectId}_draft_holder`])
  })
  it('all-settled closes the contender even if holder close fails', async () => {
    const m = mockDriver({ failSql: manifest.schedules[0].holderSql, failClose: `${target.projectId}_draft_holder` })
    await expect(runTestOwnerCreateConcurrency(f, target, repository, m.driver)).rejects.toBeInstanceOf(AggregateError)
    expect(m.closed).toEqual([`${target.projectId}_draft_holder`, `${target.projectId}_draft_contender`])
  })
  it('exhaustion stops dispatches and closes both, without resetting sequence state', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T04:00:00Z'))
    const m = mockDriver({ exhaust: true })
    await expect(runTestOwnerCreateConcurrency(f, target, repository, m.driver)).rejects.toThrow(/budget exhausted/)
    expect(m.calls).toHaveLength(1)
    expect(m.closed).toHaveLength(2)
  })
  it('fresh inventory drift after both opens closes both before SQL dispatch', async () => {
    const m = mockDriver({ driftOnVerify: 3 })
    await expect(runTestOwnerCreateConcurrency(f, target, repository, m.driver)).rejects.toThrow()
    expect(m.calls).toHaveLength(0); expect(m.closed).toHaveLength(2)
  })
  it('counts target guard time in the180s budget and closes both without dispatch', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T04:00:00Z'))
    const m = mockDriver({ exhaustOnVerify: 3 })
    await expect(runTestOwnerCreateConcurrency(f, target, repository, m.driver)).rejects.toThrow(/budget exhausted/)
    expect(m.calls).toHaveLength(0); expect(m.closed).toHaveLength(2)
  })
  it('fails closed on oversized replies and still closes both sessions', async () => {
    const m = mockDriver({ oversized: true })
    await expect(runTestOwnerCreateConcurrency(f, target, repository, m.driver)).rejects.toThrow(/Response budget exhausted/)
    expect(m.calls).toHaveLength(1); expect(m.closed).toHaveLength(2)
  })
  it('does not confuse a thrown undefined failure with successful execution', async () => {
    const m = mockDriver({ throwUndefined: true })
    await expect(runTestOwnerCreateConcurrency(f, target, repository, m.driver)).rejects.toBeUndefined()
    expect(m.calls).toHaveLength(1); expect(m.closed).toHaveLength(2)
  })
  it('is an inert module with no CLI, process runner, provider client or timer engine', () => {
    const source = readFileSync(resolve(repository, 'scripts/check-contextual-test-create-concurrency.ts'), 'utf8')
    expect(source).not.toMatch(/node:child_process|createClient\(|fetch\(|process\.argv|setTimeout\(|Promise\.race\(/)
    expect(source).toContain('type DraftSaveDriver, type DraftSaveSession, type DraftSaveTarget')
    expect(source).not.toContain('snapshot_test_draft')
  })
})
