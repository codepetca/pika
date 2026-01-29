import { describe, it, expect } from 'vitest'
import { shouldSkipSave } from '@/app/classrooms/[classroomId]/TeacherLessonCalendarTab'
import type { LessonPlan, TiptapContent } from '@/types'

function makePlan(date: string, content: TiptapContent): LessonPlan {
  return {
    id: '1',
    classroom_id: 'c1',
    date,
    content,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  }
}

const REAL_CONTENT: TiptapContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
}

describe('shouldSkipSave', () => {
  it('returns true when content matches existing plan', () => {
    const plans = [makePlan('2024-01-15', REAL_CONTENT)]
    expect(shouldSkipSave(plans, '2024-01-15', REAL_CONTENT)).toBe(true)
  })

  it('returns true when no existing plan and content is empty doc', () => {
    expect(shouldSkipSave([], '2024-01-15', { type: 'doc', content: [] })).toBe(true)
  })

  it('returns true when no existing plan and content is normalised empty doc', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    }
    expect(shouldSkipSave([], '2024-01-15', content)).toBe(true)
  })

  it('returns false when content differs from existing plan', () => {
    const plans = [makePlan('2024-01-15', REAL_CONTENT)]
    const changed: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Changed' }] }],
    }
    expect(shouldSkipSave(plans, '2024-01-15', changed)).toBe(false)
  })

  it('returns false when no existing plan and content has real text', () => {
    expect(shouldSkipSave([], '2024-01-15', REAL_CONTENT)).toBe(false)
  })

  it('returns false when existing plan exists but content changed', () => {
    const original: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original' }] }],
    }
    const plans = [makePlan('2024-01-15', original)]
    expect(shouldSkipSave(plans, '2024-01-15', REAL_CONTENT)).toBe(false)
  })
})
