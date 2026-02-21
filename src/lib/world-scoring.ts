import type { WeeklyTier } from './world-rules'
import { SPECIAL_MIN_ENABLED_BUCKETS } from './world-rules'

export const WEEKLY_BUCKET_MAX = {
  attendance: 4,
  assignment: 3,
  care: 3,
} as const

export const BASE_XP = {
  attendance_present: 5,
  assignment_submitted_on_time: 8,
  assignment_submitted_late: 2,
  daily_care_claimed: 3,
} as const

export const WEEKLY_BONUS_XP: Record<WeeklyTier, number> = {
  baseline: 5,
  nicer: 12,
  special: 20,
}

export const WEEKLY_TRACK_POINTS: Record<WeeklyTier, number> = {
  baseline: 0,
  nicer: 1,
  special: 2,
}

export const TRACK_POINTS_PER_LEVEL = 4

export type WeeklyBuckets = {
  attendance?: number
  assignment?: number
  care?: number
}

export function scoreAttendanceRatio(ratio: number): number {
  if (ratio >= 0.9) return 4
  if (ratio >= 0.75) return 3
  if (ratio >= 0.5) return 2
  if (ratio >= 0.25) return 1
  return 0
}

export function scoreOnTimeSubmissions(count: number): number {
  return Math.max(0, Math.min(WEEKLY_BUCKET_MAX.assignment, count))
}

export function scoreDailyCareConsistency(ratio: number): number {
  if (ratio >= 0.85) return 3
  if (ratio >= 0.6) return 2
  if (ratio >= 0.3) return 1
  return 0
}

export function summarizeWeeklyBuckets(buckets: WeeklyBuckets): {
  attendancePoints: number
  assignmentPoints: number
  carePoints: number
  earnedPoints: number
  availablePoints: number
  enabledBucketCount: number
  weeklyPct: number
} {
  const attendanceEnabled = buckets.attendance !== undefined
  const assignmentEnabled = buckets.assignment !== undefined
  const careEnabled = buckets.care !== undefined

  const attendancePoints = buckets.attendance ?? 0
  const assignmentPoints = buckets.assignment ?? 0
  const carePoints = buckets.care ?? 0

  const availablePoints =
    (attendanceEnabled ? WEEKLY_BUCKET_MAX.attendance : 0) +
    (assignmentEnabled ? WEEKLY_BUCKET_MAX.assignment : 0) +
    (careEnabled ? WEEKLY_BUCKET_MAX.care : 0)

  const earnedPoints = attendancePoints + assignmentPoints + carePoints
  const enabledBucketCount = Number(attendanceEnabled) + Number(assignmentEnabled) + Number(careEnabled)
  const weeklyPct = availablePoints === 0 ? 0 : earnedPoints / availablePoints

  return {
    attendancePoints,
    assignmentPoints,
    carePoints,
    earnedPoints,
    availablePoints,
    enabledBucketCount,
    weeklyPct,
  }
}

export function resolveWeeklyTier(weeklyPct: number, enabledBucketCount: number): WeeklyTier {
  if (weeklyPct >= 0.75 && enabledBucketCount >= SPECIAL_MIN_ENABLED_BUCKETS) {
    return 'special'
  }
  if (weeklyPct >= 0.4) {
    return 'nicer'
  }
  return 'baseline'
}

