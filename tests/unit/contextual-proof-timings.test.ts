import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createContextualProofTimings, extractContextualProofTimingArgs } from '../../scripts/contextual-proof-timings'
import { parseAssignmentListLifecycleArgs } from '../../scripts/check-contextual-assignment-list-lifecycle'
import type { AssignmentListLifecycleAdapters } from '../../scripts/contextual-assignment-list-proof-lifecycle'

const temporary: string[] = []
const input = { reviewedSha: 'a'.repeat(40), profile: 'test-owner-detail' as const, mode: 'normal' as const }
function directory() { const path = mkdtempSync(join(realpathSync(tmpdir()), 'pika-proof-timings-')); temporary.push(path); return path }
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); vi.restoreAllMocks() })

describe('private contextual proof timings (offline)', () => {
  it('accepts only the existing argument contract and one exact trailing absolute timing path', () => {
    const args = ['--reviewed-head', input.reviewedSha, '--mode', 'normal']; const path = join(directory(), 'timings.json')
    expect(parseAssignmentListLifecycleArgs(extractContextualProofTimingArgs(args).lifecycleArgs)).toEqual({ head: input.reviewedSha, mode: 'normal' })
    expect(extractContextualProofTimingArgs([...args, '--timings-path', path])).toEqual({ lifecycleArgs: args, timingsPath: path })
    for (const extra of [['--timings-path'], ['--unknown', path], ['--timings-path', 'relative.json'], ['--timings-path', path, '--timings-path', path]]) expect(() => extractContextualProofTimingArgs([...args, ...extra])).toThrow()
    expect(() => parseAssignmentListLifecycleArgs(extractContextualProofTimingArgs(['--reviewed-head', input.reviewedSha, '--mode', 'unexpected', '--timings-path', path]).lifecycleArgs)).toThrow()
  })
  it('preserves results and writes only fixed labels, counts and monotonic durations without console output', async () => {
    const path = join(directory(), 'timings.json'); let clock = 0
    const timing = createContextualProofTimings({ ...input, path }, () => clock++)
    const stdout = vi.spyOn(process.stdout, 'write'); const stderr = vi.spyOn(process.stderr, 'write')
    const command = vi.fn(async () => ({ privateRows: 'must-not-appear' }))
    const adapters = timing.decorate({ command } as unknown as AssignmentListLifecycleAdapters)
    const request = { args: ['start', 'secret-argument'], workdir: 'secret-directory', timeoutMs: 1 }
    await expect(timing.run(async () => { await adapters.command(request); return adapters.command({ ...request, args: ['status'] }) })).resolves.toEqual({ privateRows: 'must-not-appear' })
    expect(command).toHaveBeenCalledWith(request)
    const contents = readFileSync(path, 'utf8'); const receipt = JSON.parse(contents)
    expect(receipt).toEqual({ version: 1, ...input, outcome: 'passed', durationMs: 5,
      operations: [{ operation: 'start', calls: 1, failedCalls: 0, durationMs: 1, outcome: 'passed' }, { operation: 'status', calls: 1, failedCalls: 0, durationMs: 1, outcome: 'passed' }] })
    expect(contents).not.toMatch(/secret|must-not-appear|privateRows/); expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(stdout).not.toHaveBeenCalled(); expect(stderr).not.toHaveBeenCalled()
    await expect(timing.run(async () => {})).rejects.toThrow()
  })
  it('flushes failed operation and later teardown evidence before propagating the identical failure', async () => {
    const path = join(directory(), 'failure.json'); const failure = new Error('private SQL, credential or row'); let clock = 0
    const timing = createContextualProofTimings({ ...input, mode: 'before-capture', path }, () => clock++)
    const adapters = timing.decorate({ executeSql: async () => { throw failure }, teardown: async () => {} } as unknown as AssignmentListLifecycleAdapters)
    await expect(timing.run(async () => { try { await adapters.executeSql({} as never) } finally { await adapters.teardown({} as never) } })).rejects.toBe(failure)
    const contents = readFileSync(path, 'utf8'); const receipt = JSON.parse(contents)
    expect(receipt).toMatchObject({ outcome: 'failed', mode: 'before-capture', operations: [
      { operation: 'executeSql', calls: 1, failedCalls: 1, outcome: 'failed' }, { operation: 'teardown', calls: 1, failedCalls: 0, outcome: 'passed' }] })
    expect(contents).not.toContain(failure.message)
  })
  it('remains inert when no timing path is supplied', async () => {
    const timing = createContextualProofTimings(input); const adapters = {} as AssignmentListLifecycleAdapters
    expect(timing.decorate(adapters)).toBe(adapters); await expect(timing.run(async () => 7)).resolves.toBe(7)
  })
  it('refuses existing files, symlinks and symlink ancestors without overwriting anything', () => {
    const parent = directory(); const existing = join(parent, 'existing.json'); writeFileSync(existing, 'keep')
    const link = join(parent, 'link.json'); symlinkSync(existing, link)
    const actual = join(parent, 'actual'); mkdirSync(actual); const alias = join(parent, 'alias'); symlinkSync(actual, alias)
    for (const path of [existing, link, join(alias, 'timings.json'), 'relative.json', join(parent, 'missing', 'timings.json')]) expect(() => createContextualProofTimings({ ...input, path })).toThrow()
    expect(readFileSync(existing, 'utf8')).toBe('keep'); expect(existsSync(join(actual, 'timings.json'))).toBe(false)
  })
  it('refuses a substituted destination while keeping the replacement untouched', async () => {
    const path = join(directory(), 'timings.json'); const timing = createContextualProofTimings({ ...input, path })
    await expect(timing.run(async () => { unlinkSync(path); writeFileSync(path, 'replacement') })).rejects.toThrow()
    expect(readFileSync(path, 'utf8')).toBe('replacement')
  })
})
