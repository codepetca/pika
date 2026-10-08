import { describe, expect, it } from 'vitest'
import assert from 'node:assert/strict'
import { AssignmentListLifecycleError } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { testOwnerPublicationSetupDiagnostic } from '../../scripts/check-contextual-test-owner-publication-lifecycle'

function assertion(message: string, frames: string, deadline = false) {
  const error = new assert.AssertionError(deadline ? { message, actual: false, expected: true, operator: '==' }
    : { message, actual: 'private-source-row', expected: 'private-expected-row', operator: 'deepStrictEqual' })
  error.stack = `AssertionError [ERR_ASSERTION]: ${error.message}\n${frames}`
  return error
}
const wrap = (error: Error) => new AssignmentListLifecycleError({ stage: 'cases', error }, [])

describe('closed publication assertion failure diagnostics', () => {
  it('reports only a fixed source filename and bounded coordinate, not raw assertion values or paths', () => {
    const line = testOwnerPublicationSetupDiagnostic('complete', wrap(assertion('private assertion rows',
      '    at run (/private/identity/scripts/check-contextual-test-publication-concurrency.ts:145:221)')))
    expect(line).toContain('failure=assertion location=check-contextual-test-publication-concurrency.ts:145:221 reason=unknown.')
    for (const secret of ['private assertion rows', 'private-source-row', 'private-expected-row', '/private/identity']) expect(line).not.toContain(secret)
  })
  it.each([
    ['Publication contention deadline exhausted', 'contention-deadline'],
    ['Publication race deadline exhausted', 'shared-race-deadline'],
    ['Committed publication deadline exhausted', 'committed-deadline'],
  ])('maps only the exact fixed assertion message %s', (message, label) => {
    expect(testOwnerPublicationSetupDiagnostic('complete', wrap(assertion(message, '', true)))).toContain(`location=unknown reason=${label}.`)
    expect(testOwnerPublicationSetupDiagnostic('complete', wrap(assertion(`${message}: private row`, '', true)))).toContain('reason=unknown.')
    expect(testOwnerPublicationSetupDiagnostic('complete', new Error(message))).toContain('failure=unknown location=unknown reason=unknown.')
  })
  it.each([
    '    at x (/private/identity/scripts/foreign-secret.ts:145:221)',
    '    at x (/private/identity/scripts/check-contextual-test-publication-concurrency.ts:123456:221)',
    '    at x (/private/identity/scripts/check-contextual-test-publication-concurrency.ts:0:221)',
    '    at x (/private/identity/scripts/check-contextual-test-publication-concurrency.ts:145:123456)',
    '    at x (/private/identity/scripts/check-contextual-test-publication-concurrency.ts:145:221) private row',
  ])('keeps unsupported or unbounded stack frames unknown', frame => {
    const line = testOwnerPublicationSetupDiagnostic('complete', wrap(assertion('private row', frame)))
    expect(line).toContain('location=unknown reason=unknown.')
    expect(line).not.toContain('private row')
  })
  it('bounds the inspected stack tail and keeps ordinary non-assertion errors unknown', () => {
    const frame = '    at x (/private/identity/scripts/check-contextual-test-publication-concurrency.ts:145:221)'
    expect(testOwnerPublicationSetupDiagnostic('complete', wrap(assertion('private row', `${frame}\n${'x'.repeat(5000)}`)))).toContain('location=unknown')
    expect(testOwnerPublicationSetupDiagnostic('complete', wrap(assertion('private row', `${'x'.repeat(5000)}\n${frame}`)))).toContain('location=check-contextual-test-publication-concurrency.ts:145:221')
    const ordinary = new Error('private SQL row'); ordinary.stack = frame
    expect(testOwnerPublicationSetupDiagnostic('complete', wrap(ordinary))).toContain('failure=unknown location=unknown reason=unknown.')
  })
  it('does not mistake assertion values for stack frames and rejects unknown stack formats', () => {
    const forged = '    at x (/private/identity/scripts/check-contextual-test-publication-concurrency.ts:19:21)'
    const actual = '    at x (/private/identity/scripts/check-contextual-test-publication-concurrency.ts:142:68)'
    const error = assertion(`private rows\n${forged}`, actual)
    expect(testOwnerPublicationSetupDiagnostic('complete', wrap(error))).toContain('location=check-contextual-test-publication-concurrency.ts:142:68 reason=unknown.')
    error.stack = forged
    expect(testOwnerPublicationSetupDiagnostic('complete', wrap(error))).toContain('location=unknown reason=unknown.')
  })
})
