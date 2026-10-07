import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerReorderFixture } from '../../scripts/contextual-test-reorder-proof-fixture'
import { testOwnerReorderDbContractsManifest } from '../../scripts/contextual-test-reorder-db-contracts'
import { buildTestOwnerReorderDiagnosticManifest, captureTestOwnerReorderTimings,
  validateTestOwnerReorderDiagnosticSql, runTestOwnerReorderDiagnostic, validateTestOwnerReorderDiagnosticMeasurement,
  validateTestOwnerReorderDiagnosticReceipt } from '../../scripts/contextual-test-reorder-diagnostic'
import { buildTestOwnerReorderDiagnosticNativeManifest, createTestOwnerReorderDiagnosticNativeContracts,
  buildTestOwnerReorderNativeContractsManifest, validateTestOwnerReorderNativeSql } from '../../scripts/contextual-test-draft-save-native-contracts'
import { testOwnerDigest } from '../../scripts/contextual-test-owner-detail-proof-fixture'

const original = newAssignmentListProofFixture(new Date('2026-10-07T03:00:00Z'))
const fixture = newTestOwnerReorderFixture(original)
const project = `pika_assignment_list_${fixture.tag.slice(-12)}`
const normal = testOwnerReorderDbContractsManifest(fixture, project, process.cwd())
const manifest = () => buildTestOwnerReorderDiagnosticManifest(normal, process.cwd())

