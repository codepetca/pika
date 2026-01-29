import { describe, it, expect } from 'vitest'
import { shouldSkipSave, isNormalizationNoise } from '@/app/classrooms/[classroomId]/TeacherLessonCalendarTab'
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

describe('isNormalizationNoise', () => {
  const DATE = '2024-01-15'

  it('returns true when content is identical to last seen', () => {
    const lastSeen = new Map([[DATE, JSON.stringify(REAL_CONTENT)]])
    expect(isNormalizationNoise(lastSeen, [], DATE, JSON.stringify(REAL_CONTENT))).toBe(true)
  })

  it('returns true when last seen matches stored plan (Tiptap normalization)', () => {
    const stored = REAL_CONTENT
    const normalized: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }], attrs: {} }],
    }
    const plans = [makePlan(DATE, stored)]
    const lastSeen = new Map([[DATE, JSON.stringify(stored)]])
    expect(isNormalizationNoise(lastSeen, plans, DATE, JSON.stringify(normalized))).toBe(true)
  })

  it('returns false when no last seen entry exists', () => {
    const lastSeen = new Map<string, string>()
    expect(isNormalizationNoise(lastSeen, [], DATE, JSON.stringify(REAL_CONTENT))).toBe(false)
  })

  it('returns false when content differs from last seen and last seen differs from stored', () => {
    const original: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original' }] }],
    }
    const edited: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Edited' }] }],
    }
    const plans = [makePlan(DATE, original)]
    // lastSeen already updated to normalized version (not equal to stored)
    const lastSeen = new Map([[DATE, JSON.stringify({ ...original, normalized: true })]])
    expect(isNormalizationNoise(lastSeen, plans, DATE, JSON.stringify(edited))).toBe(false)
  })

  it('returns false for real user edit after normalization was recorded', () => {
    const stored: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Stored' }] }],
    }
    const userEdit: TiptapContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'User typed this' }] }],
    }
    const plans = [makePlan(DATE, stored)]
    // lastSeen was already updated to the normalized version (differs from stored)
    const normalizedStr = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Stored' }], attrs: {} }] })
    const lastSeen = new Map([[DATE, normalizedStr]])
    expect(isNormalizationNoise(lastSeen, plans, DATE, JSON.stringify(userEdit))).toBe(false)
  })
})
