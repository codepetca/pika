import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseLockProofArgs, runRetainedRosterGroupLockProof, validateLocalTarget,
  type ChildFactory,
} from '../../scripts/check-retained-roster-group-locks-database'

const status = JSON.stringify({ API_URL: 'http://127.0.0.1:54321', DB_URL: 'postgresql://postgres:private@127.0.0.1:54322/postgres' })
const target = { project: 'pika', ports: '127.0.0.1:54322\n[::1]:54322', status }

function harness(options: { wrongTarget?: boolean; hang?: boolean; fail?: boolean; drift?: boolean } = {}) {
  const calls: { args: string[]; sql: string[]; child: EventEmitter; kills: string[] }[] = []
  let snapshots = 0
  const factory: ChildFactory = (_file, args) => {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams
    const stdout = new PassThrough(), stderr = new PassThrough()
    const record = { args: [...args], sql: [] as string[], child, kills: [] as string[] }
    calls.push(record)
    let closed = false
    const close = () => { if (!closed) { closed = true; child.emit('close', 0, null) } }
    Object.assign(child, { stdout, stderr, pid: 100 + calls.length,
      kill: (signal: string) => { record.kills.push(signal); queueMicrotask(close); return true },
      stdin: new Writable({ write(chunk, _encoding, done) {
        const sql = String(chunk); record.sql.push(sql)
        queueMicrotask(() => {
          if (options.hang && sql.includes('try_lock_classroom_membership_change')) return
          if (options.fail && sql.includes('classroom_operation_busy')) { child.emit('error', new Error('PRIVATE failure')); return }
          if (sql.includes('PROOF_FINGERPRINT:')) {
            snapshots++
            stdout.write(`{"table":"private.example","count":${options.drift && snapshots > 1 ? 1 : 0},"digest":"private"}\n{"metadata":{}}\n`)
          }
          if (sql.includes('pg_backend_pid()')) stdout.write(`${calls.length + 500}\n`)
          const marker = sql.match(/\\echo (proof_[a-f0-9_]+)/)?.[1]
          if (marker) stdout.write(`${marker}\n`)
          if (sql.includes('\\q')) close()
        })
        done()
      }, final(done) { queueMicrotask(close); done() } }),
    })
    if (!args.includes('exec')) queueMicrotask(() => {
      stdout.write(args[0] === 'inspect' ? (options.wrongTarget ? 'other' : target.project)
        : args[0] === 'port' ? target.ports : status)
      close()
    })
    return child
  }
  return { factory, calls }
}

afterEach(() => vi.restoreAllMocks())

describe('retained roster advisory exclusion proof source', () => {
  it('is import-safe and rejects unknown or repeated flags', () => {
    expect(parseLockProofArgs([])).toEqual({ forceFailure: false })
    expect(parseLockProofArgs(['--force-failure'])).toEqual({ forceFailure: true })
    expect(() => parseLockProofArgs(['--db-url', 'private'])).toThrow()
    expect(() => parseLockProofArgs(['--force-failure', '--force-failure'])).toThrow()
  })

  it('allows canonical default bindings but rejects wrong labels, ports, remote API/DB and malformed status', () => {
    expect(() => validateLocalTarget(target)).not.toThrow()
    expect(() => validateLocalTarget({ ...target, ports: '0.0.0.0:54322\n[::]:54322' })).not.toThrow()
    for (const invalid of [
      { ...target, project: 'other' }, { ...target, ports: '192.0.2.1:54322' },
      { ...target, ports: '127.0.0.1:54323' }, { ...target, status: 'invalid' },
      { ...target, status: JSON.stringify({ API_URL: 'https://hosted.invalid', DB_URL: 'postgres://localhost:54322/postgres' }) },
      { ...target, status: JSON.stringify({ API_URL: 'http://127.0.0.1:54321', DB_URL: 'postgres://remote.invalid:54322/postgres' }) },
    ]) expect(() => validateLocalTarget(invalid)).toThrow()
  })

  it('fails target checks before starting any psql child', async () => {
    const h = harness({ wrongTarget: true })
    await expect(runRetainedRosterGroupLockProof({ factory: h.factory })).rejects.toThrow()
    expect(h.calls.some(call => call.args.includes('psql'))).toBe(false)
  })

  it('sequences observed readiness, exact busy checks, rollback and owner denial with two proof sessions', async () => {
    const h = harness()
    await runRetainedRosterGroupLockProof({ factory: h.factory })
    const sessions = h.calls.filter(call => call.args.includes('psql'))
    expect(sessions).toHaveLength(2)
    const locker = sessions.find(call => call.args.some(arg => arg.endsWith('_locker')))!
    const contender = sessions.find(call => call.args.some(arg => arg.endsWith('_contender')))!
    const sql = contender.sql.join('\n')
    expect(locker.sql.join('\n')).toContain('private.try_lock_classroom_membership_change(')
    expect(locker.sql.join('\n')).toContain('ROLLBACK;')
    expect(sql).toContain("errcode='40001'")
    expect(sql).toContain('classroom_operation_busy')
    expect(sql).toContain('student_operation_busy')
    expect(sql).toContain("errcode='42501'")
    expect(sql).toContain('student_provider_cleanup_forbidden')
    expect(sql).toContain('set local role service_role')
    expect(sql).toContain("n.nspname in ('public','private','storage')")
    expect(sql).toContain('pg_settings')
    expect(sql).toContain('guard_pal_membership_evidence')
    expect(sql.indexOf('classroom_operation_busy')).toBeLessThan(sql.indexOf("errcode='42501'"))
    expect(sql.match(/PROOF_FINGERPRINT:/g)).toHaveLength(2)
    expect(sql).not.toMatch(/\b(insert into|update public|delete from|drop|disable trigger|create table|create function)\b/i)
  })

  it('rejects before/after drift without disclosing captured data', async () => {
    const h = harness({ drift: true })
    await expect(runRetainedRosterGroupLockProof({ factory: h.factory })).rejects.toThrow('Proof baseline changed')
  })

  it('closes both owned sessions on forced failure and terminates only owned backend names', async () => {
    const h = harness()
    await expect(runRetainedRosterGroupLockProof({ factory: h.factory, forceFailure: true })).rejects.toThrow('Forced proof failure')
    const sessions = h.calls.filter(call => call.args.includes('psql'))
    expect(sessions.slice(0, 2).every(call => call.sql.join('\n').includes('ROLLBACK;'))).toBe(true)
  })

  it('bounds readiness and child failures, killing owned children and containing private errors', async () => {
    for (const options of [{ hang: true }, { fail: true }]) {
      const h = harness(options)
      const promise = runRetainedRosterGroupLockProof({ factory: h.factory, deadlines: { commandMs: 30, statementMs: 30, closeMs: 15, totalMs: 150 } })
      await expect(promise).rejects.toThrow(/Proof session|Proof deadline/)
      expect(h.calls.filter(call => call.args.includes('psql')).slice(0, 2)
        .every(call => call.sql.join('\n').includes('ROLLBACK;') || call.kills.length > 0)).toBe(true)
      expect(h.calls.some(call => call.args.join(' ').includes('pg_terminate_backend'))).toBe(true)
    }
  })
})
