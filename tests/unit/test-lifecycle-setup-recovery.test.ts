import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))

// Every psql process is an in-memory EventEmitter. No database/client runs.
describe('CORE244 indeterminate setup acknowledgement recovery', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.spawn.mockReset()
    vi.stubEnv('CORE244_ALLOW_LOCAL_VERIFICATION', '1')
    vi.stubEnv('PGHOST', '127.0.0.1')
    vi.stubEnv('CORE244_FORCE_FAILURE', '0')
    vi.stubEnv('CORE244_FORCE_SETUP_ACK_FAILURE', '0')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  function simulate(outcomes: Array<{ output?: string; error?: string }>) {
    const statements: string[] = []
    mocks.spawn.mockImplementation(() => {
      const result = outcomes.shift()
      if (!result) throw new Error('Unexpected SQL process; recovery must stay exact')
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(), stderr: new EventEmitter(),
        stdin: { end: (sql: string) => {
          statements.push(sql)
          queueMicrotask(() => {
            if (result.output) child.stdout.emit('data', result.output)
            if (result.error) child.stderr.emit('data', result.error)
            child.emit('close', result.error ? 1 : 0)
          })
        } },
        kill: vi.fn(),
      })
      return child
    })
    return statements
  }

  const owned = JSON.stringify({ owned: true, residue: { users: [{ id: 'fixture', fingerprint: 'run' }] } })
  const absent = JSON.stringify({ owned: false, residue: { users: [], classrooms: [] } })
  const modulePath = '../../scripts/check-test-attempt-lifecycle-concurrency.mjs'

  it.each(['lost-client-ack', 'controlled-failure'] as const)('recovers committed fixture on $0 and retains nonzero outcome after exact cleanup', async (failure) => {
    if (failure === 'controlled-failure') vi.stubEnv('CORE244_FORCE_SETUP_ACK_FAILURE', '1')
    const statements = simulate([
      { output: 'baseline' },
      failure === 'lost-client-ack' ? { error: 'COMMIT acknowledgement lost' } : {},
      { output: owned }, {}, { output: absent }, { output: 'baseline' },
    ])
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await expect(import(modulePath)).rejects.toThrow(failure === 'lost-client-ack'
      ? 'COMMIT acknowledgement lost' : 'Forced setup COMMIT acknowledgement failure')
    expect(statements).toHaveLength(6)
    expect(statements[2]).toContain("jsonb_build_object('owned'")
    expect(statements[2]).toContain('core244-')
    expect(statements[3]).toContain('fixture ownership changed; refusing teardown')
    expect(statements[3]).toContain('delete from public.classrooms')
    expect(statements[4]).toContain("'fingerprint'")
    expect(output).toHaveBeenCalledWith('Exact fixture teardown and baseline fingerprint: PASS\n')
  })

  it('refuses to adopt collision IDs from another run and never issues a delete', async () => {
    const statements = simulate([
      { output: 'baseline' }, { error: 'Fixture IDs already exist' },
      { output: JSON.stringify({ owned: false, residue: { classrooms: [{ id: 'collision', fingerprint: 'other-run' }] } }) },
    ])
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await expect(import(modulePath)).rejects.toThrow('refusing deletion. Exact residue fingerprint')
    expect(statements).toHaveLength(3)
    expect(statements.slice(2).join('\n')).not.toMatch(/delete from/)
    expect(output).not.toHaveBeenCalled()
  })

  it('does not delete after rolled-back setup with no exact residue', async () => {
    const statements = simulate([{ output: 'baseline' }, { error: 'Setup rolled back' }, { output: absent }])
    await expect(import(modulePath)).rejects.toThrow('Setup rolled back')
    expect(statements).toHaveLength(3)
  })

  it('rejects cleanup with remaining exact residue and with a changed baseline', async () => {
    const remaining = simulate([
      { output: 'baseline' }, { error: 'COMMIT acknowledgement lost' }, { output: owned }, {}, { output: owned },
    ])
    await expect(import(modulePath)).rejects.toThrow('CORE244 exact fixture residue after teardown')
    expect(remaining).toHaveLength(5)
    vi.resetModules()
    const baseline = simulate([
      { output: 'baseline' }, { error: 'COMMIT acknowledgement lost' }, { output: owned }, {}, { output: absent }, { output: 'different' },
    ])
    await expect(import(modulePath)).rejects.toThrow('Relevant-table baseline changed')
    expect(baseline).toHaveLength(6)
  })
})
