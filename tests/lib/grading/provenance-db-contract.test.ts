import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toGradingProvenance, type GradingResult } from '@/lib/grading/contracts'
import { suggestTestOpenResponseGrade } from '@/lib/ai-test-grading'

// The database rejects any stored provenance with a key outside these CHECK-constraint
// whitelists, which fails the whole grade save. The lists are read from the migrations that
// enforce them, so this test cannot drift from what the database will actually accept.
function whitelist(migration: string, pattern: RegExp): string[] {
  const sql = readFileSync(`supabase/migrations/${migration}`, 'utf8')
  const match = sql.match(pattern)
  if (!match) throw new Error(`Whitelist not found in ${migration}`)
  return [...match[1].matchAll(/'([A-Za-z]+)'/g)].map((entry) => entry[1])
}

const TOP_LEVEL = /ai_grading_provenance - array\[([\s\S]*?)\]::text\[\] = '\{\}'::jsonb/
const TOKEN_USAGE = /\(ai_grading_provenance->'tokenUsage'\) - array\[([\s\S]*?)\]::text\[\] = '\{\}'::jsonb/

const TEST_TOP = whitelist('102_test_ai_grading_provenance.sql', TOP_LEVEL)
const TEST_TOKENS = whitelist('102_test_ai_grading_provenance.sql', TOKEN_USAGE)
const ASSIGNMENT_TOP = whitelist('101_assignment_ai_grading_provenance.sql', TOP_LEVEL)
const ASSIGNMENT_TOKENS = whitelist('101_assignment_ai_grading_provenance.sql', TOKEN_USAGE)

// Everything DeepSeek sends back, including fields the adapter may capture for measurement.
const deepSeekUsage = {
  prompt_tokens: 1027,
  completion_tokens: 93,
  total_tokens: 1120,
  prompt_cache_hit_tokens: 893,
  prompt_cache_miss_tokens: 134,
  completion_tokens_details: { reasoning_tokens: 87 },
}

describe('stored grading provenance matches the database contract', () => {
  const originalKey = process.env.DEEPSEEK_API_KEY
  afterEach(() => {
    process.env.DEEPSEEK_API_KEY = originalKey
    vi.unstubAllGlobals()
  })

  it('reads non-empty whitelists from the migrations', () => {
    expect(TEST_TOP).toContain('tokenUsage')
    expect(TEST_TOKENS).toEqual(['inputTokens', 'outputTokens', 'totalTokens'])
    expect(ASSIGNMENT_TOP).toContain('tokenUsage')
    expect(ASSIGNMENT_TOKENS).toEqual(['inputTokens', 'outputTokens', 'totalTokens'])
  })

  it('stores test provenance with only keys the database accepts', async () => {
    process.env.DEEPSEEK_API_KEY = 'synthetic-key'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score": 4, "feedback": "Clear."}' }, finish_reason: 'stop' }],
        usage: deepSeekUsage,
      }),
    }))

    const { provenance } = await suggestTestOpenResponseGrade({
      testTitle: 'Synthetic test',
      questionText: 'Explain recursion.',
      responseText: 'A function that calls itself.',
      maxPoints: 5,
      answerKey: 'A function calling itself with a base case.',
    })

    expect(Object.keys(provenance).filter((key) => !TEST_TOP.includes(key))).toEqual([])
    expect(Object.keys(provenance.tokenUsage).filter((key) => !TEST_TOKENS.includes(key))).toEqual([])
  })

  it('stores assignment provenance with only keys the database accepts', () => {
    const result = {
      overallScore: 8,
      maxScore: 10,
      percent: 80,
      criteriaResults: [{ criterionId: 'completion', score: 8, maxScore: 10, rationale: 'Mostly complete.' }],
      feedback: { student: 'Good work.', teacherNotes: null },
      provider: 'deepseek',
      model: 'deepseek-flash',
      policyVersion: 'policy',
      promptVersion: 'prompt',
      gradingProfileVersion: 'profile',
      rubricVersion: 'rubric',
      providerRequestCount: 1,
      // Carries fields the engine holds in memory; none of them may reach storage.
      reasoningEffortUsed: 'medium',
      tokenUsage: { inputTokens: 1027, outputTokens: 93, totalTokens: 1120, cachedInputTokens: 893 },
    } as unknown as GradingResult

    const provenance = toGradingProvenance(result)

    expect(Object.keys(provenance).filter((key) => !ASSIGNMENT_TOP.includes(key))).toEqual([])
    expect(Object.keys(provenance.tokenUsage).filter((key) => !ASSIGNMENT_TOKENS.includes(key))).toEqual([])
  })
})
