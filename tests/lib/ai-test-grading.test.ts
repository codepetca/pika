/**
 * Tests for ai-test-grading utility functions.
 */

import { describe, it, expect } from 'vitest'
import {
  buildTestOpenResponseGradeCacheKey,
  buildTestOpenResponseReferenceCacheKey,
} from '@/lib/ai-test-grading'

describe('buildTestOpenResponseGradeCacheKey', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const key = buildTestOpenResponseGradeCacheKey({
      responseText: 'Some student answer',
      questionId: 'q-1',
      model: 'gpt-5-nano',
    })
    expect(key).toMatch(/^[a-f0-9]{64}$/)
  })

  it('is deterministic — same inputs produce same key', () => {
    const input = { responseText: 'Same answer', questionId: 'q-1', model: 'gpt-5-nano' }
    expect(buildTestOpenResponseGradeCacheKey(input)).toBe(
      buildTestOpenResponseGradeCacheKey(input)
    )
  })

  it('differs when responseText changes', () => {
    const base = { questionId: 'q-1', model: 'gpt-5-nano' }
    const k1 = buildTestOpenResponseGradeCacheKey({ ...base, responseText: 'Answer A' })
    const k2 = buildTestOpenResponseGradeCacheKey({ ...base, responseText: 'Answer B' })
    expect(k1).not.toBe(k2)
  })

  it('differs when questionId changes', () => {
    const base = { responseText: 'Same answer', model: 'gpt-5-nano' }
    const k1 = buildTestOpenResponseGradeCacheKey({ ...base, questionId: 'q-1' })
    const k2 = buildTestOpenResponseGradeCacheKey({ ...base, questionId: 'q-2' })
    expect(k1).not.toBe(k2)
  })

  it('differs when model changes', () => {
    const base = { responseText: 'Same answer', questionId: 'q-1' }
    const k1 = buildTestOpenResponseGradeCacheKey({ ...base, model: 'gpt-5-nano' })
    const k2 = buildTestOpenResponseGradeCacheKey({ ...base, model: 'gpt-4o' })
    expect(k1).not.toBe(k2)
  })

  it('trims leading/trailing whitespace from responseText before hashing', () => {
    const base = { questionId: 'q-1', model: 'gpt-5-nano' }
    const trimmed = buildTestOpenResponseGradeCacheKey({
      ...base,
      responseText: 'Answer',
    })
    const padded = buildTestOpenResponseGradeCacheKey({
      ...base,
      responseText: '  Answer  ',
    })
    expect(trimmed).toBe(padded)
  })

  it('trims model before hashing', () => {
    const base = { responseText: 'Answer', questionId: 'q-1' }
    const trimmed = buildTestOpenResponseGradeCacheKey({ ...base, model: 'gpt-5-nano' })
    const padded = buildTestOpenResponseGradeCacheKey({ ...base, model: '  gpt-5-nano  ' })
    expect(trimmed).toBe(padded)
  })
})

describe('buildTestOpenResponseReferenceCacheKey (existing, smoke test)', () => {
  it('returns a 64-character hex string', () => {
    const key = buildTestOpenResponseReferenceCacheKey({
      testTitle: 'My Test',
      questionText: 'Explain recursion',
      maxPoints: 10,
      model: 'gpt-5-nano',
    })
    expect(key).toMatch(/^[a-f0-9]{64}$/)
  })
})
