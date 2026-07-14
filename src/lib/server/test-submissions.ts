import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  buildTestAttemptHistoryMetrics,
  normalizeTestResponses,
  type TestResponses,
} from '@/lib/test-attempts'
import {
  insertVersionedBaselineHistory,
  persistVersionedHistory,
} from '@/lib/server/versioned-history'
import type { TestAttemptHistoryEntry } from '@/types'

const HISTORY_SELECT_FIELDS =
  'id, test_attempt_id, patch, snapshot, word_count, char_count, paste_word_count, keystroke_count, trigger, created_at'

const submitTestAttemptResultSchema = z.object({
  attempt_id: z.string().uuid(),
  submitted_at: z.string().datetime({ offset: true }),
  inserted_responses: z.number().int().nonnegative(),
})

const savedAttemptSchema = z.object({
  id: z.string().uuid(),
  test_id: z.string().uuid(),
  student_id: z.string().uuid(),
  responses: z.record(z.string(), z.unknown()),
  is_submitted: z.boolean(),
  submitted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

const saveTestAttemptResultSchema = z.object({
  created: z.boolean(),
  previous_responses: z.record(z.string(), z.unknown()),
  attempt: savedAttemptSchema,
})

type PostgrestErrorLike = {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

type SubmitStudentTestAttemptResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

type SaveStudentTestAttemptResult =
  | {
      ok: true
      attempt: z.infer<typeof savedAttemptSchema>
      historyEntry: TestAttemptHistoryEntry | null
    }
  | { ok: false; status: number; error: string }

function isMissingSubmitRpc(error: PostgrestErrorLike): boolean {
  if (error.code === '42883' || error.code === 'PGRST202') return true
  const text = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  return text.includes('submit_test_attempt_atomic') && text.includes('function')
}

function isMissingSaveRpc(error: PostgrestErrorLike): boolean {
  if (error.code === '42883' || error.code === 'PGRST202') return true
  const text = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  return text.includes('save_test_attempt_atomic') && text.includes('function')
}

function mapSubmitError(error: PostgrestErrorLike): Exclude<SubmitStudentTestAttemptResult, { ok: true }> {
  if (isMissingSubmitRpc(error)) {
    return { ok: false, status: 500, error: 'Test submission migration is required' }
  }
  if (error.code === '22023') {
    return { ok: false, status: 400, error: error.message || 'Invalid test submission' }
  }
  if (error.code === '23505') {
    return { ok: false, status: 400, error: 'You have already responded to this test' }
  }
  if (error.code === '42501') {
    return { ok: false, status: 403, error: error.message || 'Test submission is not allowed' }
  }
  if (error.code === 'P0002') {
    return { ok: false, status: 404, error: error.message || 'Test not found' }
  }
  if (error.code === '22P02') {
    return { ok: false, status: 404, error: 'Test not found' }
  }
  return { ok: false, status: 500, error: 'Failed to submit responses' }
}

export async function submitStudentTestAttempt(input: {
  testId: string
  studentId: string
  responses: TestResponses
}): Promise<SubmitStudentTestAttemptResult> {
  const supabase = getServiceRoleClient()
  const requestedSubmittedAt = new Date().toISOString()
  const { data, error } = await supabase.rpc('submit_test_attempt_atomic', {
    p_test_id: input.testId,
    p_student_id: input.studentId,
    p_responses: input.responses,
    p_submitted_at: requestedSubmittedAt,
  })

  if (error) {
    const mapped = mapSubmitError(error)
    if (mapped.status === 500) console.error('Error submitting test attempt atomically:', error)
    return mapped
  }

  const parsedResult = submitTestAttemptResultSchema.safeParse(data)
  if (!parsedResult.success) {
    console.error('Invalid submit_test_attempt_atomic result:', parsedResult.error)
    return { ok: false, status: 500, error: 'Failed to submit responses' }
  }

  try {
    await insertVersionedBaselineHistory<TestResponses>({
      supabase,
      table: 'test_attempt_history',
      ownerColumn: 'test_attempt_id',
      ownerId: parsedResult.data.attempt_id,
      content: input.responses,
      selectFields: HISTORY_SELECT_FIELDS,
      trigger: 'submit',
      buildMetrics: (responses) => buildTestAttemptHistoryMetrics(responses),
    })
  } catch (historyError) {
    console.error('Error writing test attempt submit history:', historyError)
  }

  return { ok: true }
}

export async function saveStudentTestAttempt(input: {
  testId: string
  studentId: string
  responses: TestResponses
  trigger?: 'autosave' | 'blur'
  pasteWordCount: number
  keystrokeCount: number
}): Promise<SaveStudentTestAttemptResult> {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase.rpc('save_test_attempt_atomic', {
    p_test_id: input.testId,
    p_student_id: input.studentId,
    p_responses: input.responses,
  })

  if (error) {
    if (isMissingSaveRpc(error)) {
      return { ok: false, status: 500, error: 'Test attempt migration is required' }
    }
    if (error.code === '22023') {
      return { ok: false, status: 400, error: error.message || 'Invalid test attempt' }
    }
    if (error.code === '42501') {
      return { ok: false, status: 403, error: error.message || 'Test attempt is not editable' }
    }
    if (error.code === 'P0002' || error.code === '22P02') {
      return { ok: false, status: 404, error: 'Test not found' }
    }
    console.error('Error saving test attempt atomically:', error)
    return { ok: false, status: 500, error: 'Failed to save responses' }
  }

  const parsedResult = saveTestAttemptResultSchema.safeParse(data)
  if (!parsedResult.success) {
    console.error('Invalid save_test_attempt_atomic result:', parsedResult.error)
    return { ok: false, status: 500, error: 'Failed to save responses' }
  }

  const result = parsedResult.data
  const previousResponses = normalizeTestResponses(result.previous_responses)
  let historyEntry: TestAttemptHistoryEntry | null = null
  try {
    if (result.created) {
      historyEntry = await insertVersionedBaselineHistory<TestResponses>({
        supabase,
        table: 'test_attempt_history',
        ownerColumn: 'test_attempt_id',
        ownerId: result.attempt.id,
        content: input.responses,
        selectFields: HISTORY_SELECT_FIELDS,
        trigger: 'baseline',
        buildMetrics: (responses) => buildTestAttemptHistoryMetrics(
          responses,
          input.pasteWordCount,
          input.keystrokeCount,
        ),
      })
    } else {
      historyEntry = await persistVersionedHistory<TestResponses>({
        supabase,
        table: 'test_attempt_history',
        ownerColumn: 'test_attempt_id',
        ownerId: result.attempt.id,
        previousContent: previousResponses,
        nextContent: input.responses,
        selectFields: HISTORY_SELECT_FIELDS,
        trigger: input.trigger ?? 'autosave',
        historyMinIntervalMs: 10_000,
        buildMetrics: (responses) => buildTestAttemptHistoryMetrics(
          responses,
          input.pasteWordCount,
          input.keystrokeCount,
        ),
      })
    }
  } catch (historyError) {
    console.error('Error saving test attempt history:', historyError)
  }

  return { ok: true, attempt: result.attempt, historyEntry }
}
