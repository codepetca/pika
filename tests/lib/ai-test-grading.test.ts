/**
 * Tests for ai-test-grading utility functions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  buildTestOpenResponseReferenceCacheKey,
  normalizeTestOpenResponseReferenceAnswers,
  getTestOpenResponseGradingModel,
} from '@/lib/ai-test-grading'

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

  it('differs when isCodingQuestion is true vs false', () => {
    const base = { testTitle: 'T', questionText: 'Q', maxPoints: 5, model: 'gpt-5-nano' }
    const k1 = buildTestOpenResponseReferenceCacheKey({ ...base, isCodingQuestion: false })
    const k2 = buildTestOpenResponseReferenceCacheKey({ ...base, isCodingQuestion: true })
    expect(k1).not.toBe(k2)
  })
})

describe('normalizeTestOpenResponseReferenceAnswers', () => {
  it('returns normalized array for valid string answers', () => {
    const result = normalizeTestOpenResponseReferenceAnswers(['  Answer A  ', 'Answer B'])
    expect(result).toEqual(['Answer A', 'Answer B'])
  })

  it('throws when input is not an array', () => {
    expect(() => normalizeTestOpenResponseReferenceAnswers('not an array')).toThrow(
      'AI grading references must be an array'
    )
  })

  it('throws when array is empty after filtering blanks', () => {
    expect(() => normalizeTestOpenResponseReferenceAnswers(['', '   '])).toThrow(
      'AI grading references are empty'
    )
  })

  it('deduplicates answers', () => {
    const result = normalizeTestOpenResponseReferenceAnswers(['Same', 'Same', 'Different'])
    expect(result).toEqual(['Same', 'Different'])
  })

  it('caps results at 3 answers', () => {
    const result = normalizeTestOpenResponseReferenceAnswers(['A', 'B', 'C', 'D', 'E'])
    expect(result).toHaveLength(3)
    expect(result).toEqual(['A', 'B', 'C'])
  })

  it('filters out non-string elements (empty after trim)', () => {
    const result = normalizeTestOpenResponseReferenceAnswers([42, null, 'Valid answer'])
    expect(result).toEqual(['Valid answer'])
  })
})

describe('getTestOpenResponseGradingModel', () => {
  const originalEnv = process.env.OPENAI_GRADING_MODEL

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OPENAI_GRADING_MODEL
    } else {
      process.env.OPENAI_GRADING_MODEL = originalEnv
    }
  })

  it('returns the default model when env var is not set', () => {
    delete process.env.OPENAI_GRADING_MODEL
    expect(getTestOpenResponseGradingModel()).toBe('gpt-5-nano')
  })

  it('returns the configured model when env var is set', () => {
    process.env.OPENAI_GRADING_MODEL = 'gpt-4o'
    expect(getTestOpenResponseGradingModel()).toBe('gpt-4o')
  })

  it('trims whitespace from the configured model', () => {
    process.env.OPENAI_GRADING_MODEL = '  gpt-4o  '
    expect(getTestOpenResponseGradingModel()).toBe('gpt-4o')
  })
})
