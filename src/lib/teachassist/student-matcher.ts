import type { TAStudentRow, StudentMatchResult } from './types'

/**
 * Normalize a name for comparison: lowercase, trim, strip diacritics, collapse whitespace.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }

  return dp[m][n]
}

/**
 * Similarity ratio between two strings (0 = completely different, 1 = identical).
 * Based on Levenshtein distance.
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshteinDistance(a, b) / maxLen
}

/**
 * Parse a TeachAssist "Last, First" name into normalized parts.
 */
function parseTAName(taName: string): { first: string; last: string } {
  const commaIdx = taName.indexOf(',')
  if (commaIdx === -1) {
    return { first: '', last: normalizeName(taName) }
  }
  return {
    last: normalizeName(taName.slice(0, commaIdx)),
    first: normalizeName(taName.slice(commaIdx + 1)),
  }
}

const LAST_NAME_WEIGHT = 0.7
const FIRST_NAME_WEIGHT = 0.3
const MATCH_THRESHOLD = 0.8 // 80%

/**
 * Match Pika students to TeachAssist student rows by name.
 *
 * Algorithm:
 * 1. Exact match (normalized) first → 100% confidence
 * 2. Fuzzy match via weighted Levenshtein (last 70%, first 30%)
 * 3. Threshold ≥ 80% → matched
 * 4. Each TA student can only be matched once (first-come basis by confidence)
 */
export function matchStudents(
  pikaStudents: Array<{ student_id: string; first_name: string; last_name: string }>,
  taStudents: TAStudentRow[]
): StudentMatchResult[] {
  // Pre-parse TA names
  const taEntries = taStudents.map((ta) => ({
    original: ta,
    parsed: parseTAName(ta.name),
  }))

  // Track which TA students have been claimed
  const claimed = new Set<number>()

  // First pass: exact matches (these get priority)
  const results: (StudentMatchResult | null)[] = pikaStudents.map(() => null)

  for (let pi = 0; pi < pikaStudents.length; pi++) {
    const pika = pikaStudents[pi]
    const pikaFirst = normalizeName(pika.first_name)
    const pikaLast = normalizeName(pika.last_name)

    for (let ti = 0; ti < taEntries.length; ti++) {
      if (claimed.has(ti)) continue
      const ta = taEntries[ti]

      if (ta.parsed.last === pikaLast && ta.parsed.first === pikaFirst) {
        claimed.add(ti)
        results[pi] = {
          student_id: pika.student_id,
          pika: { first: pika.first_name, last: pika.last_name },
          ta_name: ta.original.name,
          ta_radio_name: ta.original.radioName,
          confidence: 100,
          matched: true,
        }
        break
      }
    }
  }

  // Second pass: fuzzy matches for unmatched Pika students
  for (let pi = 0; pi < pikaStudents.length; pi++) {
    if (results[pi] !== null) continue

    const pika = pikaStudents[pi]
    const pikaFirst = normalizeName(pika.first_name)
    const pikaLast = normalizeName(pika.last_name)

    let bestIdx = -1
    let bestScore = 0

    for (let ti = 0; ti < taEntries.length; ti++) {
      if (claimed.has(ti)) continue
      const ta = taEntries[ti]

      const lastSim = levenshteinSimilarity(pikaLast, ta.parsed.last)
      const firstSim = levenshteinSimilarity(pikaFirst, ta.parsed.first)
      const score = lastSim * LAST_NAME_WEIGHT + firstSim * FIRST_NAME_WEIGHT

      if (score > bestScore) {
        bestScore = score
        bestIdx = ti
      }
    }

    const confidence = Math.round(bestScore * 100)

    if (bestIdx >= 0 && bestScore >= MATCH_THRESHOLD) {
      claimed.add(bestIdx)
      results[pi] = {
        student_id: pika.student_id,
        pika: { first: pika.first_name, last: pika.last_name },
        ta_name: taEntries[bestIdx].original.name,
        ta_radio_name: taEntries[bestIdx].original.radioName,
        confidence,
        matched: true,
      }
    } else {
      results[pi] = {
        student_id: pika.student_id,
        pika: { first: pika.first_name, last: pika.last_name },
        ta_name: null,
        ta_radio_name: null,
        confidence,
        matched: false,
      }
    }
  }

  return results as StudentMatchResult[]
}