describe('finite diagnostic-only reorder measurement', () => {
  it('pins two finite frames and retains the original sole UPDATE/body/assertions', () => {
    const m = manifest()
    expect(m.kind).toBe('test-owner-reorder-diagnostic-not-acceptance')
    expect(m.frames).toHaveLength(2)
    expect(Object.isFrozen(m.frames)).toBe(true)
    expect(m.frames[0].sql).toContain('EXPLAIN (FORMAT JSON)')
    expect(m.frames[0].sql).not.toMatch(/EXPLAIN\s*\([^)]*ANALYZE/i)
    const source = readFileSync('supabase/migrations/253_contextual_test_owner_reorder.sql', 'utf8')
    const body = source.slice(source.indexOf('declare\n'), source.indexOf('$function$;', source.indexOf('declare\n')))
    expect(m.originalBody).toBe(body)
    expect(m.copyBody.replace(/^  -- diagnostic observation\n  raise info[^\n]*\n/gm, '')).toBe(body)
    expect(m.frames[1].sql).toContain('create function pg_temp.reorder_tests_for_owner_diagnostic_v1')
    expect(m.frames[1].sql).toContain('Reorder full effect graph differs')
    expect(m.frames[1].sql).toContain('Reorder exact witness differs')
    expect(m.frames[1].sql).toContain('Rollback graph differs')
    expect(m.frames[1].sql).toContain('Reorder final fixture differs')
    expect(m.frames[1].sql).toContain('Diagnostic dense changes differ')
    expect(m.frames[1].sql).toContain('from public,anon,authenticated,service_role;')
    expect(m.frames[0].sql).toContain('Diagnostic plan graph differs')
    expect(m.copyBody.indexOf('get diagnostics v_affected_count = row_count;')).toBeLessThan(m.copyBody.indexOf("errcode='PDT03'"))
    expect(m.frames[1].sql).toContain("interval '8 seconds'")
    expect(m.frames[1].sql).toContain("interval '20 seconds'")
    expect(m.frames[1].sql).not.toMatch(/disable trigger|drop trigger|plan_cache_mode|track_functions|auto_explain/i)
  })
  it('admits exact issued diagnostic frames only, never arbitrary or altered SQL', () => {
    const m = manifest()
    for (const f of m.frames) {
      expect(validateTestOwnerReorderDiagnosticSql(m, f.sql)).toBe(true)
      expect(validateTestOwnerReorderDiagnosticSql(m, f.sql + 'select 1;')).toBe(false)
    }
    expect(validateTestOwnerReorderDiagnosticSql({ ...m }, m.frames[0].sql)).toBe(false)
    expect(validateTestOwnerReorderDiagnosticSql(m, normal.contracts[0].sql)).toBe(false)
    expect(validateTestOwnerReorderDiagnosticSql(m, 'select 1;')).toBe(false)
    const ordinary = buildTestOwnerReorderNativeContractsManifest(original, fixture, 'a'.repeat(40), process.cwd())
    for (const frame of m.frames) expect(validateTestOwnerReorderNativeSql(ordinary, frame.sql)).toBe(false)
    expect(() => buildTestOwnerReorderDiagnosticManifest(Object.freeze({ ...normal,
      contracts: [{ ...normal.contracts[0], name: 'bulk-10000', sql: 'delete from public.tests;' }] }), process.cwd())).toThrow()
  })
  it('captures only fixed RPC denials, never witness/effect/rollback assertion failures', () => {
    const sql = manifest().frames[1].sql
    const handler = sql.slice(sql.indexOf('do $measure$'), sql.indexOf('end;end;$measure$;'))
    expect(handler).not.toContain('exception when others then get stacked diagnostics code=returned_sqlstate')
    expect(handler).toContain("exception when sqlstate 'PT400' or sqlstate 'PT403'")
    expect(handler).not.toContain("sqlstate 'P0001'")
    for (const message of ['Reorder exact witness differs', 'Reorder full effect graph differs', 'Rollback graph differs'])
      expect(handler).toMatch(new RegExp(`raise exception '${message}`))
    expect(handler).toContain("insert into owner_reorder_diagnostic_outcome values('failed',code)")
  })
  it('requires strict frozen numeric-only receipts bound to the complete native manifest', () => {
    const native = buildTestOwnerReorderDiagnosticNativeManifest(original, fixture, 'a'.repeat(40), process.cwd())
    const timings = Object.freeze({ beforeWorkUs: 0, beforeUpdateUs: 123, afterUpdateUs: 456, valid: true })
    const measurement = Object.freeze({ candidatePlanSha256: 'b'.repeat(64), fixedNodeCounts: Object.freeze({ ModifyTable: 1 }), outcome: 'returned', sqlstate: 'none', timings })
    const receipt = Object.freeze({ kind: 'test-owner-reorder-diagnostic-not-acceptance', diagnosticOnly: true, measurement,
      fixtureUnchanged: true, manifestSha256: testOwnerDigest(JSON.stringify(native)), controls: 100, actions: 5, exchangeBytes: 1000, remainingSessions: 0 })
    expect(() => validateTestOwnerReorderDiagnosticReceipt(receipt, native)).not.toThrow()
    for (const patch of [{ remainingSessions: 1 }, { actions: 201 }, { controls: 4001 }, { exchangeBytes: 67108865 },
      { fixtureUnchanged: false }, { manifestSha256: 'f'.repeat(64) }, { privatePlan: {} }, { kind: 'normal-pass' }])
      expect(() => validateTestOwnerReorderDiagnosticReceipt(Object.freeze({ ...receipt, ...patch }), native)).toThrow()
    for (const patch of [{ timings: Object.freeze({ ...timings, afterUpdateUs: null }) },
      { timings: Object.freeze({ ...timings, afterUpdateUs: 122 }) }, { timings: Object.freeze({ ...timings, beforeWorkUs: null }) },
      { fixedNodeCounts: Object.freeze({ 'secret relation name': 1 }) }, { sqlstate: 'raw error' }, { rawPlan: {} }])
      expect(() => validateTestOwnerReorderDiagnosticMeasurement(Object.freeze({ ...measurement, ...patch }))).toThrow()
    const partial = Object.freeze({ ...measurement, outcome: 'failed', sqlstate: 'PRD01',
      timings: Object.freeze({ ...timings, beforeUpdateUs: null, afterUpdateUs: null }) })
    expect(() => validateTestOwnerReorderDiagnosticMeasurement(partial)).not.toThrow()
  })
  it('returns only a fixed plan digest/enum counts and one copy outcome without raw plan strings', async () => {
    const m = manifest()
    const target = Object.freeze({ projectId: project, containerProjectLabel: project, disposable: true as const,
      apiUrl: 'http://127.0.0.1:54331', databaseHost: '127.0.0.1', databasePort: 54332, containerId: 'b'.repeat(64),
      reviewedHead: 'a'.repeat(40), migrationManifestSha256: 'c'.repeat(64), reviewedSourceSha256: m.sourceSha256, acceptedManifestSha256: m.manifestSha256 })
    const execute = vi.fn().mockResolvedValueOnce([{ result: { kind: m.kind, plan: [{ Plan: {
      'Node Type': 'ModifyTable', 'Relation Name': 'private synthetic relation', Plans: [{ 'Node Type': 'Function Scan', Filter: 'private UUID' }],
    } }] } }]).mockResolvedValueOnce([{ result: { kind: m.kind, outcome: 'failed', sqlstate: 'PRD01', rolledBack: true, checks: ['final-fixture-equality'] } }])
    const session = { name: project + '_draft_contracts', execute, rollbackAndClose: vi.fn() }
    const result = await runTestOwnerReorderDiagnostic(m, target, { verifyTarget: vi.fn().mockResolvedValue(target), openSession: vi.fn().mockResolvedValue(session) }, Date.now() + 10000)
    expect(result.fixedNodeCounts).toEqual({ ModifyTable: 1, 'Function Scan': 1 })
    expect(result.outcome).toBe('failed'); expect(JSON.stringify(result)).not.toMatch(/private|UUID|Relation|Filter/)
    expect(execute).toHaveBeenCalledTimes(2); expect(execute.mock.calls.map(call => call[0])).toEqual(m.frames.map(frame => frame.sql))
    expect(session.rollbackAndClose).toHaveBeenCalledTimes(1)
  })
  it('exposes only the finite diagnostic factory and rejects premature run/expired clocks before native work', async () => {
    const native = buildTestOwnerReorderDiagnosticNativeManifest(original, fixture, 'a'.repeat(40), process.cwd())
    const input = { repository: process.cwd(), reviewedHead: 'a'.repeat(40), original, fixture,
      containerId: 'b'.repeat(64), capturedResources: [], acceptedManifestSha256: testOwnerDigest(JSON.stringify(native)), absoluteDeadline: Date.now() + 10000 }
    const facade = createTestOwnerReorderDiagnosticNativeContracts(input)
    expect(Object.keys(facade).sort()).toEqual(['diagnostic', 'manifest', 'runDiagnostic', 'setup', 'verifyTarget'])
    expect(facade.diagnostic()).toContain('test-owner-reorder-diagnostic native')
    await expect(facade.runDiagnostic()).rejects.toThrow()
    expect(facade.diagnostic()).toContain('beforeWorkUs=unknown')
    expect(() => createTestOwnerReorderDiagnosticNativeContracts({ ...input, absoluteDeadline: Date.now() - 1 })).toThrow()
  })
  it('captures ordered bounded integers across chunks and rejects malformed/repeated observations', () => {
    const p = captureTestOwnerReorderTimings(true)
    p.push('INFO: PDT01 0\nINFO: PDT02 12'); p.push('345\r\nINFO: PDT03 7000000\n')
    expect(p.snapshot()).toEqual({ beforeWorkUs: 0, beforeUpdateUs: 12345, afterUpdateUs: 7000000, valid: true })
    const scoped = captureTestOwnerReorderTimings(false); scoped.push('INFO: PDT01 0\n')
    expect(scoped.snapshot().beforeWorkUs).toBe(null)
    for (const input of ['INFO: PDT02 1\n', 'INFO: PDT01 -1\n', 'INFO: PDT01 0 private\n',
      'INFO: PDT01 0\nINFO: PDT01 0\n', 'INFO: PDT01 0\nINFO: PDT02 35000001\n',
      'INFO: PDT01 0\nINFO: PDT02 01\n', 'INFO: PDT01 0\nINFO: PDT02 -1\n', 'x'.repeat(129)]) {
      const bad = captureTestOwnerReorderTimings(true); bad.push(input)
      expect(bad.snapshot().valid).toBe(false)
      expect(JSON.stringify(bad.snapshot())).not.toMatch(/private|PDT/)
    }
  })
  it('normalizes private absolute backend clocks and preserves immutable partial observations', () => {
    const p = captureTestOwnerReorderTimings(true)
    p.push('INFO: unrelated bounded diagnostic\nINFO: PDT01 1791392400000000\nINFO: PDT02 1791392401234567\n')
    const partial = p.snapshot()
    expect(partial).toEqual({ beforeWorkUs: 0, beforeUpdateUs: 1234567, afterUpdateUs: null, valid: true })
    expect(Object.isFrozen(partial)).toBe(true)
    p.push('INFO: PDT03 1791392401234566\n')
    expect(p.snapshot().valid).toBe(false)
    expect(p.snapshot().beforeUpdateUs).toBe(1234567)
    expect(partial.valid).toBe(true)
    expect(JSON.stringify(partial)).not.toContain('179139240')
    const fragment = captureTestOwnerReorderTimings(true); fragment.push('INFO: PDT01 100')
    expect(fragment.snapshot().beforeWorkUs).toBe(null)
  })
  it('rejects malformed private plan/outcome replies and runs each frame once within the existing deadline', async () => {
    const m = manifest(); const execute = vi.fn().mockResolvedValue([{ result: {} }])
    const session = { name: project + '_draft_contracts', execute, rollbackAndClose: vi.fn() }
    const target = Object.freeze({ projectId: project, containerProjectLabel: project, disposable: true as const,
      apiUrl: 'http://127.0.0.1:54331', databaseHost: '127.0.0.1', databasePort: 54332, containerId: 'b'.repeat(64),
      reviewedHead: 'a'.repeat(40), migrationManifestSha256: 'c'.repeat(64), reviewedSourceSha256: m.sourceSha256,
      acceptedManifestSha256: m.manifestSha256 })
    const driver = { verifyTarget: vi.fn().mockResolvedValue(target), openSession: vi.fn().mockResolvedValue(session) }
    await expect(runTestOwnerReorderDiagnostic(m, target, driver, Date.now() + 10000)).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(session.rollbackAndClose).toHaveBeenCalledTimes(1)
    await expect(runTestOwnerReorderDiagnostic(m, target, driver, Date.now() - 1)).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it.each(['exact witness', 'full effect graph', 'rollback graph'])('rejects %s failure with no measurement and closes the owned session', async label => {
    const m = manifest()
    const target = Object.freeze({ projectId: project, containerProjectLabel: project, disposable: true as const,
      apiUrl: 'http://127.0.0.1:54331', databaseHost: '127.0.0.1', databasePort: 54332, containerId: 'b'.repeat(64),
      reviewedHead: 'a'.repeat(40), migrationManifestSha256: 'c'.repeat(64), reviewedSourceSha256: m.sourceSha256,
      acceptedManifestSha256: m.manifestSha256 })
    const assertion = Object.assign(new Error(`private ${label} assertion`), { code: 'P0001' })
    const execute = vi.fn().mockResolvedValueOnce([{ result: { kind: m.kind, plan: [{ Plan: { 'Node Type': 'ModifyTable' } }] } }])
      .mockRejectedValueOnce(assertion)
    const session = { name: project + '_draft_contracts', execute, rollbackAndClose: vi.fn() }
    await expect(runTestOwnerReorderDiagnostic(m, target, { verifyTarget: vi.fn().mockResolvedValue(target), openSession: vi.fn().mockResolvedValue(session) }, Date.now() + 10000)).rejects.toBe(assertion)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(session.rollbackAndClose).toHaveBeenCalledTimes(1)
  })
})
