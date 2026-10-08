import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerReorderFixture } from '../../scripts/contextual-test-reorder-proof-fixture'
import {
  TEST_OWNER_REORDER_SOURCE_SHA256, TEST_OWNER_REORDER_DB_CAPS, TEST_OWNER_REORDER_TEST_COLUMNS, TEST_OWNER_REORDER_BULK_FAILURE_CODES,
  TEST_OWNER_REORDER_DEADLINE_PHASE_CODES,
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
  it('places fixed INFO progress only inside the existing bulk and verified calibration frames', () => {
    const marker = (code: string) => `raise info using errcode='${code}',message='Reorder proof checkpoint';`
    const bulk = manifest.contracts.find(batch => batch.name === 'bulk-1000')!.sql
    const calibration = manifest.contracts.find(batch => batch.expectedResult.checks.includes('deadline-reached'))!.sql
    for (const code of ['PRG01', 'PRG02', 'PRG03', 'PRG04']) {
      expect(bulk.split(marker(code))).toHaveLength(2)
      expect(manifest.contracts.filter(batch => batch.sql.includes(marker(code))).map(batch => batch.name)).toEqual(['bulk-1000'])
    }
    expect(bulk.indexOf(marker('PRG01'))).toBeLessThan(bulk.indexOf('create temp table owner_reorder_checks'))
    expect(bulk).toContain(`${marker('PRG02')}r:=public.reorder_tests_for_owner_v1`)
    expect(bulk.indexOf(marker('PRG03'))).toBeLessThan(bulk.indexOf("exception when sqlstate 'PT503'"))
    expect(bulk).toContain(`insert into pg_temp.owner_reorder_checks values('final-fixture-equality');${marker('PRG04')}end;$final$;`)
    expect(calibration).toContain(`raise exception 'Deadline classifier calibration differs';end if;${marker('PRG00')}end;end;`)
    expect(manifest.contracts.filter(batch => batch.sql.includes(marker('PRG00')))).toHaveLength(1)
    expect(bulk.match(/pg_temp\.owner_reorder_graph\(\)/g)).toHaveLength(6) // Definition plus five whole graph calls.
  })
  it('reports only fixed bulk-capacity SQL failures without weakening the success probe', () => {
    expect(TEST_OWNER_REORDER_BULK_FAILURE_CODES).toEqual({
      PRD01: 'test_reorder_deadline', PRD02: 'test_reorder_source_limit',
      PRD03: 'test_reorder_catalog_changed', PRD04: 'test_reorder_invalid_source',
      PRD05: 'test_reorder_revision_limit', PRD06: 'test_reorder_postcondition_failed',
      PRD07: 'test_reorder_result_limit',
    })
    expect(Object.isFrozen(TEST_OWNER_REORDER_BULK_FAILURE_CODES)).toBe(true)
    const bulk = manifest.contracts.find(batch => batch.name === 'bulk-1000')!
    for (const [code, message] of Object.entries(TEST_OWNER_REORDER_BULK_FAILURE_CODES).filter(([code]) => code !== 'PRD01')) {
      expect(bulk.sql).toContain(`when '${message}' then raise exception using errcode='${code}',message='Reorder bulk-capacity proof failed';`)
    }
    expect(bulk.sql).toContain("exception when sqlstate 'PT503' then case sqlerrm")
    expect(bulk.sql).toContain('else raise;end case;end;')
    expect(bulk.sql).toContain('Reorder exact witness differs')
    expect(bulk.sql).toContain('Reorder full effect graph differs')
    expect(bulk.sql).toContain("clock_timestamp()+interval '8 seconds'")
    expect(manifest.contracts.filter(batch => batch.sql.includes('Reorder bulk-capacity proof failed')).map(batch => batch.name)).toEqual(['bulk-1000'])
  })
  it('classifies only bounded first-frame deadline checkpoints and calibrates the unchanged expired-deadline probe', () => {
    expect(TEST_OWNER_REORDER_DEADLINE_PHASE_CODES).toEqual({
      PRD11: 50, PRD12: 121, PRD13: 212, PRD14: 229, PRD15: 288, PRD16: 298,
    })
    expect(Object.isFrozen(TEST_OWNER_REORDER_DEADLINE_PHASE_CODES)).toBe(true)
    const source = readFileSync('supabase/migrations/254_contextual_test_owner_reorder.sql', 'utf8')
    const body = source.split('as $function$')[1].split('$function$')[0]
    expect(body.split('\n').flatMap((line, index) => line.includes("message = 'test_reorder_deadline'") ? [index+1] : []))
      .toEqual(Object.values(TEST_OWNER_REORDER_DEADLINE_PHASE_CODES))
    const bulk = manifest.contracts.find(batch => batch.name === 'bulk-1000')!.sql
    expect(bulk).toContain('get stacked diagnostics deadline_context=pg_exception_context;')
    expect(bulk).toContain('pg_catalog.octet_length(deadline_context)<=8192')
    expect(bulk).toContain("pg_catalog.split_part(deadline_context,E'\\n',1)")
    for (const [code, line] of Object.entries(TEST_OWNER_REORDER_DEADLINE_PHASE_CODES)) {
      for (const schema of ['', 'public.']) {
        expect(bulk).toContain(`when 'PL/pgSQL function ${schema}reorder_tests_for_owner_v1(uuid,uuid,uuid[],timestamp with time zone) line ${line} at RAISE' then '${code}'`)
      }
    }
    expect(bulk).toContain("else 'PRD01' end else 'PRD01' end")
    expect(bulk).toContain("deadline_context:=null;raise exception using errcode=deadline_code,message='Reorder bulk-capacity proof failed';")
    const calibration = manifest.contracts.find(batch => batch.expectedResult.checks.includes('deadline-reached'))!.sql
    expect(calibration).toContain("clock_timestamp()-interval '1 millisecond'")
    expect(calibration).toContain("if deadline_code is distinct from 'PRD11' then")
    expect(calibration).toContain('Deadline classifier calibration differs')
    expect(calibration).toContain('Deadline classifier rejection differs')
    for (const rejected of ['private.reorder_tests_for_owner_v1', 'line 51 at RAISE', 'line 50 at PERFORM', 'forged prefix',
      'uuid,uuid,text[]', 'foreign frame', 'trailing private data', 'line 050']) {
      expect(calibration).toContain(rejected)
    }
    expect(calibration).toContain("repeat('x',8193)")
    expect(bulk).not.toMatch(/raise (?:notice|warning)|message\s*=\s*deadline_context|detail\s*=|hint\s*=/i)
  })
  it('pins the exact source and emits finite frozen rollback batches', () => {
    expect(TEST_OWNER_REORDER_SOURCE_SHA256).toBe('7439de12a4c0721d52f529180b545e8076bd5d9a8884b2efb2c2f04f522b5eea')
    expect(digest(readFileSync('supabase/migrations/254_contextual_test_owner_reorder.sql', 'utf8'))).toBe(TEST_OWNER_REORDER_SOURCE_SHA256)
    expect(TEST_OWNER_REORDER_DB_CAPS).toEqual({ sqlBytes: 262144, responseBytes: 1048576, actionMs: 35000, requestMs: 12000,
      logicalGroups: 9, batches: 28, probesPerBatch: 2 })
    expect(manifest.contracts).toHaveLength(28)
    for (const batch of manifest.contracts) {
      expect(Object.isFrozen(batch)).toBe(true)
      expect(Buffer.byteLength(batch.sql)).toBeLessThanOrEqual(262144)
      expect(batch.sql.trimStart()).toMatch(/^begin;/)
      expect(batch.sql.trimEnd()).toMatch(/rollback;$/)
      expect(batch.sql.match(/\bas result\b/g)).toHaveLength(1)
      expect(batch.sql).not.toMatch(/\bcommit\s*;|setval\s*\(|truncate\s|reset\s+.*sequence/i)
    }
    expect(Object.isFrozen(manifest)).toBe(true)
    expect(manifest.sourceFile).toBe('254_contextual_test_owner_reorder.sql')
  })

  it('splits all nine logical groups into complete sealed rollback frames without losing probes', () => {
    const expectedGroups = {
      catalog: 1, 'authority-effects': 13, 'input-membership': 6, bounds: 8,
      'lifecycle-guards': 8, 'injected-faults': 9, 'bulk-999': 2, 'bulk-1000': 1, 'bulk-1001': 3,
    }
    const labels: string[] = []
    for (const [group, count] of Object.entries(expectedGroups)) {
      const chunks = manifest.contracts.filter(batch => batch.logicalGroup === group)
      expect(chunks).toHaveLength(Math.ceil(count / 2))
      let probes = 0
      chunks.forEach((chunk, index) => {
        expect(chunk.name).toBe(count <= 2 ? group : `${group}-${index + 1}`)
        const batchLabels = chunk.expectedResult.checks.filter(label => label !== 'final-fixture-equality')
        expect(batchLabels.length).toBeGreaterThan(0)
        expect(batchLabels.length).toBeLessThanOrEqual(2)
        expect(chunk.sql.match(/do \$probe\$/g)).toHaveLength(batchLabels.length)
        expect(chunk.sql).toContain("set local statement_timeout='35s'")
        expect(chunk.sql).toContain('Reorder final fixture differs')
        expect(chunk.sql).toContain('Rollback graph differs')
        expect(chunk.sql).toContain('create temp table owner_reorder_baseline')
        probes += batchLabels.length
        labels.push(...batchLabels)
      })
      expect(probes).toBe(count)
    }
    expect(labels).toHaveLength(51)
    expect(new Set(labels).size).toBe(51)
    expect(labels.sort()).toEqual([...manifest.checkLabels].sort())
  })

  it('seals exact columns, all14 triggers, column qualifiers and reachable routine source', () => {
    expect(TEST_OWNER_REORDER_TEST_COLUMNS).toHaveLength(21)
    for (const token of ['prosecdef', 'search_path=""', 'lock_timeout=1s', 'pg_catalog.aclexplode',
      'update_tests_updated_at', 'tgattr', 'tgqual', 'tgargs', 'tgenabled', 'tgdeferrable', 'tginitdeferred',
      'Exact14 Test trigger closure differs', 'Reachable routine source differs', 'pg_catalog.md5(proc.prosrc)',
      'resolve_classroom_archive_resource_classroom_id(text,uuid)', 'bump_classroom_archive_revision_from_resource()',
      'touch_classroom_blueprint_source_revision()', 'private.try_lock_classroom_membership_change(uuid,uuid)',
      'public.bump_classroom_blueprint_source_revision()', 'public.update_updated_at_column()',
    ]) expect(sql).toContain(token)
    expect(manifest.reachableFunctions).toHaveLength(23)
    expect(manifest.reachableFunctions.some(routine => routine.signature === 'public.create_archived_classroom_blueprint_atomic(uuid,uuid,text,uuid,bigint,jsonb)')).toBe(true)
    expect(manifest.reachableFunctions.every(routine=>routine.sourceSha256.length===64&&routine.prosrcMd5.length===32)).toBe(true)
    expect(sql).toContain("'gradebook_maximum_override'")
  })

  it('uses the trigger-aware deparser without converting failed qualified extraction to empty', () => {
    const quota = manifest.reachableFunctions.find(r => r.signature === 'private.enforce_classroom_test_quota_v1()')!
    expect(quota.sourceFile).toBe('253_classroom_test_tier_caps.sql')
    expect(quota).toMatchObject({ language: 'plpgsql', securityDefiner: true, volatility: 'v', proconfig: ['search_path=""'] })
    expect(sql).toContain("'enforce_classroom_test_quota','private','enforce_classroom_test_quota_v1',23,array['classroom_id']::text[]")
    expect(sql).toContain('Dormant quota setting differs')
    const catalog = manifest.contracts[0]
    expect(catalog.name).toBe('catalog')
    expect(catalog.sql).not.toContain('pg_get_expr(t.tgqual')
    expect(catalog.sql.match(/pg_catalog\.pg_get_triggerdef\(t\.oid,false\)/g)).toHaveLength(2)
    expect(catalog.sql).toContain("case when t.tgqual is null then '' else")
    expect(catalog.sql).toContain("pg_catalog.substring(pg_catalog.pg_get_triggerdef(t.oid,false),' WHEN [(](.*)[)] EXECUTE FUNCTION ') end")
    expect(catalog.sql).not.toMatch(/coalesce\(\s*(?:case when t\.tgqual|pg_catalog\.substring\(pg_catalog\.pg_get_triggerdef)/)
    // Both EXCEPT directions remain required: a NULL extraction for a non-null
    // qualifier differs from each source-bound, non-null expected qualifier.
    expect(catalog.sql).toMatch(/if exists\(\(select t\.tgname/)
    expect(catalog.sql).toMatch(/or exists\(\(select \* from \(values/)
  })

  it('checks the fixed extraction pattern against realistic nonpretty trigger definitions (inert, not PostgreSQL proof)', () => {
    const pattern = /pg_catalog\.substring\(pg_catalog\.pg_get_triggerdef\(t\.oid,false\),'([^']+)'\)/.exec(manifest.contracts[0].sql)?.[1]
    expect(pattern).toBe(' WHEN [(](.*)[)] EXECUTE FUNCTION ')
    // This fixed pattern uses only the common ASCII regexp subset. The test
    // checks emitted delimiters/normalization; it does not execute SQL.
    const extract = (definition: string, hasQualifier = true) => {
      if (!hasQualifier) return ''
      const value = new RegExp(pattern!).exec(definition)?.[1]
      return value === undefined ? null : value.replaceAll('::text', '').replaceAll('"', '').replace(/[()\s]/g, '').toLowerCase()
    }
    const columns = ['title', 'show_results', 'documents', 'position', 'points_possible', 'include_in_final', 'gradebook_weight', 'artifact_id', 'source_artifact_id']
    const predicate = columns.map(column => `(old.${column} IS DISTINCT FROM new.${column})`).join(' OR ')
    const oldNew = `CREATE TRIGGER touch_classroom_blueprint_source_from_tests_update AFTER UPDATE OF ${columns.join(', ')} ON public.tests FOR EACH ROW WHEN ((${predicate})) EXECUTE FUNCTION public.touch_classroom_blueprint_source_revision()`
    expect(extract(oldNew)).toBe(columns.map(column => `old.${column}isdistinctfromnew.${column}`).join('or'))
    const setting = "CREATE TRIGGER enqueue_obsolete_test_document_snapshots AFTER DELETE OR UPDATE OF documents ON public.tests FOR EACH ROW WHEN ((current_setting('pika.classroom_purge_finalize'::text, true) IS DISTINCT FROM 'on'::text)) EXECUTE FUNCTION public.enqueue_obsolete_test_document_snapshots()"
    expect(extract(setting)).toBe("current_setting'pika.classroom_purge_finalize',trueisdistinctfrom'on'")
    const unqualified = 'CREATE TRIGGER update_tests_updated_at BEFORE UPDATE ON public.tests FOR EACH ROW EXECUTE FUNCTION public.update_tests_updated_at()'
    expect(extract(unqualified, false)).toBe('')
    // A present qualifier without the exact supported boundary remains NULL,
    // not the empty string used exclusively for catalog tgqual IS NULL.
    for (const malformed of [unqualified, oldNew.replace(/ WHEN [(]+/, ' WHEN '),
      oldNew.replace(/[)]+ EXECUTE FUNCTION /, ' EXECUTE FUNCTION '), oldNew.replace('EXECUTE FUNCTION', 'EXECUTE PROCEDURE'),
      oldNew.replace(') EXECUTE FUNCTION ', ') EXECUTE  FUNCTION ')]) {
      expect(extract(malformed)).toBeNull()
    }
    expect(extract(oldNew.replace('old.title IS DISTINCT FROM new.title', 'old.title IS NOT DISTINCT FROM new.title'))).not.toBe(extract(oldNew))
  })

  it('prepares all role, membership, boundary and fault checks without claiming execution', () => {
    for (const label of ['teacher-owner', 'student-owner', 'teacher-noop', 'empty-owner',
      'member-denied', 'teacher-member-denied', 'historical-creator-denied', 'archived-owner-denied',
      'partial-membership', 'superset-membership', 'foreign-membership', 'duplicate-membership', 'null-array', 'null-member',
      'bulk-999', 'bulk-1000', 'source-1001-limit', 'source-1001-noop', 'full-1001-input', 'row-byte-limit', 'state-byte-limit',
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
    expect(calls).toBe(28); expect(closed).toBe(1)
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

  it('stops at the first catalog dispatch and closes once on a deparser rejection', async () => {
    const sealed = target(); let calls = 0; let closed = 0
    const driver: DraftSaveDriver = { verifyTarget: async () => sealed, openSession: async name => ({ name,
      execute: async statement => {
        calls++; expect(statement).toBe(manifest.contracts[0].sql)
        throw Object.assign(new Error('Synthetic catalog rejection'), { code: '22023' })
      }, rollbackAndClose: async timeout => { expect(timeout).toBe(12000); closed++ },
    }) }
    await expect(runTestOwnerReorderDbContracts(manifest, sealed, driver, Date.now() + 315000)).rejects.toMatchObject({ code: '22023' })
    expect(calls).toBe(1); expect(closed).toBe(1)
  })

  it('stops and closes immediately when a later sealed rollback frame fails', async () => {
    const sealed = target(); let calls = 0; let closed = 0
    const driver: DraftSaveDriver = { verifyTarget: async () => sealed, openSession: async name => ({ name,
      execute: async statement => {
        const batch = manifest.contracts[calls++]
        expect(statement).toBe(batch.sql)
        if (calls === 10) throw new Error('Synthetic later frame timeout')
        return [{ result: batch.expectedResult }]
      }, rollbackAndClose: async () => { closed++ },
    }) }
    await expect(runTestOwnerReorderDbContracts(manifest, sealed, driver, Date.now() + 315000))
      .rejects.toThrow('Synthetic later frame timeout')
    expect(calls).toBe(10); expect(closed).toBe(1)
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
