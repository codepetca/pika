import { describe, expect, it } from 'vitest'
import {
  assignmentDocSaveRequestSchema,
  assignmentDocRestoreRequestSchema,
  assignmentDocSubmitRequestSchema,
} from '@/lib/validations/assignment-doc-submissions'

describe('assignmentDocSubmitRequestSchema', () => {
  it('accepts Tiptap content with an offset-aware saved revision', () => {
    const input = {
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ready' }] }],
      },
      expected_updated_at: '2026-07-16T12:00:00.000Z',
    }

    expect(assignmentDocSubmitRequestSchema.parse(input)).toEqual(input)
  })

  it('rejects malformed content and revisions', () => {
    expect(assignmentDocSubmitRequestSchema.safeParse({
      content: null,
      expected_updated_at: 'not-a-timestamp',
    }).success).toBe(false)
    expect(assignmentDocSubmitRequestSchema.safeParse({
      content: { type: 'doc', content: [null] },
      expected_updated_at: '2026-07-16T12:00:00.000Z',
    }).success).toBe(false)
    expect(assignmentDocSubmitRequestSchema.safeParse({
      content: { type: 'doc', content: [{ type: 'paragraph', content: [null] }] },
      expected_updated_at: '2026-07-16T12:00:00.000Z',
    }).success).toBe(false)
  })

  it('rejects unknown submit fields', () => {
    expect(assignmentDocSubmitRequestSchema.safeParse({
      content: { type: 'doc', content: [] },
      expected_updated_at: '2026-07-16T12:00:00.000Z',
      unexpected: true,
    }).success).toBe(false)
  })

  it('accepts a revision-guarded autosave payload', () => {
    expect(assignmentDocSaveRequestSchema.parse({
      content: { type: 'doc', content: [] },
      trigger: 'autosave',
      paste_word_count: 2,
      keystroke_count: 7,
      expected_updated_at: '2026-07-16T12:00:00.000Z',
      save_session_id: '10000000-0000-4000-8000-000000000001',
      save_sequence: 1,
      metric_session_id: '10000000-0000-4000-8000-000000000002',
    })).toEqual({
      content: { type: 'doc', content: [] },
      trigger: 'autosave',
      paste_word_count: 2,
      keystroke_count: 7,
      expected_updated_at: '2026-07-16T12:00:00.000Z',
      save_session_id: '10000000-0000-4000-8000-000000000001',
      save_sequence: 1,
      metric_session_id: '10000000-0000-4000-8000-000000000002',
    })
  })

  it('validates cumulative metric-session evidence and metric bounds', () => {
    const content = { type: 'doc', content: [] }
    expect(assignmentDocSaveRequestSchema.parse({
      content,
      save_session_id: '10000000-0000-4000-8000-000000000001',
      save_sequence: 2,
      metric_session_id: '10000000-0000-4000-8000-000000000009',
      expected_updated_at: '2026-07-16T12:00:00.000Z',
      paste_word_count: '2',
      keystroke_count: 7,
    })).toEqual({
      content,
      save_session_id: '10000000-0000-4000-8000-000000000001',
      save_sequence: 2,
      metric_session_id: '10000000-0000-4000-8000-000000000009',
      expected_updated_at: '2026-07-16T12:00:00.000Z',
      paste_word_count: 2,
      keystroke_count: 7,
    })

    expect(assignmentDocSaveRequestSchema.safeParse({
      content,
      paste_word_count: 32_768,
    }).success).toBe(false)
  })

  it('accepts the strict rollout-only legacy shape and rejects partial atomic evidence', () => {
    expect(assignmentDocSaveRequestSchema.safeParse({
      content: { type: 'doc', content: [] },
    }).success).toBe(true)
    expect(assignmentDocSaveRequestSchema.safeParse({
      content: { type: 'doc', content: [] },
      expected_updated_at: '2026-07-16T12:00:00.000Z',
    }).success).toBe(false)
  })

  it('rejects unknown save fields', () => {
    expect(assignmentDocSaveRequestSchema.safeParse({
      content: { type: 'doc', content: [] },
      expected_updated_at: '2026-07-16T12:00:00.000Z',
      save_session_id: '10000000-0000-4000-8000-000000000001',
      save_sequence: 1,
      metric_session_id: '10000000-0000-4000-8000-000000000002',
      unexpected: true,
    }).success).toBe(false)
  })
})

describe('assignmentDocRestoreRequestSchema', () => {
  it('accepts only a UUID history identifier', () => {
    const input = { history_id: '10000000-0000-4000-8000-000000000002' }
    expect(assignmentDocRestoreRequestSchema.parse(input)).toEqual(input)
    expect(assignmentDocRestoreRequestSchema.safeParse({ history_id: 'history-1' }).success).toBe(false)
    expect(assignmentDocRestoreRequestSchema.safeParse({ ...input, unexpected: true }).success).toBe(false)
  })
})
