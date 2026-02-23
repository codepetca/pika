import { describe, expect, it } from 'vitest'
import {
  resolveWeeklyTier,
  scoreAttendanceRatio,
  scoreDailyCareConsistency,
  scoreOnTimeSubmissions,
  summarizeWeeklyBuckets,
} from '@/lib/world-scoring'

describe('scoreAttendanceRatio', () => {
  it('uses approved thresholds', () => {
    expect(scoreAttendanceRatio(0.95)).toBe(4)
    expect(scoreAttendanceRatio(0.8)).toBe(3)
    expect(scoreAttendanceRatio(0.55)).toBe(2)
    expect(scoreAttendanceRatio(0.3)).toBe(1)
    expect(scoreAttendanceRatio(0.1)).toBe(0)
  })
})

describe('scoreOnTimeSubmissions', () => {
  it('caps at 3 points', () => {
    expect(scoreOnTimeSubmissions(0)).toBe(0)
    expect(scoreOnTimeSubmissions(2)).toBe(2)
    expect(scoreOnTimeSubmissions(7)).toBe(3)
  })
})

describe('scoreDailyCareConsistency', () => {
  it('uses approved thresholds', () => {
    expect(scoreDailyCareConsistency(0.9)).toBe(3)
    expect(scoreDailyCareConsistency(0.7)).toBe(2)
    expect(scoreDailyCareConsistency(0.4)).toBe(1)
    expect(scoreDailyCareConsistency(0.1)).toBe(0)
  })
})

describe('summarizeWeeklyBuckets', () => {
  it('normalizes by enabled buckets only', () => {
    const summary = summarizeWeeklyBuckets({
      attendance: 4,
      care: 2,
    })
    expect(summary.availablePoints).toBe(7)
    expect(summary.earnedPoints).toBe(6)
    expect(summary.weeklyPct).toBeCloseTo(6 / 7, 5)
    expect(summary.enabledBucketCount).toBe(2)
  })
})

describe('resolveWeeklyTier', () => {
  it('respects special guard of >=2 buckets', () => {
    expect(resolveWeeklyTier(0.8, 1)).toBe('nicer')
    expect(resolveWeeklyTier(0.8, 2)).toBe('special')
    expect(resolveWeeklyTier(0.5, 2)).toBe('nicer')
    expect(resolveWeeklyTier(0.2, 3)).toBe('baseline')
  })
})

