import type { AssignmentDocHistoryEntry, AuthenticityFlag } from '@/types'

export interface AuthenticityResult {
  score: number | null
  flags: AuthenticityFlag[]
}

const WPS_THRESHOLD = 3 // ~180 WPM, faster than any human typist
const SKIP_TRIGGERS = new Set(['restore', 'baseline', 'submit'])

/**
 * Analyze assignment doc history to compute an authenticity score (0–100).
 * Score = (organic words added / total words added) × 100.
 *
 * Only impossible-speed intervals (WPS > 3, ~180 WPM) affect the score.
 * Paste events are recorded as informational flags for teacher review
 * but do NOT lower the score, since students may legitimately paste
 * from their own drafts in other apps.
 *
 * Pure function — no side effects, no API calls.
 */
export function analyzeAuthenticity(entries: AssignmentDocHistoryEntry[]): AuthenticityResult {
  if (entries.length <= 1) {
    return { score: null, flags: [] }
  }

  // Sort by created_at ascending
  const sorted = [...entries].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  let organicWords = 0
  let suspiciousWords = 0
  const flags: AuthenticityFlag[] = []

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]

    // Skip restore/baseline/submit triggers — legitimate non-typing events
    if (SKIP_TRIGGERS.has(curr.trigger)) {
      continue
    }

    const wordDelta = curr.word_count - prev.word_count
    if (wordDelta <= 0) continue // deletions or no change don't count

    const seconds = Math.max(
      1,
      Math.round(
        (new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime()) / 1000
      )
    )

    const wps = wordDelta / seconds

    // Paste detection — informational only, does not affect score
    if (curr.paste_word_count != null && curr.paste_word_count > 0) {
      const effectivePasteWords = Math.min(curr.paste_word_count, Math.max(0, wordDelta))
      if (effectivePasteWords > 0) {
        flags.push({
          timestamp: curr.created_at,
          wordDelta: effectivePasteWords,
          seconds,
          wps: Math.round(wps * 10) / 10,
          reason: 'paste',
        })
      }
    }

    // WPS check — impossible speed affects the score
    if (wps > WPS_THRESHOLD) {
      suspiciousWords += wordDelta
      // Only add a flag if paste didn't already create one for this interval
      if (!(curr.paste_word_count != null && curr.paste_word_count > 0)) {
        flags.push({
          timestamp: curr.created_at,
          wordDelta,
          seconds,
          wps: Math.round(wps * 10) / 10,
          reason: 'high_wps',
        })
      }
    } else {
      organicWords += wordDelta
    }
  }

  const totalAdded = organicWords + suspiciousWords
  if (totalAdded === 0) {
    return { score: null, flags: [] }
  }

  const score = Math.round(Math.min(100, Math.max(0, (organicWords / totalAdded) * 100)))
  return { score, flags }
}
