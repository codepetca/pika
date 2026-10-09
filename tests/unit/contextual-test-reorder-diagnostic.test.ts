import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { assertTestOwnerReorderDiagnosticAvailable, TEST_OWNER_REORDER_HISTORICAL_DIAGNOSTIC_SOURCE_SHA256,
  buildTestOwnerReorderDiagnosticManifest, captureTestOwnerReorderTimings, validateTestOwnerReorderDiagnosticSql,
  validateTestOwnerReorderDiagnosticMeasurement } from '../../scripts/contextual-test-reorder-diagnostic'
import { buildTestOwnerReorderDiagnosticNativeManifest, createTestOwnerReorderDiagnosticNativeContracts } from '../../scripts/contextual-test-draft-save-native-contracts'
import { testOwnerReorderDiagnosticLifecycleMain } from '../../scripts/check-contextual-test-owner-reorder-lifecycle'

describe('retired historical 10000-Test diagnostic', () => {
  it('refuses every execution entrypoint before reading arguments or creating fixtures/native work', async () => {
    const touched = vi.fn(() => { throw Error('Must not access retired input') })
    const hostile = new Proxy({}, { get: touched }) as never
    expect(() => assertTestOwnerReorderDiagnosticAvailable()).toThrow('10000-Test reorder diagnostic retired')
    expect(() => buildTestOwnerReorderDiagnosticManifest(hostile, '/unreadable')).toThrow('10000-Test reorder diagnostic retired')
    expect(() => buildTestOwnerReorderDiagnosticNativeManifest(hostile, hostile, '', '/unreadable')).toThrow('10000-Test reorder diagnostic retired')
    expect(() => createTestOwnerReorderDiagnosticNativeContracts(hostile)).toThrow('10000-Test reorder diagnostic retired')
    await expect(testOwnerReorderDiagnosticLifecycleMain([])).rejects.toThrow('10000-Test reorder diagnostic retired')
    expect(touched).not.toHaveBeenCalled()
    expect(validateTestOwnerReorderDiagnosticSql(hostile, 'select 1;')).toBe(false)
  })
  it('retains the original 10k diagnostic source, rollback/effect assertions and original unaccepted SHA', () => {
    expect(TEST_OWNER_REORDER_HISTORICAL_DIAGNOSTIC_SOURCE_SHA256).toBe('71ed984850fdcf7205ddf9245f4dfc89dc8102caf3dcee0772104eb0f0e94006')
    const source = readFileSync('scripts/contextual-test-reorder-diagnostic.ts', 'utf8')
    for (const guard of ["bulk-10000", "cardinality(ids)<>10000", "Diagnostic dense changes differ",
      "get diagnostics v_affected_count = row_count;", "witness/effect/rollback",
      "exception when ${codes.map", "10000::bigint"])
      expect(source.includes(guard)).toBe(true)
    expect(source.includes("sqlstate 'P0001'")).toBe(false)
  })
  it('retains strict historical numeric receipt validation without claiming current acceptance', () => {
    const timings = Object.freeze({ beforeWorkUs: 0, beforeUpdateUs: 123, afterUpdateUs: 456, valid: true })
    const measurement = Object.freeze({ candidatePlanSha256: 'b'.repeat(64), fixedNodeCounts: Object.freeze({ ModifyTable: 1 }),
      outcome: 'returned', sqlstate: 'none', timings })
    expect(() => validateTestOwnerReorderDiagnosticMeasurement(measurement)).not.toThrow()
    for (const patch of [{ timings: Object.freeze({ ...timings, afterUpdateUs: null }) },
      { timings: Object.freeze({ ...timings, afterUpdateUs: 122 }) }, { sqlstate: 'raw error' }, { rawPlan: {} }])
      expect(() => validateTestOwnerReorderDiagnosticMeasurement(Object.freeze({ ...measurement, ...patch }))).toThrow()
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
})
