import { describe, expect, it } from 'vitest'
import { distinctJobExecutions, summarizeCiRuns } from '../../scripts/measure-ci-performance.mjs'

describe('CI performance measurement', () => {
  it('reports queue, run, wall, cancellation, and conclusion evidence', () => {
    const summary = summarizeCiRuns([
      {
        status: 'completed',
        conclusion: 'success',
        createdAt: '2026-08-28T12:00:00Z',
        startedAt: '2026-08-28T12:01:00Z',
        updatedAt: '2026-08-28T12:06:00Z',
        prGate: {
          mode: 'docs-only',
          startedAt: '2026-08-28T12:05:00Z',
          completedAt: '2026-08-28T12:06:00Z',
        },
      },
      {
        status: 'completed',
        conclusion: 'success',
        createdAt: '2026-08-28T13:00:00Z',
        startedAt: '2026-08-28T13:00:00Z',
        updatedAt: '2026-08-28T13:08:00Z',
        prGate: {
          mode: 'full',
          startedAt: '2026-08-28T13:07:00Z',
          completedAt: '2026-08-28T13:08:00Z',
        },
      },
      {
        status: 'completed',
        conclusion: 'cancelled',
        createdAt: '2026-08-28T14:00:00Z',
        startedAt: '2026-08-28T14:00:00Z',
        updatedAt: '2026-08-28T14:02:00Z',
      },
    ])

    expect(summary).toMatchObject({
      sampleSize: 3,
      successfulSampleSize: 2,
      counts: { cancelled: 1, success: 2 },
      cancellationRate: 1 / 3,
      cancelledElapsedSeconds: 120,
      successfulQueueSeconds: { min: 0, max: 60 },
      successfulRunSeconds: { min: 300, max: 480 },
      successfulWallSeconds: { min: 360, max: 480 },
      successfulRunsWithoutPrGateEvidence: 0,
      prGateByMode: {
        'docs-only': {
          sampleSize: 1,
          timeToGateStartSeconds: { p50: 300 },
          gateRunSeconds: { p50: 60 },
          timeToGatePassSeconds: { p50: 360 },
        },
        full: {
          sampleSize: 1,
          timeToGateStartSeconds: { p50: 420 },
          gateRunSeconds: { p50: 60 },
          timeToGatePassSeconds: { p50: 480 },
        },
      },
    })
  })

  it('returns explicit null metrics for an empty completed sample', () => {
    expect(summarizeCiRuns([])).toMatchObject({
      sampleSize: 0,
      cancellationRate: null,
      successfulWallSeconds: { p50: null, p95: null },
      successfulRunsWithoutPrGateEvidence: 0,
      prGateByMode: {},
    })
  })

  it('separates overlapping runner consumption from workflow time and binds evidence to SHA', () => {
    const job = (name: string, seconds: number) => ({ name, conclusion: 'success', labels: ['ubuntu-latest'],
      started_at: '2026-10-08T12:00:00Z', completed_at: `2026-10-08T12:${String(seconds / 60).padStart(2, '0')}:00Z`,
      steps: [{ name: 'Start ephemeral Supabase and replay migrations', conclusion: 'success',
        started_at: '2026-10-08T12:00:00Z', completed_at: '2026-10-08T12:01:00Z' }] })
    const summary = summarizeCiRuns([{ databaseId: 7, headSha: 'abc', status: 'completed', conclusion: 'success',
      createdAt: '2026-10-08T12:00:00Z', startedAt: '2026-10-08T12:00:00Z', updatedAt: '2026-10-08T12:10:00Z',
      prGate: { mode: 'full', startedAt: '2026-10-08T12:09:00Z', completedAt: '2026-10-08T12:10:00Z' },
      jobs: [job('Database', 600), job('Browser', 480)] }])
    expect(summary.successfulWallSeconds.p50).toBe(600)
    expect(summary.runEvidence).toEqual([{ runId: 7, headSha: 'abc', latestAttempt: null, executionAttempts: [], mode: 'full', conclusion: 'success',
      timedJobs: 2, runnerSeconds: 1080, failedSteps: [] }])
    expect(summary.successfulJobTimings).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: 'full', job: 'Database', runner: 'hosted', sampleSize: 1, seconds: expect.objectContaining({ p50: 600 }) }),
    ]))
    expect(summary.successfulStepTimings[0].seconds.p50).toBe(60)
  })

  it('counts cancelled runner time, preserves failure signals, and reports unavailable timing', () => {
    const common = { status: 'completed', createdAt: '2026-10-08T12:00:00Z',
      startedAt: '2026-10-08T12:00:00Z', updatedAt: '2026-10-08T12:05:00Z' }
    const summary = summarizeCiRuns([
      { ...common, conclusion: 'cancelled', jobs: [
        { name: 'Database', conclusion: 'cancelled', started_at: common.startedAt, completed_at: common.updatedAt },
        { name: 'Browser', conclusion: 'cancelled', started_at: 'invalid', completed_at: common.updatedAt },
        { name: 'Skipped', conclusion: 'skipped' },
      ] },
      { ...common, conclusion: 'failure', jobs: [{ name: 'Database', conclusion: 'failure',
        started_at: common.startedAt, completed_at: common.updatedAt,
        steps: [{ name: 'Proof', conclusion: 'failure', completed_at: common.updatedAt }] }] },
      { ...common, conclusion: 'success', jobs: null },
    ])
    expect(summary).toMatchObject({ cancelledJobSeconds: 300, missingJobDurations: 1,
      runsWithoutJobEvidence: 1, successfulJobTimings: [], successfulStepTimings: [] })
    expect(summary.runEvidence[1]).toMatchObject({ mode: 'unknown', headSha: null,
      failedSteps: [{ job: 'Database', step: 'Proof', attempt: null, timeToFailureSeconds: 300 }] })
    expect(summary.missingStepDurations).toBe(1)
  })

  it('retains earlier failed attempts without charging carried-over successes twice', () => {
    const carried = { name: 'Build', runner_id: 10, labels: ['ubuntu-latest'], conclusion: 'success',
      started_at: '2026-10-08T12:00:00Z', completed_at: '2026-10-08T12:01:00Z' }
    const failed = { name: 'Browser', runner_id: 11, run_attempt: 1, conclusion: 'failure',
      started_at: '2026-10-08T12:00:00Z', completed_at: '2026-10-08T12:05:00Z',
      steps: [{ name: 'Browser tests', conclusion: 'failure', started_at: '2026-10-08T12:01:00Z', completed_at: '2026-10-08T12:05:00Z' }] }
    const retry = { ...failed, runner_id: 12, run_attempt: 2, conclusion: 'success',
      started_at: '2026-10-08T12:10:00Z', completed_at: '2026-10-08T12:15:00Z', steps: [] }
    const jobs = [retry, { ...carried, id: 3, run_attempt: 2 }, failed, { ...carried, id: 1, run_attempt: 1 }]
    expect(distinctJobExecutions(jobs)).toHaveLength(3)
    const summary = summarizeCiRuns([{ status: 'completed', conclusion: 'success', attempt: 2, headSha: 'same-sha',
      createdAt: '2026-10-08T12:00:00Z', startedAt: retry.started_at, updatedAt: retry.completed_at, jobs }])
    expect(summary.earlierFailedJobSeconds).toBe(300)
    expect(summary.runEvidence[0]).toMatchObject({ headSha: 'same-sha', latestAttempt: 2, executionAttempts: [1, 2],
      runnerSeconds: 660, timedJobs: 3, failedSteps: [{ job: 'Browser', step: 'Browser tests', attempt: 1, timeToFailureSeconds: 300 }] })
    expect(summary.successfulJobTimings.find(row => row.job === 'Build')?.sampleSize).toBe(1)
  })

  it('preserves job evidence when workflow timestamps are missing, invalid or reversed', () => {
    const jobs = [{ name: 'Database', conclusion: 'cancelled', started_at: '2026-10-08T12:00:00Z', completed_at: '2026-10-08T12:04:00Z' }]
    const summary = summarizeCiRuns([
      { status: 'completed', conclusion: 'cancelled', createdAt: '2026-10-08T12:00:00Z', updatedAt: '2026-10-08T12:04:00Z', jobs },
      { status: 'completed', conclusion: 'success', createdAt: 'bad', startedAt: '2026-10-08T12:04:00Z', updatedAt: '2026-10-08T12:00:00Z', jobs: [] },
    ])
    expect(summary).toMatchObject({ sampleSize: 2, cancelledJobSeconds: 240, cancelledElapsedSeconds: 0,
      cancelledRunsWithoutElapsedEvidence: 1, missingJobDurations: 0, runsWithoutJobEvidence: 0,
      successfulWallSeconds: { p50: null, sampleSize: 0, missingSamples: 1 },
      successfulRunSeconds: { p50: null, missingSamples: 1 } })
    expect(summary.runEvidence).toHaveLength(2)
  })
})
