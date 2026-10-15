import { describe, expect, it, vi } from 'vitest'
import { contextualTestIdentityMismatch, ownedFamilyAbsent, parseKernelProcessRows, reconcileOwnedFamily, requireLiveKernelRoot, settleOwnedFamily, type Capture, type OwnedProcessRow } from '../../scripts/contextual-test-process-ownership'

const identity = { pid: 101, pgid: 101, started: '1234567:123456', uniqueId: '10101', imageUuid: 'a'.repeat(32), pidVersion: 2, executable: '/PRIVATE-SENTINEL/node', cwd: '/PRIVATE-SENTINEL', role: 'browser' as const }
const capture: Capture = { identity, descendants: [{ ...identity, pid: 102 }] }
function mismatch(rows: OwnedProcessRow[]): unknown {
  try { reconcileOwnedFamily(capture, rows); throw Error('Expected mismatch') } catch (error) { return error }
}
describe('fixed private process identity mismatch metadata', () => {
  it.each(['root','descendant'] as const)('records each comparison for %s with no identity values', member => {
    const original = member === 'root' ? identity : capture.descendants[0]
    for (const field of ['started','pgid','executable','all'] as const) {
      const observed = { ...original, ppid: 101, parentUniqueId: identity.uniqueId, state: 'alive' as const,
        ...(field === 'started' || field === 'all' ? { started: '9999999:654321' } : {}),
        ...(field === 'pgid' || field === 'all' ? { pgid: 87654321 } : {}),
        ...(field === 'executable' || field === 'all' ? { executable: '/SECRET/other', pidVersion: 3 } : {}) }
      const error = mismatch([observed])
      expect(error).toMatchObject({ processCause: 'identity-mismatch', message: 'Owned process verification rejected' })
      const diagnostic = contextualTestIdentityMismatch(error)
      expect(diagnostic).toEqual({ member, state: 'alive', birthIdentityChanged: false, imageGenerationChanged: field === 'executable' || field === 'all', startTimeChanged: field === 'started' || field === 'all',
        pgidChanged: field === 'pgid' || field === 'all', executableChanged: field === 'executable' || field === 'all', previousExecutableClass: 'other', observedExecutableClass: 'other' })
      expect(Object.isFrozen(diagnostic)).toBe(true)
      expect(JSON.stringify(diagnostic)).not.toMatch(/1234567|9999999|87654321|PRIVATE|SECRET|pid|cwd|started/)
    }
  })
  it.each(['zombie','exiting'] as const)('preserves %s empty-executable exception and exposes only actual mismatches', state => {
    const observed = { ...identity, ppid: 1, parentUniqueId: '1', state, executable: '' }
    expect(() => reconcileOwnedFamily(capture, [observed])).not.toThrow()
    expect(contextualTestIdentityMismatch(mismatch([{ ...observed, started: '999:1' }]))).toEqual({ member: 'root', state,
      startTimeChanged: true, birthIdentityChanged: false, imageGenerationChanged: false, pgidChanged: false, executableChanged: false, previousExecutableClass: 'other', observedExecutableClass: 'empty' })
    expect(contextualTestIdentityMismatch(mismatch([{ ...observed, executable: '/other' }]))?.executableChanged).toBe(true)
  })
  it('uses unknown for absent state and retains the kernel-unverified rejection priority', () => {
    expect(contextualTestIdentityMismatch(mismatch([{ ...identity, ppid: 1, parentUniqueId: '1', pgid: 999 }]))?.state).toBe('unknown')
    const error = mismatch([{ ...identity, ppid: 1, parentUniqueId: '1', pgid: 999, state: 'unverified' }])
    expect(error).toMatchObject({ processCause: 'kernel-unverified' }); expect(contextualTestIdentityMismatch(error)).toBeNull()
  })
  it('never trusts copied error fields, inherited data, getters or proxies', () => {
    const trap = vi.fn(() => { throw Error('SECRET') })
    const real = mismatch([{ ...identity, ppid: 1, parentUniqueId: '1', pgid: 999 }]) as Error
    for (const error of [null, 'SECRET', {}, { ...real }, Object.create(real),
      Object.defineProperty({}, 'identityMismatch', { get: trap }),
      new Proxy(real, { get: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap }),
      { processCause: 'identity-mismatch', identityMismatch: contextualTestIdentityMismatch(real) }]) {
      expect(contextualTestIdentityMismatch(error)).toBeNull()
    }
    expect(trap).not.toHaveBeenCalled()
  })
  it.each([
    ['/Users/stew/.local/share/mise/installs/node/24.12.0/bin/node', 'node'],
    ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'chrome'],
    ...['', ' (Renderer)', ' (GPU)', ' (Alerts)', ' (Aperitif)', ' (Aperitif Renderer)', ' (Aperitif GPU)', ' (Aperitif Alerts)'].map((suffix, index) => [
      `/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/155.0.8059.79/Helpers/Google Chrome Helper${suffix}.app/Contents/MacOS/Google Chrome Helper${suffix}`,
      ['chrome-helper','chrome-renderer','chrome-gpu','chrome-alerts','chrome-aperitif','chrome-aperitif-renderer','chrome-aperitif-gpu','chrome-aperitif-alerts'][index],
    ]),
    ['/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/155.0.8059.79/Helpers/chrome_crashpad_handler', 'chrome-crashpad'],
    ['/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/155.0.8059.40/Helpers/chrome_crashpad_handler', 'other'],
    ['/SECRET/Google Chrome', 'other'], ['/SECRET/node', 'other'], ['', 'empty'],
  ])('labels exact known executable paths without allowing the transition: %s', (path, label) => {
    const snapshot = structuredClone(capture)
    const row = { ...identity, executable: path, ppid: 101, parentUniqueId: '1', state: 'alive' as const }
    const error = mismatch([row])
    expect(error).toMatchObject({ processCause: 'identity-mismatch' })
    expect(contextualTestIdentityMismatch(error)).toMatchObject({ previousExecutableClass: 'other', observedExecutableClass: label, executableChanged: true })
    expect(capture).toEqual(snapshot)
    expect(JSON.stringify(contextualTestIdentityMismatch(error))).not.toContain(path || 'impossible-sentinel')
  })
  it('labels both sides of a descendant transition, still rejecting and retaining the original capture', () => {
    const before = { ...identity, executable: '/Users/stew/.local/share/mise/installs/node/24.12.0/bin/node', pid: 102 }
    let error: unknown
    const own = { identity, descendants: [before] }
    try { reconcileOwnedFamily(own, [{ ...before, ppid: 101, parentUniqueId: identity.uniqueId, state: 'alive', pidVersion: 3, executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }]) } catch (caught) { error = caught }
    expect(contextualTestIdentityMismatch(error)).toMatchObject({ member: 'descendant', previousExecutableClass: 'node', observedExecutableClass: 'chrome', startTimeChanged: false, pgidChanged: false, executableChanged: true })
    expect(own.descendants[0]).toBe(before)
  })
})

