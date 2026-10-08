import { describe, expect, it, vi } from 'vitest'
import { createPlan, parseHistory, parseDryRun, validateInputs, verifyCi, checkoutSha, hash, RUNTIME_CONFIG, AUTH_STRATEGY, verifyApproval } from '../../scripts/migration-rollout-policy.mjs'
import { executeRollout } from '../../scripts/migration-rollout.mjs'

const sha = 'a'.repeat(40)
const project = 'abcdefghijklmnopqrst'
const inputs = { mode: 'preview', target: 'production', sourceSha: sha, ciRunId: '123', projectRef: project, boundTarget: 'production', runAttempt: '1', approvedDigest: '', approvedMigrations: '', confirmation: '', impact: '' }
const files = [{ version: '001', name: '001_first.sql', hash: 'b'.repeat(64) }, { version: '002', name: '002_next.sql', hash: 'c'.repeat(64) }]
const table = ' Local | Remote | Time (UTC)\n-------|--------|-----------\n 001 | 001 | 001\n 002 | | 002\n'
const dry = 'DRY RUN: migrations will *not* be pushed to the database.\nWould push these migrations:\n • 002_next.sql\nFinished supabase db push.\n'
const history = [{ local: '001', remote: '001' }, { local: '002', remote: '' }]
const run = { id: 123, name: 'CI', path: '.github/workflows/ci.yml', repository: { full_name: 'codepetca/pika' }, head_repository: { full_name: 'codepetca/pika' }, event: 'pull_request', status: 'completed', conclusion: 'success', run_attempt: 1 }
const jobs = [
  { id: 1, name: 'Architecture Database Contracts', conclusion: 'success', steps: [{ name: 'Start ephemeral Supabase and replay migrations', conclusion: 'success' }, { name: 'Check generated database types', conclusion: 'success' }] },
  { id: 2, name: 'Test & Build', conclusion: 'success', steps: [{ name: 'Run tests with coverage', conclusion: 'success' }, { name: 'Build production bundle', conclusion: 'success' }] },
  { id: 3, name: 'PR Gate', conclusion: 'success', steps: [] },
]
const checkoutLog = `2026-09-30T12:00:00.000Z [command]/usr/bin/git log -1 --format=%H\n2026-09-30T12:00:00.001Z ${sha}\n`
const plan = () => createPlan(inputs, files, history, ['002_next.sql'], 'd'.repeat(40))
const approved = () => ({ ...inputs, mode: 'apply', approvedDigest: plan().digest, approvedMigrations: '002', confirmation: `APPLY production ${sha}`, impact: 'I reviewed the SQL and acknowledge all destructive or irreversible effects.' })

function fakeIo() {
  return {
    prepare: vi.fn(async () => ({ files, schemaTree: 'd'.repeat(40) })),
    ci: vi.fn(async () => undefined),
    link: vi.fn(async () => undefined),
    history: vi.fn(async () => history),
    preview: vi.fn(async () => ['002_next.sql']),
    apply: vi.fn(async () => undefined),
    report: vi.fn(async () => undefined),
  }
}

