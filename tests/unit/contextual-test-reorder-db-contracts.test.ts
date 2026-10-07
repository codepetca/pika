import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerReorderFixture } from '../../scripts/contextual-test-reorder-proof-fixture'
import {
  TEST_OWNER_REORDER_SOURCE_SHA256, TEST_OWNER_REORDER_DB_CAPS, TEST_OWNER_REORDER_TEST_COLUMNS,
  testOwnerReorderDbContractsManifest, runTestOwnerReorderDbContracts,
} from '../../scripts/contextual-test-reorder-db-contracts'
import type { DraftSaveDriver, DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'

const fixture = newTestOwnerReorderFixture(newAssignmentListProofFixture(new Date('2026-10-07T12:00:00Z')))
const projectId = `pika_assignment_list_${fixture.tag.slice(-12)}`
const manifest = testOwnerReorderDbContractsManifest(fixture, projectId)
const sql = manifest.contracts.map(batch => batch.sql).join('\n')
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

function target(): DraftSaveTarget {
  return Object.freeze({ projectId, apiUrl: 'http://127.0.0.1:54331', databaseHost: '127.0.0.1', databasePort: 54332,
    containerId: 'a'.repeat(64), containerProjectLabel: projectId, disposable: true as const,
    reviewedHead: 'b'.repeat(40), migrationManifestSha256: 'c'.repeat(64),
    reviewedSourceSha256: TEST_OWNER_REORDER_SOURCE_SHA256, acceptedManifestSha256: digest(JSON.stringify(manifest)) })
}

describe('inert contextual Test reorder database contracts', () => {
  it('pins the exact source and emits finite frozen rollback batches', () => {
    expect(TEST_OWNER_REORDER_SOURCE_SHA256).toBe('6c58370f3234cce74a767cde1819a4d6af0265725cb69b843f54b4e8a9b55c6e')
    expect(digest(readFileSync('supabase/migrations/253_contextual_test_owner_reorder.sql', 'utf8'))).toBe(TEST_OWNER_REORDER_SOURCE_SHA256)
    expect(TEST_OWNER_REORDER_DB_CAPS).toEqual({ sqlBytes: 262144, responseBytes: 1048576, actionMs: 35000, requestMs: 12000, batches: 9 })
    expect(manifest.contracts).toHaveLength(9)
    for (const batch of manifest.contracts) {
      expect(Object.isFrozen(batch)).toBe(true)
      expect(Buffer.byteLength(batch.sql)).toBeLessThanOrEqual(262144)
      expect(batch.sql.trimStart()).toMatch(/^begin;/)
      expect(batch.sql.trimEnd()).toMatch(/rollback;$/)
      expect(batch.sql.match(/\bas result\b/g)).toHaveLength(1)
      expect(batch.sql).not.toMatch(/\bcommit\s*;|setval\s*\(|truncate\s|reset\s+.*sequence/i)
    }
    expect(Object.isFrozen(manifest)).toBe(true)
    expect(manifest.sourceFile).toBe('253_contextual_test_owner_reorder.sql')
  })

  it('seals exact columns, all13 triggers, column qualifiers and reachable routine source', () => {
    expect(TEST_OWNER_REORDER_TEST_COLUMNS).toHaveLength(21)
    for (const token of ['prosecdef', 'search_path=""', 'lock_timeout=1s', 'pg_catalog.aclexplode',
      'update_tests_updated_at', 'tgattr', 'tgqual', 'tgargs', 'tgenabled', 'tgdeferrable', 'tginitdeferred',
      'Exact13 Test trigger closure differs', 'Reachable routine source differs', 'pg_catalog.md5(proc.prosrc)',
      'resolve_classroom_archive_resource_classroom_id(text,uuid)', 'bump_classroom_archive_revision_from_resource()',
      'touch_classroom_blueprint_source_revision()', 'private.try_lock_classroom_membership_change(uuid,uuid)',
      'public.bump_classroom_blueprint_source_revision()', 'public.update_updated_at_column()',
    ]) expect(sql).toContain(token)
    expect(manifest.reachableFunctions).toHaveLength(22)
    expect(manifest.reachableFunctions.some(routine => routine.signature === 'public.create_archived_classroom_blueprint_atomic(uuid,uuid,text,uuid,bigint,jsonb)')).toBe(true)
    expect(manifest.reachableFunctions.every(routine=>routine.sourceSha256.length===64&&routine.prosrcMd5.length===32)).toBe(true)
    expect(sql).toContain("'gradebook_maximum_override'")
  })

  it('prepares all role, membership, boundary and fault checks without claiming execution', () => {
    for (const label of ['teacher-owner', 'student-owner', 'teacher-noop', 'empty-owner',
      'member-denied', 'teacher-member-denied', 'historical-creator-denied', 'archived-owner-denied',
      'partial-membership', 'superset-membership', 'foreign-membership', 'duplicate-membership', 'null-array', 'null-member',
      'bulk-1001', 'bulk-10000', 'source-10001-limit', 'full-10001-input', 'row-byte-limit', 'state-byte-limit',
      'class-byte-limit', 'revision-limit', 'archive-revision-limit', 'deadline-reached', 'deadline-nonfinite',
      'maintenance-restore', 'maintenance-compaction', 'identity-mapping', 'classroom-finalize', 'blueprint-finalize', 'student-finalize',
      'classroom-purge-fence', 'provider-cleanup-binding',
      'suppress-write', 'alter-position', 'alter-title', 'reparent-write', 'revision-drift', 'settings-drift',
      'raw-42501', 'unknown-55000', 'deadline-after-write',
    ]) expect(sql).toContain(label)
    expect(sql).toContain("errcode='42501',message='reorder raw privilege probe'")
    expect(sql).toContain("code is distinct from '42501'")
    expect(sql).toContain("errcode='55000',message='reorder unknown probe'")
    expect(sql).toContain("code is distinct from 'PT503'")
    expect(sql).toContain('Reorder fault trigger was not reached')
    expect(sql).toContain('Rollback graph differs')
    expect(manifest.limitations.join(' ')).toMatch(/nontransactional/)
    expect(manifest.limitations.join(' ')).toMatch(/native/)
    expect(Object.isFrozen(manifest.reservedIds)).toBe(true)
    expect(Object.values(manifest.reservedIds).every(id=>!fixture.allocatedIds.includes(id))).toBe(true)
  })

  it('proves full expected postimages and retains the entire baseline on rollback', () => {
    for (const token of ['owner_reorder_graph', 'owner_reorder_baseline', '__bulk_tests', '__nontarget_fingerprints',
      'test_attempt_history', 'managed_storage_settings', 'expected_graph', 'changed_count',
      'pg_catalog.transaction_timestamp()', 'Reorder full effect graph differs', 'Reorder final fixture differs',
    ]) expect(sql).toContain(token)
    expect(sql).not.toContain('setval')
    expect(manifest.expectedResult).toEqual({ version: 1, checks: [...manifest.checkLabels].sort(), rolledBack: true })
  })

  it('verifies target and accepted manifest before opening and always closes its exact session', async () => {
    const sealed = target(); let calls = 0; let closed = 0
    const driver: DraftSaveDriver = { verifyTarget: async () => sealed, openSession: async name => ({ name,
      execute: async (statement, timeout) => {
        const batch = manifest.contracts[calls++]
        expect(statement).toBe(batch.sql); expect(timeout).toBe(35000)
        return [{ result: batch.expectedResult }]
      }, rollbackAndClose: async timeout => { expect(timeout).toBe(12000); closed++ },
    }) }
    await expect(runTestOwnerReorderDbContracts(manifest, sealed, driver,Date.now()+315000)).resolves.toMatchObject({ kind: 'rollback-test-owner-reorder-contracts', checks: manifest.expectedResult.checks })
    expect(calls).toBe(9); expect(closed).toBe(1)
  })

  it('closes on execution, target drift, acknowledgement and session-name failures', async () => {
    for (const fault of ['execute', 'target', 'ack', 'name']) {
      const sealed = target(); let verifies = 0; let opened = 0; let closed = 0
      const driver: DraftSaveDriver = {
        verifyTarget: async () => { verifies++; return fault === 'target' && verifies > 1 ? Object.freeze({ ...sealed, containerId: 'f'.repeat(64) }) : sealed },
        openSession: async name => { opened++; return { name: fault === 'name' ? 'other' : name,
          execute: async () => { if (fault === 'execute') throw new Error('synthetic'); return [{ result: {} }] },
          rollbackAndClose: async () => { closed++ },
        } },
      }
      await expect(runTestOwnerReorderDbContracts(manifest, sealed, driver,Date.now()+315000)).rejects.toThrow()
      expect(opened).toBe(1); expect(closed).toBe(1)
    }
  })

  it('rejects a cloned or changed source manifest and hosted target before any session', async () => {
    for (const invalid of [Object.freeze({ ...manifest, sourceSha256: 'd'.repeat(64) }), Object.freeze({ ...manifest, contracts: [] })]) {
      let opened = 0; const sealed = target()
      const driver: DraftSaveDriver = { verifyTarget: async () => sealed, openSession: async () => { opened++; throw new Error('opened') } }
      await expect(runTestOwnerReorderDbContracts(invalid as typeof manifest, sealed, driver,Date.now()+315000)).rejects.toThrow()
      expect(opened).toBe(0)
    }
    const sealed = Object.freeze({ ...target(), databasePort: 54322 }); let opened = 0
    const driver: DraftSaveDriver = { verifyTarget: async () => sealed, openSession: async () => { opened++; throw new Error('opened') } }
    await expect(runTestOwnerReorderDbContracts(manifest, sealed, driver,Date.now()+315000)).rejects.toThrow()
    expect(opened).toBe(0)
  })

  it('caps dispatch to the same remaining deadline and rejects oversized actual responses', async () => {
    const sealed=target();const clock=vi.spyOn(Date,'now').mockReturnValue(1000000);let closed=0;let calls=0
    try {
      const driver:DraftSaveDriver={verifyTarget:async()=>sealed,openSession:async name=>({name,
        execute:async(_sql,timeout)=>{expect(timeout).toBe(100);calls++;clock.mockReturnValue(1000100);return[{result:manifest.contracts[0].expectedResult}]},
        rollbackAndClose:async()=>{closed++}})}
      await expect(runTestOwnerReorderDbContracts(manifest,sealed,driver,1000100)).rejects.toThrow('deadline elapsed')
      expect(calls).toBe(1);expect(closed).toBe(1)
      clock.mockReturnValue(1000000);closed=0
      const huge:DraftSaveDriver={verifyTarget:async()=>sealed,openSession:async name=>({name,
        execute:async()=>[{result:manifest.contracts[0].expectedResult,extra:'x'.repeat(1048576)}],rollbackAndClose:async()=>{closed++}})}
      await expect(runTestOwnerReorderDbContracts(manifest,sealed,huge,1000100)).rejects.toThrow('response byte limit')
      expect(closed).toBe(1)
    } finally {clock.mockRestore()}
  })
})
