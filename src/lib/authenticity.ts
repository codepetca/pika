import type { AssignmentDocHistoryEntry, AuthenticityFlag } from '@/types'

export interface AuthenticityResult {
  score: number | null
  flags: AuthenticityFlag[]
}

const WPS_THRESHOLD = 3 // ~180 WPM, faster than any human typist
const KEYSTROKE_RATIO = 2 // chars added > keystrokes × 2 is suspicious
const SKIP_TRIGGERS = new Set(['restore', 'baseline', 'submit'])

/**
 * Analyze assignment doc history to compute an authenticity score (0–100).
 * Score = (organic words added / total words added) × 100.
 *
 * Three-tier signal hierarchy per interval:
 * 1. paste_word_count (direct paste evidence, capped by word delta)
 * 2. keystroke_count vs chars added (indirect evidence)
 * 3. WPS > 3 (fallback for old entries + anti-spoof safety net)
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
  let pasteWords = 0
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
    const charsAdded = Math.max(0, curr.char_count - prev.char_count)

    let flagged = false
    let reason: AuthenticityFlag['reason'] | null = null

    // Signal 1: direct paste evidence
    if (curr.paste_word_count != null && curr.paste_word_count > 0) {
      const effectivePasteWords = Math.min(curr.paste_word_count, Math.max(0, wordDelta))
      if (effectivePasteWords > 0) {
        flagged = true
        reason = 'paste'
      }
    }

    // Signal 2: keystroke mismatch (only if no paste detected)
    if (
      !flagged &&
      curr.keystroke_count != null &&
      curr.paste_word_count != null &&
      curr.paste_word_count === 0 &&
      charsAdded > curr.keystroke_count * KEYSTROKE_RATIO
    ) {
      flagged = true
      reason = 'low_keystrokes'
    }

    // Signal 3: WPS fallback (old entries where paste_word_count is null, or anti-spoof)
    if (!flagged && wps > WPS_THRESHOLD) {
      flagged = true
      reason = 'high_wps'
    }

    if (flagged && reason) {
      pasteWords += wordDelta
      flags.push({
        timestamp: curr.created_at,
        wordDelta,
        seconds,
        wps: Math.round(wps * 10) / 10,
        reason,
      })
    } else {
      organicWords += wordDelta
    }
  }

  const totalAdded = organicWords + pasteWords
  if (totalAdded === 0) {
    return { score: null, flags: [] }
  }

  const score = Math.round(Math.min(100, Math.max(0, (organicWords / totalAdded) * 100)))
  return { score, flags }
}