describe('migration rollout authorization', () => {
  it.each(['x', 'a'.repeat(39), `$(touch /tmp/pwn)`, sha + '\n', '../main'])('rejects unsafe source SHA %s', (sourceSha) => {
    expect(() => validateInputs({ ...inputs, sourceSha })).toThrow()
  })
  it('rejects missing CI, target rebinding, unknown mode, and application reruns', () => {
    for (const overrides of [{ ciRunId: '' }, { boundTarget: 'staging' }, { target: 'local' }, { projectRef: 'url' }, { mode: 'reset' }, { ...approved(), runAttempt: '2' }]) {
      expect(() => validateInputs({ ...inputs, ...overrides })).toThrow()
    }
    expect(validateInputs(inputs).sourceSha).toBe(sha)
  })
  it('requires exact digest, exact SHA/target confirmation, explicit SQL impact acknowledgement and versions', () => {
    for (const overrides of [{ approvedDigest: '' }, { approvedMigrations: '' }, { confirmation: 'yes' }, { impact: '' }]) {
      expect(() => validateInputs({ ...approved(), ...overrides })).toThrow()
    }
  })
  it('binds project, target, SHA, all file hashes, schema tree and full history into the digest', () => {
    for (const [candidateInputs, candidateFiles, candidateHistory, tree] of [
      [{ ...inputs, projectRef: 'z'.repeat(20) }, files, history, 'd'.repeat(40)],
      [{ ...inputs, target: 'other' }, files, history, 'd'.repeat(40)],
      [{ ...inputs, sourceSha: 'e'.repeat(40) }, files, history, 'd'.repeat(40)],
      [inputs, [{ ...files[0], hash: 'f'.repeat(64) }, files[1]], history, 'd'.repeat(40)],
      [inputs, files, [{ local: '001', remote: '001' }, { local: '002', remote: '002' }], 'd'.repeat(40)],
      [inputs, files, history, 'e'.repeat(40)],
    ] as any[]) {
      const pending = candidateHistory[1].remote ? [] : ['002_next.sql']
      expect(createPlan(candidateInputs, candidateFiles, candidateHistory, pending, tree).digest).not.toBe(plan().digest)
    }
  })
  it('binds the trusted runtime configuration and rejects an approved digest after its change', () => {
    const original = plan()
    const changed = createPlan(inputs, files, history, ['002_next.sql'], 'd'.repeat(40), hash(RUNTIME_CONFIG.replace('major_version = 17', 'major_version = 18')))
    expect(changed.digest).not.toBe(original.digest)
    expect(original.runtimeConfigHash).toBe(hash(RUNTIME_CONFIG))
  })
  it('binds temporary authentication and invalidates permanent-password approvals', () => {
    const current = plan()
    expect(current.format).toBe(2)
    expect(current.auth).toBe(AUTH_STRATEGY)
    const { digest, auth, ...binding } = current
    const oldDigest = hash(JSON.stringify({ ...binding, format: 1 }))
    expect(() => verifyApproval({ ...approved(), approvedDigest: oldDigest }, current)).toThrow('obtain new approval')
  })
  it('requires the complete pending set and a matching remote prefix', () => {
    for (const badHistory of [history.slice(0, 1), [...history, { local: '', remote: '999' }], [{ local: '001', remote: '' }, { local: '002', remote: '002' }], [{ local: '001', remote: '002' }, history[1]]]) {
      expect(() => createPlan(inputs, files, badHistory, ['002_next.sql'], 'd'.repeat(40))).toThrow()
    }
    expect(() => createPlan(inputs, files, history, [], 'd'.repeat(40))).toThrow()
    expect(() => createPlan(inputs, files, history, ['002_next.sql', '999_bad.sql'], 'd'.repeat(40))).toThrow()
  })
})

describe('private CLI and CI evidence parsers', () => {
  it('parses only explicit numeric history rows, rejecting malformed/duplicate data', () => {
    expect(parseHistory(table)).toEqual(history)
    for (const output of ['', 'SQL error secret', table + ' invalid | 002 | x', table + ' 002 | | 002']) expect(() => parseHistory(output)).toThrow()
  })
  it('parses the dry-run filename list and an explicit no-op, rejecting unexpected output', () => {
    expect(parseDryRun(dry)).toEqual(['002_next.sql'])
    expect(parseDryRun('Initialising login role...\n' + dry)).toEqual(['002_next.sql'])
    expect(() => parseDryRun(dry + 'Initialising login role...')).toThrow()
    expect(parseDryRun('Remote database is up to date.')).toEqual([])
    for (const output of ['', dry + ' • ../../secrets.sql', 'Would push these migrations:\nhello']) expect(() => parseDryRun(output)).toThrow()
  })
  it('extracts an unambiguous historical checkout SHA after the exact checkout command', () => {
    expect(checkoutSha(checkoutLog)).toBe(sha)
    expect(checkoutSha(`[command]/usr/bin/git log -1 --format=%H\n${sha}\n`)).toBe(sha)
    for (const output of [sha, checkoutLog + checkoutLog, checkoutLog.replace(sha, 'bad'), checkoutLog.replace('--format=%H', '--oneline')]) expect(() => checkoutSha(output)).toThrow()
  })
  it('requires real replay/test/gate success from the same repository CI', () => {
    expect(() => verifyCi(run, jobs, 'codepetca/pika', '123')).not.toThrow()
    for (const overrides of [{ repository: { full_name: 'evil/pika' } }, { head_repository: { full_name: 'evil/pika' } }, { path: '.github/workflows/evil.yml' }, { event: 'push' }, { conclusion: 'failure' }, { id: 124 }]) expect(() => verifyCi({ ...run, ...overrides }, jobs, 'codepetca/pika', '123')).toThrow()
    for (const brokenJobs of [jobs.slice(0, 2), jobs.map(j => ({ ...j, conclusion: 'skipped' })), jobs.map(j => ({ ...j, steps: j.steps.map(s => ({ ...s, conclusion: 'skipped' })) }))]) expect(() => verifyCi(run, brokenJobs, 'codepetca/pika', '123')).toThrow()
  })
})

