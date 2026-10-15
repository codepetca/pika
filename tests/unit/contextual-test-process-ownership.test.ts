import { describe, expect, it, vi } from 'vitest'
import { contextualTestIdentityMismatch, reconcileOwnedFamily, type Capture, type OwnedProcessRow } from '../../scripts/contextual-test-process-ownership'

const identity = { pid: 101, pgid: 101, started: '1234567:123456', executable: '/PRIVATE-SENTINEL/node', cwd: '/PRIVATE-SENTINEL', role: 'browser' as const }
const capture: Capture = { identity, descendants: [{ ...identity, pid: 102 }] }
function mismatch(rows: OwnedProcessRow[]): unknown {
  try { reconcileOwnedFamily(capture, rows); throw Error('Expected mismatch') } catch (error) { return error }
}
describe('fixed private process identity mismatch metadata', () => {
  it.each(['root','descendant'] as const)('records each comparison for %s with no identity values', member => {
    const original = member === 'root' ? identity : capture.descendants[0]
    for (const field of ['started','pgid','executable','all'] as const) {
      const observed = { ...original, ppid: 101, state: 'alive' as const,
        ...(field === 'started' || field === 'all' ? { started: '9999999:654321' } : {}),
        ...(field === 'pgid' || field === 'all' ? { pgid: 87654321 } : {}),
        ...(field === 'executable' || field === 'all' ? { executable: '/SECRET/other' } : {}) }
      const error = mismatch([observed])
      expect(error).toMatchObject({ processCause: 'identity-mismatch', message: 'Owned process verification rejected' })
      const diagnostic = contextualTestIdentityMismatch(error)
      expect(diagnostic).toEqual({ member, state: 'alive', startTimeChanged: field === 'started' || field === 'all',
        pgidChanged: field === 'pgid' || field === 'all', executableChanged: field === 'executable' || field === 'all' })
      expect(Object.isFrozen(diagnostic)).toBe(true)
      expect(JSON.stringify(diagnostic)).not.toMatch(/1234567|9999999|87654321|PRIVATE|SECRET|pid|cwd|started/)
    }
  })
  it.each(['zombie','exiting'] as const)('preserves %s empty-executable exception and exposes only actual mismatches', state => {
    const observed = { ...identity, ppid: 1, state, executable: '' }
    expect(() => reconcileOwnedFamily(capture, [observed])).not.toThrow()
    expect(contextualTestIdentityMismatch(mismatch([{ ...observed, started: '999:1' }]))).toEqual({ member: 'root', state,
      startTimeChanged: true, pgidChanged: false, executableChanged: false })
    expect(contextualTestIdentityMismatch(mismatch([{ ...observed, executable: '/other' }]))?.executableChanged).toBe(true)
  })
  it('uses unknown for absent state and retains the kernel-unverified rejection priority', () => {
    expect(contextualTestIdentityMismatch(mismatch([{ ...identity, ppid: 1, pgid: 999 }]))?.state).toBe('unknown')
    const error = mismatch([{ ...identity, ppid: 1, pgid: 999, state: 'unverified' }])
    expect(error).toMatchObject({ processCause: 'kernel-unverified' }); expect(contextualTestIdentityMismatch(error)).toBeNull()
  })
  it('never trusts copied error fields, inherited data, getters or proxies', () => {
    const trap = vi.fn(() => { throw Error('SECRET') })
    const real = mismatch([{ ...identity, ppid: 1, pgid: 999 }]) as Error
    for (const error of [null, 'SECRET', {}, { ...real }, Object.create(real),
      Object.defineProperty({}, 'identityMismatch', { get: trap }),
      new Proxy(real, { get: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap }),
      { processCause: 'identity-mismatch', identityMismatch: contextualTestIdentityMismatch(real) }]) {
      expect(contextualTestIdentityMismatch(error)).toBeNull()
    }
    expect(trap).not.toHaveBeenCalled()
  })
})
