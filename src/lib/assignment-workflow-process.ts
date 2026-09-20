import { analyzeAuthenticity } from '@/lib/authenticity'
import { HISTORY_SESSION_GAP_MS } from '@/lib/history-graph'
import type { AssignmentDocHistoryEntry } from '@/types'

const DAY_MS = 24 * 60 * 60 * 1000
const TORONTO = 'America/Toronto'

/**
 * Workflow is half process and half presentation: the AI judges only how the
 * work reads, and these figures — drawn from save history, not content —
 * carry timeliness and authenticity.
 */
export interface WorkProcessSummary {
  submitted: boolean
  daysLate: number | null
  firstSaveDaysBeforeDue: number | null
  workSessions: number
  daysWithWork: number
  authenticityScore: number | null
  pastedWords: number
}

export type WorkProcessHistoryEntry = Pick<
  AssignmentDocHistoryEntry,
  'word_count' | 'paste_word_count' | 'trigger' | 'created_at'
>

export const PASTED_WORK_REMINDER =
  'Reminder: type all of your work directly in Pika. Do not paste it in from somewhere else.'
export const UNSUBMITTED_WORK_REMINDER =
  'Reminder: this work was never submitted. Make sure you press Submit on future assignments.'

function roundDays(ms: number): number {
  return Math.round((ms / DAY_MS) * 10) / 10
}

function torontoDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TORONTO, dateStyle: 'short' }).format(new Date(ms))
}

export function summarizeWorkProcess(
  history: WorkProcessHistoryEntry[],
  opts: { dueAt: string; isSubmitted: boolean; submittedAt: string | null },
): WorkProcessSummary {
  const dueMs = Date.parse(opts.dueAt)
  const times = history
    .map((entry) => Date.parse(entry.created_at))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)

  let workSessions = 0
  for (const [index, time] of times.entries()) {
    if (index === 0 || time - times[index - 1] >= HISTORY_SESSION_GAP_MS) workSessions++
  }

  const submittedMs = opts.submittedAt ? Date.parse(opts.submittedAt) : NaN
  const authenticity = analyzeAuthenticity(history as AssignmentDocHistoryEntry[])

  return {
    submitted: opts.isSubmitted,
    daysLate: opts.isSubmitted && Number.isFinite(submittedMs) && Number.isFinite(dueMs)
      ? roundDays(submittedMs - dueMs)
      : null,
    firstSaveDaysBeforeDue: times.length > 0 && Number.isFinite(dueMs)
      ? roundDays(dueMs - times[0])
      : null,
    workSessions,
    daysWithWork: new Set(times.map(torontoDay)).size,
    authenticityScore: authenticity.score,
    pastedWords: history.reduce((sum, entry) => sum + (entry.paste_word_count ?? 0), 0),
  }
}

export interface WorkflowScore {
  presentation: number
  onTime: number
  latePenalty: number
  sessions: number
  authenticity: number
  total: number
}

// Missing history means the student is given the benefit of the doubt.
export function scoreWorkflow(opts: {
  presentation: number
  process: WorkProcessSummary | null
  expectsMultipleSessions?: boolean
}): WorkflowScore {
  const presentation = Math.max(0, Math.min(4, Math.round(opts.presentation)))
  const process = opts.process
  const daysLate = process?.submitted ? process.daysLate ?? 0 : 0
  const latePenalty = daysLate <= 0 ? 0 : daysLate <= 3 ? 1 : daysLate <= 7 ? 2 : daysLate <= 14 ? 3 : 5

  const sessions = !opts.expectsMultipleSessions || !process
    ? 2
    : process.workSessions >= 3 || process.daysWithWork >= 2
      ? 2
      : process.workSessions === 2 ? 1 : 0

  const authenticity = !process || process.authenticityScore === null
    ? 2
    : process.authenticityScore >= 90
      ? 2
      : process.authenticityScore >= 70 ? 1 : 0

  const onTime = 2
  return {
    presentation,
    onTime,
    latePenalty,
    sessions,
    authenticity,
    total: Math.max(0, Math.min(10, presentation + onTime - latePenalty + sessions + authenticity)),
  }
}

export function buildProcessReminders(process: WorkProcessSummary | null): string[] {
  if (!process) return []
  const reminders: string[] = []
  if (process.authenticityScore !== null && process.authenticityScore < 70) {
    reminders.push(PASTED_WORK_REMINDER)
  }
  if (!process.submitted) reminders.push(UNSUBMITTED_WORK_REMINDER)
  return reminders
}
