import { describe, expect, it } from 'vitest'
import { auditCiQuota, completeUtcWindow, parseQuotaArguments, summarizeQuotaEvidence } from '../../scripts/check-ci-quota.mjs'

const now = new Date('2026-10-23T19:00:00Z')
const window = completeUtcWindow(now)
const job = (overrides = {}) => ({ id: 1, name: 'Build', status: 'completed', conclusion: 'success',
  runner_id: 11, labels: ['ubuntu-latest'], started_at: '2026-10-20T00:00:00Z',
  completed_at: '2026-10-20T00:01:01Z', ...overrides })
const selfHosted = () => job({ id: 99, name: 'Local', runner_id: 99, labels: ['self-hosted', 'Linux', 'pika-ci'] })
const run = (jobs = [job(), selfHosted()], overrides = {}) => ({ id: 8, status: 'completed',
  created_at: '2026-10-20T00:00:00Z', jobs, ...overrides })
const evidence = (overrides = {}) => ({ repository: { full_name: 'codepetca/pika', private: false, visibility: 'public' },
  window, now, notBefore: '2026-10-10T12:00:00Z', runs: [run()], artifacts: [], billingAvailable: true,
  billingRows: [{ date: '2026-10-20', repositoryName: 'pika', product: 'actions', sku: 'Actions Linux', unitType: 'Minutes', quantity: 0 }], ...overrides })

