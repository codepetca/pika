import { describe, expect, it } from 'vitest'
import { summarizeCiRuns } from '../../scripts/measure-ci-performance.mjs'

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
    expect(summary.runEvidence).toEqual([{ runId: 7, headSha: 'abc', mode: 'full', conclusion: 'success',
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
      failedSteps: [{ job: 'Database', step: 'Proof', timeToFailureSeconds: 300 }] })
  })
})
