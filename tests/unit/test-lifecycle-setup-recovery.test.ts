import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
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

  function simulate(outcomes: Array<{ output?: string | ((sql: string) => string); error?: string }>) {
    const statements: string[] = []
    mocks.spawn.mockImplementation(() => {
      const result = outcomes.shift()
      if (!result) throw new Error('Unexpected SQL process; recovery must stay exact')
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(), stderr: new EventEmitter(),
        stdin: { end: (sql: string) => {
          statements.push(sql)
          queueMicrotask(() => {
            if (result.output) child.stdout.emit('data', typeof result.output === 'function' ? result.output(sql) : result.output)
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

  const membershipScope = createHash('sha256').update('pika-membership-scope-v1:a2449000-0000-4000-8000-000000000010:a2449000-0000-4000-8000-000000000002').digest('hex')
  function generation(sql: string, state: 'active' | 'removed' = 'active') {
    const id = sql.match(/generation_id='([0-9a-f-]+)'::uuid/)?.[1]
    if (!id) throw new Error('Expected exact explicit enrollment generation in probe')
    return { generation_id: id, scope_digest: membershipScope, pal_reference: `pika-membership-v1-${'a'.repeat(32)}`, state }
  }
  const owned = (sql: string) => JSON.stringify({ owned: true, generation: generation(sql), residue: { users: [{ id: 'fixture', fingerprint: 'run' }] } })
  const removed = (sql: string) => JSON.stringify({ owned: false, generation: generation(sql, 'removed'), residue: { users: [], classrooms: [] } })
  const absent = JSON.stringify({ owned: false, generation: null, residue: { users: [], classrooms: [] } })
  const modulePath = '../../scripts/check-test-attempt-lifecycle-concurrency.mjs'

  it.each(['lost-client-ack', 'controlled-failure'] as const)('recovers committed fixture on $0 and retains nonzero outcome after exact cleanup', async (failure) => {
    if (failure === 'controlled-failure') vi.stubEnv('CORE244_FORCE_SETUP_ACK_FAILURE', '1')
    const statements = simulate([
      { output: 'baseline' },
      failure === 'lost-client-ack' ? { error: 'COMMIT acknowledgement lost' } : {},
      { output: owned }, { output: owned }, {}, { output: removed }, { output: 'baseline' },
    ])
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await expect(import(modulePath)).rejects.toThrow(failure === 'lost-client-ack'
      ? 'COMMIT acknowledgement lost' : 'Forced setup COMMIT acknowledgement failure')
    expect(statements).toHaveLength(7)
    expect(statements[2]).toContain("jsonb_build_object('owned'")
    expect(statements[2]).toContain('core244-')
    expect(statements[4]).toContain('fixture ownership changed; refusing teardown')
    expect(statements[4]).toContain('delete from public.classrooms')
    expect(statements[5]).toContain("'fingerprint'")
    expect(output).toHaveBeenCalledWith('Exact public fixture teardown and public baseline fingerprint: PASS\n')
    expect(output).toHaveBeenCalledWith('Retained run-owned private Pal membership generation (removed; disposable database only): PASS\n')
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
      { output: 'baseline' }, { error: 'COMMIT acknowledgement lost' }, { output: owned }, { output: owned }, {}, { output: (sql: string) => JSON.stringify({ owned: false, generation: generation(sql, 'removed'), residue: { users: [{ id: 'leftover' }] } }) },
    ])
    await expect(import(modulePath)).rejects.toThrow('CORE244 exact fixture residue after teardown')
    expect(remaining).toHaveLength(6)
    vi.resetModules()
    const baseline = simulate([
      { output: 'baseline' }, { error: 'COMMIT acknowledgement lost' }, { output: owned }, { output: owned }, {}, { output: removed }, { output: 'different' },
    ])
    await expect(import(modulePath)).rejects.toThrow('Relevant public-table baseline changed')
    expect(baseline).toHaveLength(7)
  })
  it('does not adopt setup when the exact current enrollment is missing even though run roots and its active ledger exist', async () => {
    vi.stubEnv('CORE244_FORCE_SETUP_ACK_FAILURE', '1')
    const statements = simulate([
      { output: 'baseline' }, {},
      { output: (sql: string) => JSON.stringify({ owned: false, generation: generation(sql), residue: { classrooms: [{ id: 'run-root' }] } }) },
    ])
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await expect(import(modulePath)).rejects.toThrow('refusing deletion')
    expect(statements).toHaveLength(3)
    expect(statements[2]).toContain("exists(select 1 from public.classroom_enrollments where id=")
    expect(statements.slice(2).join('\n')).not.toContain('delete from')
    expect(output).not.toHaveBeenCalled()
  })

  it.each(['generation_id', 'scope_digest', 'state'] as const)('rejects mismatched setup ledger $0 before ownership adoption', async (field) => {
    vi.stubEnv('CORE244_FORCE_SETUP_ACK_FAILURE', '1')
    const statements = simulate([
      { output: 'baseline' }, {},
      { output: (sql: string) => JSON.stringify({ owned: true, generation: { ...generation(sql), [field]: 'different' }, residue: { users: [{ id: 'run-root' }] } }) },
    ])
    await expect(import(modulePath)).rejects.toThrow('expected enrollment generation identity/state mismatch')
    expect(statements).toHaveLength(3)
  })

  // This models process/acknowledgement outcomes only. SQL/locks/triggers are
  // never executed; the actual migration168 contract is separately source-read.
  function simulateNormalLifecycle(lostRemovalAcknowledgement: boolean, alteredLedgerIdentity = false) {
    const statements: string[] = []
    let publicClean = false
    let membershipState: 'active' | 'removed' = 'active'
    mocks.spawn.mockImplementation((_command: string, _args: string[], options: { env: { PGAPPNAME: string } }) => {
      let pendingRemoval = false
      let ended = false
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(), stderr: new EventEmitter(),
        stdin: {
          write: (sql: string) => {
            statements.push(sql)
            pendingRemoval = sql.includes('delete from public.classroom_enrollments')
            queueMicrotask(() => child.stdout.emit('data', sql.includes('CORE244_AUTHORITY_READY') ? 'CORE244_AUTHORITY_READY' : 'CORE244_READY'))
          },
          end: (sql: string) => {
            statements.push(sql)
            let output = ''
            let error = ''
            if (pendingRemoval && sql.includes('commit;')) {
              membershipState = 'removed'
              if (lostRemovalAcknowledgement) error = 'Terminal removal COMMIT acknowledgement lost'
            } else if (sql.startsWith("select md5(string_agg(table_name")) {
              output = 'baseline'
            } else if (sql.startsWith("select jsonb_build_object('owned'")) {
              const expectedState = sql.includes("and state='removed'") ? 'removed' : 'active'
              const identity = generation(sql, membershipState)
              if (alteredLedgerIdentity && membershipState === 'removed') identity.pal_reference = `pika-membership-v1-${'b'.repeat(32)}`
              output = JSON.stringify({ owned: !publicClean && expectedState === membershipState, generation: identity,
                residue: { users: publicClean ? [] : [{ id: 'run-root' }] } })
            } else if (sql.includes('pg_stat_activity')) {
              output = 't'
            } else if (sql.includes('delete from public.classrooms')) {
              publicClean = true
              membershipState = 'removed'
            }
            queueMicrotask(() => {
              ended = true
              if (output) child.stdout.emit('data', output)
              if (error) child.stderr.emit('data', error)
              child.emit('close', error ? 1 : 0)
            })
          },
        },
        kill: vi.fn(() => {
          if (!ended) { ended = true; queueMicrotask(() => child.emit('close', 1)) }
        }),
      })
      expect(options.env.PGAPPNAME).toContain('pika-core244-')
      return child
    })
    return statements
  }

  it.each([false, true])('keeps removal terminal and verifies retained identity on lost removal COMMIT acknowledgement=%s', async (lostAcknowledgement) => {
    const statements = simulateNormalLifecycle(lostAcknowledgement)
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    if (lostAcknowledgement) await expect(import(modulePath)).rejects.toThrow('Terminal removal COMMIT acknowledgement lost')
    else await import(modulePath)
    expect(statements.filter((sql) => sql.includes('insert into public.classroom_enrollments'))).toHaveLength(1)
    const removal = statements.findIndex((sql) => sql.includes('delete from public.classroom_enrollments'))
    expect(removal).toBeGreaterThan(statements.findIndex((sql) => sql.includes('set archived_at=now()')))
    expect(removal).toBeGreaterThan(statements.findIndex((sql) => sql.includes('set teacher_id=')))
    const teardown = statements.findIndex((sql) => sql.includes('delete from public.classrooms'))
    expect(teardown).toBeGreaterThan(removal)
    expect(statements[teardown - 1]).toContain("and state='removed'")
    expect(statements[teardown]).not.toContain('delete from private')
    expect(output).toHaveBeenCalledWith('Exact public fixture teardown and public baseline fingerprint: PASS\n')
    expect(output).toHaveBeenCalledWith('Retained run-owned private Pal membership generation (removed; disposable database only): PASS\n')
  })

  it('refuses terminal adoption and public cleanup when the removed ledger identity differs from its original generation', async () => {
    const statements = simulateNormalLifecycle(true, true)
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await expect(import(modulePath)).rejects.toThrow('not owned; refusing cleanup')
    expect(statements.some((sql) => sql.includes('delete from public.classrooms'))).toBe(false)
    expect(output.mock.calls.some(([message]) => String(message).includes('Exact public fixture teardown'))).toBe(false)
  })

})
