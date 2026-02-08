import { formatInTimeZone } from 'date-fns-tz'
import type { AssignmentDocHistoryEntry } from '@/types'

// ── Types ──────────────────────────────────────────────────────────

export interface EntryWithDiff {
  entry: AssignmentDocHistoryEntry
  charDiff: number
}

export interface HourGroup {
  hour: number // 0–23
  label: string // e.g. "9a", "2p", "12p"
  entries: EntryWithDiff[] // oldest-first within the hour
}

export interface DayGroup {
  date: string // e.g. "Jan 15"
  hours: HourGroup[] // oldest-hour-first within the day
}

export interface Stem {
  x: number
  height: number // 0–1 normalised
  color: 'success' | 'danger' | 'warning' | 'muted'
  direction: 'up' | 'down'
  entry: AssignmentDocHistoryEntry
  charDiff: number
  isBaseline: boolean
  hasPaste: boolean
}

export interface StemLayout {
  stems: Stem[]
  baselineY: number // pixel y of the zero-line
}

// ── Constants ──────────────────────────────────────────────────────

const TZ = 'America/Toronto'
const WARNING_THRESHOLD = 200
const MAX_DIFF_FOR_SCALE = 200
const STEM_PADDING_X = 2 // px from left/right edges
const STEM_WIDTH = 2
const STEM_GAP = 1 // 1px gap between stems

// ── Pure functions ─────────────────────────────────────────────────

/**
 * Compute char diffs for each entry.
 * Input entries are newest-first (as from DB).
 * Returns oldest-first with charDiff per entry.
 * First entry (oldest) is the baseline — charDiff = 0.
 */
export function computeCharDiffs(
  entries: AssignmentDocHistoryEntry[]
): EntryWithDiff[] {
  if (entries.length === 0) return []

  // Reverse to oldest-first
  const oldest = [...entries].reverse()

  return oldest.map((entry, i) => {
    if (i === 0) {
      return { entry, charDiff: 0 }
    }
    return {
      entry,
      charDiff: entry.char_count - oldest[i - 1].char_count,
    }
  })
}

/**
 * Format an hour number (0–23) as a short label: "12a", "9a", "12p", "5p".
 */
function formatHourLabel(hour: number): string {
  if (hour === 0) return '12a'
  if (hour < 12) return `${hour}a`
  if (hour === 12) return '12p'
  return `${hour - 12}p`
}

/**
 * Group entries by Toronto-timezone date, then by hour within each day.
 * Input: oldest-first EntryWithDiff[].
 * Returns newest-day-first DayGroup[], each day's hours oldest-first,
 * each hour's entries oldest-first.
 */
export function groupByDate(entries: EntryWithDiff[]): DayGroup[] {
  if (entries.length === 0) return []

  // First group by date
  const dayMap = new Map<string, EntryWithDiff[]>()

  for (const e of entries) {
    const date = formatInTimeZone(
      new Date(e.entry.created_at),
      TZ,
      'EEE MMM d'
    )
    if (!dayMap.has(date)) dayMap.set(date, [])
    dayMap.get(date)!.push(e)
  }

  // Then group each day's entries by hour
  const result: DayGroup[] = []
  for (const [date, hourEntries] of dayMap) {
    const hourMap = new Map<number, EntryWithDiff[]>()

    for (const e of hourEntries) {
      const hour = parseInt(
        formatInTimeZone(new Date(e.entry.created_at), TZ, 'H'),
        10
      )
      if (!hourMap.has(hour)) hourMap.set(hour, [])
      hourMap.get(hour)!.push(e)
    }

    // Sort hours oldest-first
    const hours: HourGroup[] = []
    const sortedHours = [...hourMap.keys()].sort((a, b) => a - b)
    for (const hour of sortedHours) {
      hours.push({
        hour,
        label: formatHourLabel(hour),
        entries: hourMap.get(hour)!,
      })
    }

    result.push({ date, hours })
  }

  result.reverse()
  return result
}

/**
 * Compute baseline Y position — always centered.
 */
export function computeBaselineY(
  _entries: EntryWithDiff[],
  chartHeight: number,
  _margin: number = 4
): number {
  return chartHeight / 2
}

/**
 * Get the second within the hour (0–3599) for an entry in Toronto timezone.
 */
function getSecondWithinHour(entry: AssignmentDocHistoryEntry): number {
  const timeStr = formatInTimeZone(new Date(entry.created_at), TZ, 'mm:ss')
  const [m, s] = timeStr.split(':').map(Number)
  return m * 60 + s
}

/**
 * Compute stem layout for an hour group.
 * X-axis spans the full 60-minute hour (0–3599 seconds).
 * Stems are 2px wide with 1px gap minimum; close entries are spaced sequentially.
 */
export function computeStemLayout(
  hourEntries: EntryWithDiff[],
  chartWidth: number,
  chartHeight: number = 32
): StemLayout {
  if (hourEntries.length === 0) {
    return { stems: [], baselineY: chartHeight / 2 }
  }

  const margin = 3
  const baselineY = computeBaselineY(hourEntries, chartHeight, margin)
  const usableWidth = chartWidth - STEM_PADDING_X * 2

  // Position stems proportionally across the full 60-minute hour
  const rawPositions = hourEntries.map((e) => {
    const sec = getSecondWithinHour(e.entry)
    return STEM_PADDING_X + (sec / 3600) * usableWidth
  })

  // Enforce minimum spacing: if two stems would overlap (< STEM_WIDTH + STEM_GAP apart),
  // nudge the later one forward (sequential fallback for bursts)
  const minSpacing = STEM_WIDTH + STEM_GAP
  const positions = [...rawPositions]
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] - positions[i - 1] < minSpacing) {
      positions[i] = positions[i - 1] + minSpacing
    }
  }

  const stems: Stem[] = hourEntries.map((e, i) => {
    const isBaseline = i === 0 && e.charDiff === 0
    const absDiff = Math.abs(e.charDiff)
    const clampedDiff = Math.min(absDiff, MAX_DIFF_FOR_SCALE)
    const height = isBaseline
      ? 0.15
      : absDiff === 0
        ? 0
        : Math.sqrt(clampedDiff) / Math.sqrt(MAX_DIFF_FOR_SCALE)

    let color: Stem['color']
    if (isBaseline || e.charDiff === 0) {
      color = 'muted'
    } else if (absDiff > WARNING_THRESHOLD) {
      color = 'warning'
    } else if (e.charDiff > 0) {
      color = 'success'
    } else {
      color = 'danger'
    }

    return {
      x: positions[i],
      height,
      color,
      direction: e.charDiff >= 0 ? 'up' : 'down' as const,
      entry: e.entry,
      charDiff: e.charDiff,
      isBaseline,
      hasPaste: (e.entry.paste_word_count ?? 0) > 0,
    }
  })

  return { stems, baselineY }
}

/**
 * Find the nearest stem to a mouse X position.
 * Returns the stem index, or -1 if no stems.
 */
export function findNearestStem(mouseX: number, stems: Stem[]): number {
  if (stems.length === 0) return -1

  let nearest = 0
  let minDist = Math.abs(mouseX - stems[0].x)

  for (let i = 1; i < stems.length; i++) {
    const dist = Math.abs(mouseX - stems[i].x)
    if (dist < minDist) {
      minDist = dist
      nearest = i
    }
  }

  return nearest
}
