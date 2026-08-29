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
      },
      {
        status: 'completed',
        conclusion: 'success',
        createdAt: '2026-08-28T13:00:00Z',
        startedAt: '2026-08-28T13:00:00Z',
        updatedAt: '2026-08-28T13:08:00Z',
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
    })
  })

  it('returns explicit null metrics for an empty completed sample', () => {
    expect(summarizeCiRuns([])).toMatchObject({
      sampleSize: 0,
      cancellationRate: null,
      successfulWallSeconds: { p50: null, p95: null },
    })
  })
})
