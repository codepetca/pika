import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { AssignmentListStartupError, assignmentListStartupDiagnostic, createAssignmentListNativeAdapters } from '../../scripts/contextual-assignment-list-proof-platform'
import { AssignmentListLifecycleError } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { integratedFailureDiagnostic } from '../../scripts/check-contextual-assignment-learner-integrated-lifecycle'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { assignmentListProofWorkdir } from '../../scripts/contextual-assignment-list-proof-path'

const platform = vi.hoisted(() => ({ execFile: vi.fn() }))
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), execFile: platform.execFile }))

const privatePath = '/private/SYNTHETIC-SECRET-startup.json'
const diagnostic = (code: unknown = 1, killed = false, stdout = '', stderr = '') =>
  assignmentListStartupDiagnostic(new AssignmentListStartupError(privatePath, { code, killed, stdout, stderr }))

describe('closed isolated Assignment startup diagnostics (offline)', () => {
  it.each(['ENOENT', 'EACCES', 'EPERM', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'])('retains only the allowlisted command code %s', code => {
    expect(diagnostic(code)).toBe(`DIAG isolated assignment startup command=${code} exit=unknown killed=false observed-markers=none.\n`)
  })
  it.each([0, 1, 255])('retains the bounded integer exit %i without inferring its cause', exit => {
    expect(diagnostic(exit)).toBe(`DIAG isolated assignment startup command=exit exit=${exit} killed=false observed-markers=none.\n`)
  })
  it.each(['SYNTHETIC-SECRET', '1', -1, 256, 1.5, NaN, null, undefined, {}])('suppresses unknown command data %s', code => {
    expect(diagnostic(code === undefined ? null : code)).toBe('DIAG isolated assignment startup command=unknown exit=unknown killed=false observed-markers=none.\n')
  })
  it('reports killed as a fact rather than claiming a timeout', () => {
    expect(diagnostic(1, true)).toContain('killed=true')
    expect(diagnostic(1, true)).not.toContain('timeout')
  })
  it.each([
    ['disk-full', 'no space left on device'],
    ['port-conflict', 'address already in use'],
    ['port-conflict', 'failed: port is already allocated'],
    ['docker-unavailable', 'Cannot connect to the Docker daemon'],
    ['image-pull', 'failed to pull docker image:'],
    ['config-invalid', 'failed to parse config:'],
    ['config-invalid', 'failed to merge file config:'],
    ['config-invalid', 'Missing required field in config:'],
    ['migration-file', 'failed to open migration file:'],
    ['health-check', 'container is not ready:'],
    ['health-check', 'container is not running:'],
  ])('reports only the fixed observed marker %s', (label, marker) => {
    for (const [stdout, stderr] of [[marker, ''], ['', marker]]) {
      const line = diagnostic(1, false, `SYNTHETIC-SECRET ${stdout}`, `postgresql://SYNTHETIC-SECRET ${stderr}`)
      expect(line).toContain(`observed-markers=${label}.\n`)
      expect(line).not.toContain('SYNTHETIC-SECRET')
      expect(line).not.toContain('postgresql')
      expect(line).not.toContain(privatePath)
    }
  })
  it('records coexisting markers, not a guessed exclusive cause or progress message', () => {
    expect(diagnostic(1, false, '', 'failed to pull docker image: no space left on device')).toContain('observed-markers=disk-full,image-pull.')
    expect(diagnostic(1, false, '', 'Applying migration synthetic.sql\nWaiting for health checks...')).toContain('observed-markers=none.')
  })
  it('classifies only each existing bounded UTF-8 tail', () => {
    expect(diagnostic(1, false, 'no space left on device' + '漢'.repeat(6000))).toContain('observed-markers=none.')
    expect(diagnostic(1, false, '漢'.repeat(6000) + 'no space left on device')).toContain('observed-markers=disk-full.')
  })
  it('keeps the sealed line independent of public properties, forged instances and private errors', () => {
    const error = new AssignmentListStartupError(privatePath, { code: 1, killed: false, stdout: '', stderr: 'no space left on device SYNTHETIC-SECRET' })
    Object.assign(error, { diagnostic: 'SYNTHETIC-SECRET', code: 'SYNTHETIC-SECRET', message: 'SYNTHETIC-SECRET', diagnosticPath: 'SYNTHETIC-SECRET' })
    expect(assignmentListStartupDiagnostic(error)).toBe(diagnostic(1, false, '', 'no space left on device'))
    for (const untrusted of [Object.create(AssignmentListStartupError.prototype), new Error('SYNTHETIC-SECRET'), null]) {
      expect(assignmentListStartupDiagnostic(untrusted)).toBe('DIAG isolated assignment startup command=unknown exit=unknown killed=unknown observed-markers=none.\n')
    }
    expect(assignmentListStartupDiagnostic(new AssignmentListStartupError(privatePath))).toBe('DIAG isolated assignment startup command=unknown exit=unknown killed=unknown observed-markers=none.\n')
  })
  it('captures facts at the actual failed native command without printing its private output or changing command bounds', async () => {
    const fixture = newAssignmentListProofFixture()
    const project = `pika_assignment_list_${fixture.manifest.syntheticTag.slice(-12)}`
    const workdir = assignmentListProofWorkdir(project)
    const path = `${workdir}-startup.json`
    expect(existsSync(path)).toBe(false)
    platform.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
      queueMicrotask(() => callback(Object.assign(new Error('SYNTHETIC-SECRET'), { code: 1, killed: false }), '', 'failed to pull docker image: SYNTHETIC-SECRET'))
      return { stdin: { on: vi.fn(), end: vi.fn() } }
    })
    try {
      let failure: unknown
      try { await createAssignmentListNativeAdapters(fixture).command({ workdir, args: ['start'], timeoutMs: 180000 }) } catch (error) { failure = error }
      expect(failure).toBeInstanceOf(AssignmentListStartupError)
      expect(assignmentListStartupDiagnostic(failure)).toBe(diagnostic(1, false, '', 'failed to pull docker image:'))
      expect(String(failure)).not.toContain('SYNTHETIC-SECRET')
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(JSON.parse(readFileSync(path, 'utf8')).stderr).toContain('SYNTHETIC-SECRET')
      expect(platform.execFile).toHaveBeenLastCalledWith('supabase', ['start'], { timeout: 180000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, expect.any(Function))
    } finally { if (existsSync(path)) unlinkSync(path) }
  })
  it('adds startup facts only to the correct wrapped stage and preserves independent cleanup labels', () => {
    const startup = new AssignmentListStartupError(privatePath, { code: 'ENOENT', killed: false, stdout: '', stderr: 'SYNTHETIC-SECRET' })
    const failure = new AssignmentListLifecycleError({ stage: 'start', error: startup }, [{ stage: 'cleanup', error: new Error('SYNTHETIC-SECRET') }])
    expect(integratedFailureDiagnostic(failure, 'not-started')).toBe('DIAG isolated assignment-learner-integrated stage=start step=not-started cleanup=present.\n' + diagnostic('ENOENT'))
    expect(integratedFailureDiagnostic(new AssignmentListLifecycleError({ stage: 'fixture', error: startup }, []), 'extension-sql')).toBe('DIAG isolated assignment-learner-integrated stage=fixture step=extension-sql cleanup=none.\n')
    expect(integratedFailureDiagnostic(new AssignmentListLifecycleError({ stage: 'start', error: new Error('SYNTHETIC-SECRET') }, []), 'not-started')).toBe('DIAG isolated assignment-learner-integrated stage=start step=not-started cleanup=none.\n')
  })
})
