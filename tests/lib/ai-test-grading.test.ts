/**
 * Tests for ai-test-grading utility functions.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  buildTestOpenResponseReferenceCacheKey,
  normalizeTestOpenResponseReferenceAnswers,
  getTestOpenResponseGradingModel,
  getTestOpenResponseReferenceFallbackModel,
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
  afterEach(() => vi.unstubAllEnvs())

  it('defaults to Sol and recognizes DeepSeek fallback references', () => {
    vi.stubEnv('PIKA_AI_GRADING_PROVIDER', '')
    vi.stubEnv('OPENAI_GRADING_MODEL', '')
    vi.stubEnv('DEEPSEEK_GRADING_MODEL', '')
    expect(getTestOpenResponseGradingModel()).toBe('gpt-6.1-sol')
    expect(getTestOpenResponseReferenceFallbackModel()).toBe('deepseek-flash')
  })

  it('trims the configured OpenAI model', () => {
    vi.stubEnv('PIKA_AI_GRADING_PROVIDER', 'openai')
    vi.stubEnv('OPENAI_GRADING_MODEL', '  custom-openai  ')
    expect(getTestOpenResponseGradingModel()).toBe('custom-openai')
  })

  it('uses the configured DeepSeek model when selected', () => {
    vi.stubEnv('PIKA_AI_GRADING_PROVIDER', 'deepseek')
    vi.stubEnv('DEEPSEEK_GRADING_MODEL', '  custom-deepseek  ')
    expect(getTestOpenResponseGradingModel()).toBe('custom-deepseek')
  })

  it('uses the DeepSeek default when selected without a model', () => {
    vi.stubEnv('PIKA_AI_GRADING_PROVIDER', 'deepseek')
    vi.stubEnv('DEEPSEEK_GRADING_MODEL', '')
    expect(getTestOpenResponseGradingModel()).toBe('deepseek-flash')
  })
})