describe('rollout with fake CLI and API, never a live database', () => {
  it.each(['preview', 'apply'])('refuses retired staging in %s mode before preparation or target contact', async (mode) => {
    const io = fakeIo()
    await expect(executeRollout({ ...inputs, mode, target: 'staging', boundTarget: 'staging' }, io))
      .rejects.toThrow('Environment target binding mismatch.')
    for (const operation of Object.values(io)) expect(operation).not.toHaveBeenCalled()
  })
  it('previews without applying', async () => {
    const io = fakeIo()
    expect((await executeRollout(inputs, io)).digest).toBe(plan().digest)
    expect(io.apply).not.toHaveBeenCalled()
  })
  it('fails closed on CI tree mismatch before contacting the target', async () => {
    const io = fakeIo()
    io.ci.mockRejectedValue(new Error('CI tree mismatch'))
    await expect(executeRollout(inputs, io)).rejects.toThrow('CI tree mismatch')
    expect(io.link).not.toHaveBeenCalled()
  })
  it.each([{ approvedDigest: 'f'.repeat(64) }, { approvedMigrations: '001' }, { approvedMigrations: '001,002' }])('rejects changed approval %s without applying', async (overrides) => {
    const io = fakeIo()
    await expect(executeRollout({ ...approved(), ...overrides }, io)).rejects.toThrow()
    expect(io.apply).not.toHaveBeenCalled()
  })
  it('rechecks the full history immediately before apply and stops on drift', async () => {
    const io = fakeIo()
    io.history.mockResolvedValueOnce(history).mockResolvedValueOnce([{ local: '001', remote: '001' }, { local: '002', remote: '002' }])
    await expect(executeRollout(approved(), io)).rejects.toThrow()
    expect(io.apply).not.toHaveBeenCalled()
  })
  it('applies once and verifies the exact durable history', async () => {
    const io = fakeIo()
    io.history.mockResolvedValueOnce(history).mockResolvedValueOnce(history).mockResolvedValueOnce(files.map(f => ({ local: f.version, remote: f.version })))
    const result = await executeRollout(approved(), io)
    expect(result.status).toBe('applied-verified')
    expect(io.apply).toHaveBeenCalledTimes(1)
  })
  it('reports durable partial failure and never retries an application', async () => {
    const io = fakeIo()
    io.apply.mockRejectedValue(new Error('secret SQL data'))
    await expect(executeRollout(approved(), io)).rejects.toThrow('Application failed; durable history recorded. Obtain new approval before another attempt.')
    expect(io.apply).toHaveBeenCalledTimes(1)
    expect(io.history).toHaveBeenCalledTimes(3)
    expect(io.report).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'apply-failed', durableHistory: history }))
  })
  it.each([true, false])('reports unknown durable state after an unreadable post-history without retrying (apply failed: %s)', async (failed) => {
    const io = fakeIo()
    if (failed) io.apply.mockRejectedValue(new Error('private SQL data'))
    io.history.mockResolvedValueOnce(history).mockResolvedValueOnce(history).mockRejectedValueOnce(new Error('private database error'))
    const expected = failed
      ? 'Application failed; durable state is unknown. Obtain new approval before another attempt.'
      : 'Application command completed; durable state is unknown. Obtain new approval before another attempt.'
    await expect(executeRollout(approved(), io)).rejects.toThrow(expected)
    expect(io.apply).toHaveBeenCalledTimes(1)
    expect(io.history).toHaveBeenCalledTimes(3)
    expect(io.report).toHaveBeenLastCalledWith(expect.objectContaining({ status: failed ? 'apply-failed' : 'verification-failed', durableHistory: null }))
  })
  it('fails verification after apparent CLI success with incomplete durable history', async () => {
    const io = fakeIo()
    await expect(executeRollout(approved(), io)).rejects.toThrow('Application state could not be verified')
    expect(io.apply).toHaveBeenCalledTimes(1)
  })
})
