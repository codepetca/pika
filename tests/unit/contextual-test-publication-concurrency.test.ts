import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerPublicationFixture } from '../../scripts/contextual-test-publication-proof-fixture'
import {
  TEST_OWNER_PUBLICATION_CONCURRENCY_CAPS,
  testOwnerPublicationCommittedManifest,
  testOwnerPublicationConcurrencyManifest,
  runTestOwnerPublicationCommittedTransitions,
  runTestOwnerPublicationConcurrency,
  validateTestOwnerPublicationCommittedSql,
  validateTestOwnerPublicationConcurrencySql,
} from '../../scripts/check-contextual-test-publication-concurrency'
import { draftSaveMigrationManifestSha256, type DraftSaveDriver, type DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'
import { TEST_OWNER_PUBLICATION_SOURCE_SHA256 } from '../../scripts/contextual-test-publication-db-contracts'

const f = newTestOwnerPublicationFixture(newAssignmentListProofFixture(new Date('2026-10-06T12:00:00Z')))
const races = testOwnerPublicationConcurrencyManifest(f)
const committed = testOwnerPublicationCommittedManifest(f)

describe('contextual Test publication two-session source manifests', () => {
  it('seals twelve exact rollback schedules within the accepted action budget', () => {
    expect(TEST_OWNER_PUBLICATION_CONCURRENCY_CAPS).toMatchObject({ totalMs: 180_000, dispatches: 180,
      requestMs: 12_000, closeMs: 12_000, sessions: 2, rollbackSchedules: 12, committedTransitions: 5 })
    expect(races.schedules.map(s => s.label)).toEqual([
      'actor-row', 'classroom-row', 'test-row', 'draft-row', 'question-row', 'archive-revision-row',
      'managed-settings-row', 'test-advisory', 'class-operation-advisory', 'membership-operation-advisory',
      'legacy-publication', 'raw-question-writer',
    ])
    expect(races.schedules.length * 4).toBeLessThanOrEqual(48)
    expect(races.begin).toContain('_draft_holder')
    expect(races.begin).toContain('_draft_contender')
    expect(races.rollback).toBe('rollback;')
  })

  it('requires exact backend, transaction, lock and fixture scope evidence', () => {
    for (const schedule of races.schedules) {
      expect(schedule.holderSql).toContain('pg_backend_pid()')
      expect(schedule.holderSql).toContain('application_name')
      expect(schedule.holderSql).toContain('xact_start')
      expect(schedule.holderSql).toContain("'relation'")
      expect(schedule.holderSql).toContain("'lock_key'")
      expect(schedule.holderSql).toContain("'scope'")
      expect(schedule.rejectSql).toContain("'PT409'")
      expect(schedule.rejectSql).toContain("'rows_unchanged'")
      for (const sql of [races.begin, races.rollback, schedule.holderSql, schedule.rejectSql]) {
        expect(validateTestOwnerPublicationConcurrencySql(races, sql)).toBe(true)
      }
    }
    expect(races.schedules.find(s => s.label === 'actor-row')!.holderSql).toContain('for update nowait')
    expect(races.schedules.find(s => s.label === 'managed-settings-row')!.holderSql).toContain('for update nowait')
    for (const label of ['test-advisory','class-operation-advisory','membership-operation-advisory']) {
      const sql=races.schedules.find(s=>s.label===label)!.holderSql
      expect(sql).toContain("l.locktype='advisory'");expect(sql).toContain('l.classid::bigint');expect(sql).toContain('l.objid::bigint');expect(sql).toContain('l.objsubid=1')
    }
    expect(validateTestOwnerPublicationConcurrencySql(races, 'select 1')).toBe(false)
  })

  it('seals five committed transitions with complete capture phases and actual Start path', () => {
    expect(committed.schedules.map(t => t.label)).toEqual(f.transitions.map(t => t.label))
    expect(committed.schedules).toHaveLength(5)
    for (const transition of committed.schedules) {
      expect(transition.writerSql).toContain("'phase','writerCommit'")
      expect(transition.cacheSql).toContain('source_sha256')
      expect(transition.finalSql).toContain("'phase','after'")
      expect(transition.afterSql).toContain('public.tests')
      expect(transition.afterSql).toContain('public.test_questions')
      for (const sql of [transition.beforeSql, transition.cacheSql, transition.writerSql, transition.writerCommitSql, transition.finalSql, transition.afterSql]) {
        expect(validateTestOwnerPublicationCommittedSql(committed, sql)).toBe(true)
      }
    }
    const start = committed.schedules.find(t => t.label === 'publication-start')!
    expect(start.writerSql).toContain('start_test_attempt_revision_atomic')
    expect(start.finalSql).toContain('publish_test_from_draft_for_owner_v1')
    expect(start.afterSql).toContain('test_attempts')
    expect(start.writerSql).toContain("code is distinct from '42501'")
    expect(start.postStartSql).toContain("code is distinct from '42501'")
    expect(start.duringSql).toContain("code is distinct from '55P03'")
    expect(start.duringSql).toContain("'code','55P03'")
    expect(committed.limitations.join(' ')).toMatch(/wrong-Class.*no-FK/i)
    expect(validateTestOwnerPublicationCommittedSql(committed, 'select 1')).toBe(false)
  })

  it('does not expose arbitrary SQL or expected-state inputs', () => {
    expect(Object.keys(races)).toEqual(expect.arrayContaining(['version', 'fixture', 'caps', 'begin', 'rollback', 'schedules', 'limitations']))
    expect(Object.keys(committed)).toEqual(expect.arrayContaining(['version', 'fixture', 'caps', 'schedules', 'limitations']))
    expect(JSON.stringify({ races, committed })).not.toMatch(/sleep\s*\(|setval\s*\(|truncate\s/i)
    expect(new Set([...races.schedules.map(s => s.label), ...committed.schedules.map(s => s.label)]).size).toBe(17)
  })

  it('settles both exact sessions for every rollback schedule', async () => {
    const acceptedManifestSha256=createHash('sha256').update(JSON.stringify(races)).digest('hex')
    const target=Object.freeze({projectId:`pika_assignment_list_${f.tag.slice(-12)}`,apiUrl:'http://127.0.0.1:54331',databaseHost:'127.0.0.1',databasePort:54332,
      containerId:'a'.repeat(64),containerProjectLabel:`pika_assignment_list_${f.tag.slice(-12)}`,disposable:true as const,reviewedHead:'b'.repeat(40),
      migrationManifestSha256:draftSaveMigrationManifestSha256(process.cwd()),reviewedSourceSha256:TEST_OWNER_PUBLICATION_SOURCE_SHA256,acceptedManifestSha256}) satisfies DraftSaveTarget
    let closes=0;const driver:DraftSaveDriver={verifyTarget:async()=>target,openSession:async name=>({name,execute:async sql=>{
      const schedule=races.schedules.find(s=>s.holderSql===sql||s.rejectSql===sql)!;expect(schedule).toBeTruthy()
      return [{result:sql===schedule.rejectSql?{rejected:true,code:'PT409',rows_unchanged:true,label:schedule.label}:{held:true,transaction:true,scope:true,label:schedule.label,application_name:`${target.projectId}_draft_holder`}}]
    },rollbackAndClose:async()=>{closes++}})}
    await expect(runTestOwnerPublicationConcurrency(f,target,process.cwd(),driver)).resolves.toMatchObject({kind:'rollback-publication-contention',schedules:races.schedules.map(s=>s.label),dispatches:24})
    expect(closes).toBe(24)
  })

  it('settles both committed sessions when captured evidence is malformed', async () => {
    const acceptedManifestSha256=createHash('sha256').update(JSON.stringify(committed)).digest('hex')
    const target=Object.freeze({projectId:`pika_assignment_list_${f.tag.slice(-12)}`,apiUrl:'http://127.0.0.1:54331',databaseHost:'127.0.0.1',databasePort:54332,
      containerId:'a'.repeat(64),containerProjectLabel:`pika_assignment_list_${f.tag.slice(-12)}`,disposable:true as const,reviewedHead:'b'.repeat(40),
      migrationManifestSha256:draftSaveMigrationManifestSha256(process.cwd()),reviewedSourceSha256:TEST_OWNER_PUBLICATION_SOURCE_SHA256,acceptedManifestSha256}) satisfies DraftSaveTarget
    let closes=0;const driver:DraftSaveDriver={verifyTarget:async()=>target,openSession:async name=>({name,execute:async()=>[{result:{}}],rollbackAndClose:async()=>{closes++}})}
    await expect(runTestOwnerPublicationCommittedTransitions(f,target,process.cwd(),driver)).rejects.toThrow()
    expect(closes).toBe(2)
  })
})