describe('lineage admission separated from image publication', () => {
  const root = { pid:identity.pid, pgid:identity.pgid, started:identity.started, executable:identity.executable, uniqueId: identity.uniqueId, parentUniqueId: '1', imageUuid: identity.imageUuid, pidVersion: identity.pidVersion, ppid: 1, state: 'alive' as const }
  const starting = { ...root, pid: 103, ppid: root.pid, uniqueId: '10301', parentUniqueId: root.uniqueId, started: '1234567:654321', executable: '', imageUuid: '', pidVersion: null, state: 'starting' as const }
  const initial: Capture = { identity, descendants: [] }
  const pending = () => reconcileOwnedFamily(initial, [root, starting])

  it('requires schema 3 and keeps starting roots unverified', () => {
    expect(parseKernelProcessRows(JSON.stringify({ schema: 3, rows: [starting] }))).toEqual([starting])
    expect(() => parseKernelProcessRows(JSON.stringify({ schema: 2, rows: [root] }))).toThrow()
    expect(() => requireLiveKernelRoot(starting)).toThrow()
    for (const row of [{ ...starting, state: undefined }, { ...starting, executable: '/cpu/inherited' }, { ...starting, started: 'unverified' }]) {
      expect(() => parseKernelProcessRows(JSON.stringify({ schema: 3, rows: [row] }))).toThrow()
    }
  })
  it('tracks starting birth separately, then binds image generation without freezing pathname publication', () => {
    const first = pending()
    expect(first.descendants).toEqual([])
    expect(first.pending).toEqual([{ pid: starting.pid, pgid: starting.pgid, started: starting.started, uniqueId: starting.uniqueId, parent: identity }])
    expect(ownedFamilyAbsent(first, [root, starting])).toBe(false)
    const complete = { ...starting, state: 'alive' as const, executable: '/cpu/inherited', imageUuid: 'b'.repeat(32), pidVersion: 7 }
    const final = reconcileOwnedFamily(first, [root, complete])
    expect(final.pending).toEqual([])
    expect(final.descendants).toEqual([{ ...identity, pid: complete.pid, started: complete.started, uniqueId: complete.uniqueId, imageUuid: complete.imageUuid, pidVersion: complete.pidVersion, executable: complete.executable }])
    expect(() => reconcileOwnedFamily(final, [root, { ...complete, executable: '/cpu/published' }])).not.toThrow()
    expect(() => reconcileOwnedFamily(final, [root, { ...complete, executable: '/cpu/other', pidVersion: 8 }])).toThrow()
    expect(first.descendants).toEqual([])
  })
  it.each(['missing', 'pid', 'started', 'pgid', 'ppid', 'parent-missing', 'parent-exited', 'parent-started', 'terminal', 'unverified'] as const)('rejects pending %s without forgetting its birth', field => {
    const first = pending(), before = structuredClone(first)
    let parent: OwnedProcessRow = root, child: OwnedProcessRow = starting
    if (field === 'pid') child = { ...child, pid: 104 }
    if (field === 'started') child = { ...child, started: '999:1' }
    if (field === 'pgid') child = { ...child, pgid: 999 }
    if (field === 'ppid') child = { ...child, ppid: 999 }
    if (field === 'parent-exited') parent = { ...parent, state: 'exiting', executable: '' }
    if (field === 'parent-started') parent = { ...parent, started: '999:2' }
    if (field === 'terminal') child = { ...child, state: 'zombie' }
    if (field === 'unverified') child = { ...child, state: 'unverified' }
    const rows = [...(field === 'parent-missing' ? [] : [parent]), ...(field === 'missing' ? [] : [child])]
    expect(() => reconcileOwnedFamily(first, rows)).toThrow()
    expect(first).toEqual(before)
  })
  it('cannot adopt grandchildren or cover an unknown group member', () => {
    const first = pending()
    const grandchild = { ...root, pid: 104, ppid: starting.pid, executable: '/cpu/helper' }
    expect(() => reconcileOwnedFamily(first, [root, starting, grandchild])).toThrow()
    expect(() => reconcileOwnedFamily(first, [root, starting, { ...grandchild, ppid: 1 }])).toThrow()
  })
  it.each(['group', 'pid'] as const)('never signals while pending and retains the original %s settlement deadline', async mode => {
    let time = 0
    const signal = vi.fn(), first = pending()
    await expect(settleOwnedFamily(first, mode, { rows: async () => { time += 1; return [root, starting] },
      now: () => time, admit() {}, signal, closed: () => true, end: 4, update() {} })).rejects.toThrow()
    expect(signal).not.toHaveBeenCalled()
  })
  it.each(['group', 'pid'] as const)('blocks a %s signal when a starting child appears at the last pre-signal refresh', async mode => {
    let time = 0, reads = 0
    const signal = vi.fn()
    await expect(settleOwnedFamily(initial, mode, { rows: async () => { time += 1; return ++reads === 1 ? [root] : [root, starting] },
      now: () => time, admit() {}, signal, closed: () => false, end: 5, update() {} })).rejects.toThrow()
    expect(signal).not.toHaveBeenCalled()
  })
  it('does not treat a captured process returning to starting as a permissible transition', () => {
    expect(() => reconcileOwnedFamily(initial, [{ ...root, state: 'starting' }])).toThrow()
  })
  it.each(['uniqueId','parentUniqueId'])('rejects a pending %s substitution', field => {
    expect(() => reconcileOwnedFamily(pending(), [root, { ...starting, [field]: '999' }])).toThrow()
  })
  it('requires matching live parent unique identity, including when the PID was reused', () => {
    const complete = { ...starting, state: 'alive' as const, executable: '/cpu/helper', imageUuid: 'b'.repeat(32), pidVersion: 7 }
    expect(() => reconcileOwnedFamily(initial, [root, { ...complete, parentUniqueId: '999' }])).toThrow()
    expect(() => reconcileOwnedFamily(initial, [root, { ...complete, ppid: 999 }])).toThrow()
  })
  it.each(['uniqueId','imageUuid','pidVersion'] as const)('rejects a hostile %s transition even with identical path/birth/group', field => {
    const complete = { ...starting, state: 'alive' as const, executable: '/cpu/helper', imageUuid: 'b'.repeat(32), pidVersion: 7 }
    const first = reconcileOwnedFamily(initial, [root, complete])
    const changed = { ...complete, [field]: field === 'pidVersion' ? 8 : field === 'imageUuid' ? 'c'.repeat(32) : '999' }
    let error: unknown
    try { reconcileOwnedFamily(first, [root, changed]) } catch (caught) { error = caught }
    expect(contextualTestIdentityMismatch(error)).toMatchObject({ birthIdentityChanged: field === 'uniqueId', imageGenerationChanged: field !== 'uniqueId', executableChanged: false })
    expect(JSON.stringify(contextualTestIdentityMismatch(error))).not.toContain(complete.imageUuid)
  })
  it.each(['group','pid'] as const)('excludes an unverified or changed generation from a fresh %s signal snapshot', async mode => {
    const complete = { ...starting, state: 'alive' as const, executable: '/cpu/helper', imageUuid: 'b'.repeat(32), pidVersion: 7 }
    const first = reconcileOwnedFamily(initial, [root, complete])
    for (const patch of [{ pidVersion: 8 }, { uniqueId: '999' }, { state: 'unverified' as const }]) {
      let time = 0, reads = 0
      const signal = vi.fn()
      await expect(settleOwnedFamily(first, mode, { rows: async () => { time += 1; return [root, ++reads === 1 ? complete : { ...complete, ...patch }] }, now: () => time, admit() {}, signal, closed: () => false, end: 9, update() {} })).rejects.toThrow()
      expect(signal).not.toHaveBeenCalled()
    }
  })
  it.each(['group','pid'] as const)('permits %s settlement after pathname publication with fresh unchanged generation proof', async mode => {
    const complete = { ...starting, state: 'alive' as const, executable: '/cpu/inherited', imageUuid: 'b'.repeat(32), pidVersion: 7 }
    const first = reconcileOwnedFamily(initial, [root, complete])
    let time = 0, reads = 0
    const signal = vi.fn()
    await expect(settleOwnedFamily(first, mode, { rows: async () => { time += 1; return ++reads < 3 ? [{ ...complete, executable: '/cpu/published' }] : [] }, now: () => time, admit() {}, signal, closed: () => true, end: 10, update() {} })).resolves.toEqual({ closed: true, absent: true })
    expect(signal).toHaveBeenCalledExactlyOnceWith(mode === 'group' ? -identity.pgid : complete.pid, 'SIGTERM')
  })
  it('rejects invalid or absent private identity fields at the parser and root boundaries', () => {
    for (const patch of [{ uniqueId: '' }, { uniqueId: '18446744073709551616' }, { uniqueId: '01' }, { parentUniqueId: '' }, { imageUuid: '0'.repeat(32) }, { imageUuid: 'A'.repeat(32) }, { pidVersion: null }, { pidVersion: 2147483648 }]) {
      expect(() => parseKernelProcessRows(JSON.stringify({ schema: 3, rows: [{ ...root, ...patch }] }))).toThrow()
      expect(() => requireLiveKernelRoot({ ...root, ...patch })).toThrow()
    }
  })
})