describe('read-only CI quota audit', () => {
  it('uses seven complete UTC days and rejects malformed, future or unknown options', () => {
    expect(window).toEqual({ start: '2026-10-14T00:00:00.000Z', end_exclusive: '2026-10-21T00:00:00.000Z', days: 7 })
    expect(parseQuotaArguments(['--end', '2026-10-22', '--not-before', '2026-10-10'], now))
      .toMatchObject({ notBefore: '2026-10-10T00:00:00.000Z', window: { end_exclusive: '2026-10-22T00:00:00.000Z' } })
    for (const args of [['--end', '2026-10-24'], ['--not-before', '2026-02-30'], ['--repo', 'other/repo'], ['--end']]) {
      expect(() => parseQuotaArguments(args, now)).toThrow()
    }
  })

  it('rounds each hosted job, deduplicates carried attempts per run and excludes self-hosted compute', () => {
    const carried = job({ id: 2, run_attempt: 2 })
    const result = summarizeQuotaEvidence(evidence({ runs: [run([
      job({ run_attempt: 1 }), carried,
      job({ id: 3, runner_id: 12, labels: ['self-hosted', 'Linux', 'pika-ci'], completed_at: '2026-10-20T01:00:00Z' }),
      job({ id: 4, name: 'Skipped', conclusion: 'skipped', labels: [], runner_id: 0, started_at: null, completed_at: null }),
    ]), run([job()], { id: 9 })] }))
    expect(result).toMatchObject({ status: 'pass', eligible_for_private_review: true,
      hosted: { jobs: 2, rounded_minutes: 4, monthly_projection_30_days: 4 * 30 / 7 },
      jobs: { raw: 5, distinct: 4, carried_duplicates_removed: 1, self_hosted: 1, skipped: 1 } })
  })

  it('requires the observation week to follow activation and the repository to remain public', () => {
    for (const extra of [{ notBefore: null }, { notBefore: '2026-10-14T00:00:01Z' },
      { repository: { full_name: 'codepetca/pika', private: true, visibility: 'private' } }, { runs: [] },
      { runs: [run([job()])] }]) {
      expect(summarizeQuotaEvidence(evidence(extra))).toMatchObject({ status: 'inconclusive', eligible_for_private_review: false })
    }
  })

  it('refuses missing job evidence, unknown billing labels, invalid timestamps and in-flight work', () => {
    for (const jobs of [null, [], [job({ labels: ['custom-host'] })], [job({ labels: ['windows-latest'] })],
      [job({ started_at: null })], [job({ status: 'in_progress', completed_at: null })],
      [job({ runner_id: null })], [job({ completed_at: '2026-10-19T00:00:00Z' })]]) {
      expect(summarizeQuotaEvidence(evidence({ runs: [run(jobs as never)] })))
        .toMatchObject({ status: 'inconclusive', eligible_for_private_review: false })
    }
  })

  it('counts retained artifacts across all runs, excludes expired objects, and enforces both targets', () => {
    const artifacts = [{ id: 1, expired: false, size_in_bytes: 250_000_001 }, { id: 2, expired: true, size_in_bytes: 9e9 }]
    expect(summarizeQuotaEvidence(evidence({ artifacts }))).toMatchObject({ status: 'fail',
      eligible_for_private_review: false, artifacts: { unexpired_bytes: 250_000_001, unexpired_count: 1, headroom_bytes: -1 } })
    expect(summarizeQuotaEvidence(evidence({ runs: [run([job({ completed_at: '2026-10-20T04:00:00Z' }), selfHosted()])] })))
      .toMatchObject({ status: 'fail', eligible_for_private_review: false, hosted: { rounded_minutes: 240 } })
    expect(summarizeQuotaEvidence(evidence({ artifacts: [{ expired: false }] }))).toMatchObject({ status: 'inconclusive' })
  })

  it('counts skipped whole workflows as zero execution while still requiring observed self-hosted work', () => {
    expect(summarizeQuotaEvidence(evidence({ runs: [run(), run([], { id: 10, conclusion: 'skipped' })] })))
      .toMatchObject({ status: 'pass', runs: 2, skipped_runs: 1, jobs: { raw: 2, self_hosted: 1 } })
    expect(summarizeQuotaEvidence(evidence({ runs: [run([], { conclusion: 'skipped' })] })))
      .toMatchObject({ status: 'inconclusive', evidence: { issues: { no_observed_self_hosted_execution: 1 } } })
  })

  it('recognizes cancelled jobs that never received a runner and empty cancelled workflows as zero execution', () => {
    const cancelled = (overrides = {}) => job({ id: 50, name: 'Never assigned', conclusion: 'cancelled',
      runner_id: null, runner_name: null, runner_group_id: null, runner_group_name: null, steps: [],
      started_at: null, completed_at: null, ...overrides })
    const result = summarizeQuotaEvidence(evidence({ runs: [run([
      job(), selfHosted(), cancelled(), cancelled({ id: 51, runner_id: 0, runner_name: '',
        runner_group_id: 0, runner_group_name: '', started_at: '2026-10-20T00:00:00Z', completed_at: '2026-10-20T00:00:01Z' }),
    ]), run([], { id: 10, conclusion: 'cancelled' })] }))
    expect(result).toMatchObject({ status: 'pass', cancelled_unassigned_runs: 1,
      jobs: { cancelled_unassigned: 2 }, hosted: { jobs: 1, rounded_minutes: 2 } })
    for (const extra of [{ runner_id: undefined }, { runner_id: '0' }, { runner_id: -1 }, { runner_name: 'assigned-runner' },
      { runner_name: false }, { runner_group_id: '0' }, { runner_group_name: 'unexpected' },
      { steps: [{ name: 'Set up job' }] }, { steps: null }, { status: 'in_progress' }, { conclusion: 'failure' }]) {
      expect(summarizeQuotaEvidence(evidence({ runs: [run([job(), selfHosted(), cancelled(extra)])] })))
        .toMatchObject({ status: 'inconclusive', eligible_for_private_review: false })
    }
  })

  it('bills assigned cancelled jobs even with no steps and still requires their duration evidence', () => {
    const assigned = job({ id: 50, conclusion: 'cancelled', runner_name: 'assigned-runner', steps: [] })
    expect(summarizeQuotaEvidence(evidence({ runs: [run([assigned, selfHosted()])] })))
      .toMatchObject({ status: 'pass', jobs: { cancelled_unassigned: 0 }, hosted: { jobs: 1, rounded_minutes: 2 } })
    expect(summarizeQuotaEvidence(evidence({ runs: [run([{ ...assigned, started_at: null }, selfHosted()])] })))
      .toMatchObject({ status: 'inconclusive', evidence: { issues: { missing_job_duration_or_identity: 1 } } })
  })

  it('uses the larger billing ledger total, including older-run reruns, and fails closed on unsupported billing', () => {
    const row = evidence().billingRows[0]
    const result = summarizeQuotaEvidence(evidence({ billingRows: [
      { ...row, quantity: 285 },
      { ...row, repositoryName: 'another-repository', quantity: 50_000 },
      { ...row, sku: 'Actions storage', unitType: 'GigabyteHours', quantity: 99_000 },
    ] }))
    expect(result).toMatchObject({ status: 'fail', hosted: { rounded_minutes: 2,
      billing_ledger_minutes: 285, conservative_minutes: 285, monthly_projection_30_days: 285 * 30 / 7 } })
    for (const extra of [{ billingAvailable: false }, { billingRows: [] },
      { billingRows: [{ ...row, sku: 'Actions Windows' }] },
      { billingRows: [{ ...row, unitType: 'Seconds' }] },
      { billingRows: [{ ...row, quantity: -1 }] }]) {
      expect(summarizeQuotaEvidence(evidence(extra))).toMatchObject({ status: 'inconclusive', eligible_for_private_review: false })
    }
  })

  it('marks recent explicit windows inconclusive rather than claiming settled billing', () => {
    const recent = completeUtcWindow(now, '2026-10-23')
    expect(summarizeQuotaEvidence(evidence({ window: recent }))).toMatchObject({ status: 'inconclusive',
      evidence: { issues: { window_incomplete_or_billing_freshness_gap: 1 } } })
  })

  it('paginates daily run queries, all job attempts and retained artifacts through an injectable provider', async () => {
    const calls: string[] = []
    const provider = async (path: string) => {
      calls.push(path)
      if (path === '/repos/codepetca/pika') return evidence().repository
      if (path.includes('/actions/runs?')) {
        const selected = path.includes('2026-10-20T00')
        return { total_count: selected ? 1 : 0, workflow_runs: selected ? [run()] : [] }
      }
      if (path.includes('/jobs?')) return { total_count: 2, jobs: [job(), selfHosted()] }
      if (path.includes('/settings/billing/usage?')) return { usageItems: evidence().billingRows }
      if (path.includes('/artifacts?')) return { total_count: 101,
        artifacts: Array.from({ length: path.includes('page=2') ? 1 : 100 }, (_, i) => ({
          id: (path.includes('page=2') ? 100 : 0) + i, expired: false, size_in_bytes: 1,
        })) }
      throw new Error('unexpected path')
    }
    const result = await auditCiQuota({ provider, now, window, notBefore: '2026-10-10' })
    expect(result).toMatchObject({ status: 'pass', runs: 1, artifacts: { unexpired_count: 101, unexpired_bytes: 101 } })
    expect(calls.filter(path => path.includes('/actions/runs?'))).toHaveLength(7)
    expect(calls.find(path => path.includes('/jobs?'))).toContain('filter=all')
    expect(calls.filter(path => path.includes('/artifacts?'))).toHaveLength(2)
  })

  it('rejects capped run searches, short pagination, duplicate IDs and changing totals', async () => {
    for (const invalid of [
      { total_count: 1000, workflow_runs: [] },
      { total_count: 2, workflow_runs: [run()] },
      { total_count: 2, workflow_runs: [run(), run()] },
    ]) {
      await expect(auditCiQuota({ provider: async (path: string) => path === '/repos/codepetca/pika'
        ? evidence().repository : invalid, now, window })).rejects.toThrow()
    }
    await expect(auditCiQuota({ provider: async (path: string) => {
      if (path === '/repos/codepetca/pika') return evidence().repository
      return { total_count: path.includes('page=2') ? 102 : 101,
        workflow_runs: Array.from({ length: 100 }, (_, id) => run([], { id })) }
    }, now, window })).rejects.toThrow('Changing or capped')
  })

  it('fetches each billing month across a boundary and reports ledger access failure without passing', async () => {
    const paths: string[] = []
    const crossMonth = completeUtcWindow(new Date('2026-11-05T12:00:00Z'))
    const result = await auditCiQuota({ now: new Date('2026-11-05T12:00:00Z'), window: crossMonth,
      notBefore: '2026-10-01', provider: async (path: string) => {
        paths.push(path)
        if (path === '/repos/codepetca/pika') return evidence().repository
        if (path.includes('/actions/runs?')) return { total_count: 0, workflow_runs: [] }
        if (path.includes('/artifacts?')) return { total_count: 0, artifacts: [] }
        if (path.includes('month=10')) return { usageItems: [] }
        throw new Error('private authentication failure must not reach report')
      } })
    expect(paths.filter(path => path.includes('/billing/usage?'))).toEqual([
      '/organizations/codepetca/settings/billing/usage?year=2026&month=10',
      '/organizations/codepetca/settings/billing/usage?year=2026&month=11',
    ])
    expect(result).toMatchObject({ status: 'inconclusive', eligible_for_private_review: false,
      evidence: { issues: { billing_ledger_unavailable: 1 } } })
    expect(JSON.stringify(result)).not.toContain('private authentication')
  })
})
