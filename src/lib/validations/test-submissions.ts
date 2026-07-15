import { z } from 'zod'
import { normalizeTestResponses } from '@/lib/test-attempts'

export const submitTestResponsesSchema = z.unknown().transform((raw, context) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    context.addIssue({ code: 'custom', message: 'Responses are required' })
    return z.NEVER
  }

  const responses = (raw as Record<string, unknown>).responses
  if (!responses || typeof responses !== 'object' || Array.isArray(responses)) {
    context.addIssue({ code: 'custom', message: 'Responses are required' })
    return z.NEVER
  }

  return { responses: normalizeTestResponses(responses) }
})

export type SubmitTestResponsesInput = z.infer<typeof submitTestResponsesSchema>

export const saveTestAttemptSchema = z.unknown().transform((raw, context) => {
  const parsedResponses = submitTestResponsesSchema.safeParse(raw)
  if (!parsedResponses.success) {
    context.addIssue({
      code: 'custom',
      message: parsedResponses.error.issues[0]?.message ?? 'Responses are required',
    })
    return z.NEVER
  }

  const record = raw as Record<string, unknown>
  const trigger = record.trigger
  if (trigger !== undefined && trigger !== 'autosave' && trigger !== 'blur') {
    context.addIssue({ code: 'custom', message: 'Invalid trigger' })
    return z.NEVER
  }

  return {
    responses: parsedResponses.data.responses,
    trigger: trigger as 'autosave' | 'blur' | undefined,
    pasteWordCount: Math.max(0, Math.round(Number(record.paste_word_count) || 0)),
    keystrokeCount: Math.max(0, Math.round(Number(record.keystroke_count) || 0)),
  }
})

export type SaveTestAttemptInput = z.infer<typeof saveTestAttemptSchema>
