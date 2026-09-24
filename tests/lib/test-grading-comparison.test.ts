import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, symlinkSync, linkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { prepare, single, batch } = vi.hoisted(() => ({ prepare: vi.fn(), single: vi.fn(), batch: vi.fn() }))
vi.mock('@/lib/ai-test-grading', () => ({
  prepareTestOpenResponseGradingContext: prepare,
  suggestTestOpenResponseGradeWithContext: single,
  suggestTestOpenResponseGradesBatchWithContext: batch,
}))

import {
  answerId, assertPrivateOutput, buildComparisonPlan, measureOperation, questionKey, runComparison, validateTargets,
  type ComparisonCandidate,
} from '../../scripts/lib/test-grading-comparison'

const candidate = (label: string, overrides: Partial<ComparisonCandidate> = {}): ComparisonCandidate => ({
  classroom: 'synthetic-class', studentLabel: label, testTitle: 'Synthetic test',
  questionText: 'Explain a loop.', responseText: `Synthetic answer ${label}`,
  maxPoints: 5, answerKey: 'Repeated execution', sampleSolution: null,
  responseMonospace: false, teacherScore: 4, ...overrides,
})
const prices = { model: 'deepseek-flash', asOf: '2026-09-24', source: 'synthetic test rates', cachedInput: 1, uncachedInput: 2, output: 3 }
const payload = { usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20, prompt_cache_hit_tokens: 2, prompt_cache_miss_tokens: 8, completion_tokens_details: { reasoning_tokens: 5 } } }
const providerCall = () => fetch('https://api.deepseek.com/chat/completions', {
  method: 'POST', body: JSON.stringify({ model: 'deepseek-flash', reasoning_effort: 'high' }),
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('test grading comparison', () => {
  it('refuses public-looking output and overwriting any input, including filesystem aliases', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pika-comparison-'))
    try {
      const input = join(directory, 'targets.grading-analysis.json')
      const alias = join(directory, 'alias.grading-analysis.json')
      const hardlink = join(directory, 'hardlink.grading-analysis.json')
      writeFileSync(input, '{}')
      symlinkSync(input, alias)
      linkSync(input, hardlink)
      expect(() => assertPrivateOutput(join(directory, 'public.json'), [input])).toThrow(/gitignored/)
      expect(() => assertPrivateOutput(input, [input])).toThrow(/overwrite/)
      expect(() => assertPrivateOutput(alias, [input])).toThrow(/symlink/)
      expect(() => assertPrivateOutput(hardlink, [input])).toThrow(/overwrite/)
      expect(() => assertPrivateOutput(join(directory, 'new.grading-analysis.json'), [input])).not.toThrow()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('isolates question, classroom, rubric and coding boundaries', () => {
    const rows = [candidate('a'), candidate('b'), candidate('c', { classroom: 'other' }),
      candidate('d', { answerKey: 'Other rubric' }), candidate('e', { responseMonospace: true }),
      candidate('f', { sampleSolution: 'Different example' })]
    const [plan] = buildComparisonPlan(rows, [4], [1])
    expect(plan.chunks.map((chunk) => chunk.length).sort()).toEqual([1, 1, 1, 1, 2])
    for (const chunk of plan.chunks) expect(new Set(chunk.map(questionKey)).size).toBe(1)
  })

  it('holds answers fixed under shuffling and uses production-sized chunks with singleton tails', () => {
    const rows = Array.from({ length: 9 }, (_, i) => candidate(String(i)))
    const plans = buildComparisonPlan(rows, [1, 2, 4], [1, 2])
    expect(plans).toHaveLength(6)
    expect(buildComparisonPlan(rows, [1, 2, 4], [1, 2])).toEqual(plans)
    for (const plan of plans) {
      expect(plan.chunks.flat().map(answerId).sort()).toEqual(rows.map(answerId).sort())
      expect(plan.chunks.every((chunk) => chunk.length <= plan.batchSize)).toBe(true)
    }
    expect(plans.find((p) => p.batchSize === 4)?.chunks.map((c) => c.length)).toEqual([4, 4, 1])
    expect(plans[0].chunks.flat().map(answerId)).not.toEqual(plans[3].chunks.flat().map(answerId))
    expect(() => buildComparisonPlan(rows, [20], [1])).toThrow()
    expect(() => buildComparisonPlan([rows[0], rows[0]], [1], [1])).toThrow(/duplicate/i)
  })

  it('binds verified targets to exact input and rejects unknown, duplicate or invalid labels', () => {
    const row = candidate('a')
    const target = { answerId: answerId(row), minimum: 3, maximum: 4 }
    const document = { schemaVersion: 1, source: 'Synthetic adjudication', targets: [target] }
    expect(validateTargets(document, [row]).get(target.answerId)).toEqual(target)
    expect(() => validateTargets(document, [candidate('a', { responseText: 'Changed' })])).toThrow(/match/i)
    expect(() => validateTargets({ ...document, targets: [target, target] }, [row])).toThrow(/duplicate/i)
    expect(() => validateTargets({ ...document, targets: [{ ...target, maximum: 6 }] }, [row])).toThrow(/range/i)
    expect(() => validateTargets({ ...document, targets: [{ ...target, minimum: 5 }] }, [row])).toThrow(/range/i)
  })

  it('counts HTTP retries once, including tokens from a truncated response, and restores fetch', async () => {
    const original = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
    vi.stubGlobal('fetch', original)
    const result = await measureOperation(async () => {
      await providerCall(); await providerCall(); return 'graded'
    }, prices)
    expect(result.value).toBe('graded')
    expect(result.requests).toHaveLength(2)
    expect(result.costUsd).toBeCloseTo(0.000096)
    expect(result.requests[0].usage?.reasoningTokens).toBe(5)
    expect(globalThis.fetch).toBe(original)
    expect(JSON.stringify(result)).not.toContain('Authorization')
  })

  it('keeps observed spend when a retry fails and never treats missing usage or a different model as zero', async () => {
    const original = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(payload)))
      .mockRejectedValueOnce(new Error('private transport content'))
    vi.stubGlobal('fetch', original)
    const failed = await measureOperation(async () => { await providerCall(); await providerCall() }, prices)
    expect(failed.failed).toBe(true)
    expect(failed.requests).toHaveLength(2)
    expect(failed.costUsd).toBeNull()
    expect(failed.knownCostUsd).toBeCloseTo(0.000048)
    expect(JSON.stringify(failed)).not.toContain('private transport content')
    expect(globalThis.fetch).toBe(original)
    original.mockResolvedValue(new Response(JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 10 } })))
    expect((await measureOperation(providerCall, prices)).costUsd).toBeNull()
    original.mockResolvedValue(new Response(JSON.stringify(payload)))
    expect((await measureOperation(providerCall, { ...prices, model: 'other' })).costUsd).toBeNull()
  })

  it('runs the same profile and prepared references across scenarios, preserving missing answers and singleton tails', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => candidate(String(i)))
    prepare.mockResolvedValue({ reference_answers: ['reference'] })
    single.mockResolvedValue({ score: 4, feedback: 'Synthetic feedback', provenance: {} })
    batch.mockImplementation(async (_prepared, requests) => [{
      responseId: requests[0].responseId, score: 3, feedback: 'Synthetic feedback', provenance: {},
    }])
    const target = { answerId: answerId(rows[0]), minimum: 4, maximum: 5 }
    const result = await runComparison(rows, {
      profile: 'manual', batchSizes: [1, 2, 4], orderSeeds: [1],
      targets: new Map([[target.answerId, target]]),
    })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(prepare.mock.calls[0][0].promptProfile).toBe('manual')
    expect(result.scenarios.map((s) => s.rows.length)).toEqual([5, 5, 5])
    expect(result.scenarios[0].rows.every((r) => r.score === 4)).toBe(true)
    expect(result.scenarios[1].rows.filter((r) => r.failure === 'missing_result')).toHaveLength(2)
    expect(result.scenarios[2].rows.filter((r) => r.failure === 'missing_result')).toHaveLength(3)
    expect(single).toHaveBeenCalledTimes(7)
    expect(batch.mock.calls.every((call) => call[1].length > 1 && call[1].length <= 4)).toBe(true)
    expect(result.scenarios[0].rows.find((r) => r.answerId === target.answerId)?.targetDistance).toBe(0)
  })

  it('checks writable output before any provider work and retains every answer when preparation fails', async () => {
    const rows = [candidate('a'), candidate('b')]
    const options = { profile: 'bulk' as const, batchSizes: [1, 2], orderSeeds: [1], targets: new Map() }
    await expect(runComparison(rows, { ...options, checkpoint: () => { throw new Error('Output unavailable') } })).rejects.toThrow('Output unavailable')
    expect(prepare).not.toHaveBeenCalled()
    prepare.mockRejectedValue(new Error('private reference error'))
    const result = await runComparison(rows, options)
    expect(result.scenarios.map((scenario) => scenario.rows.length)).toEqual([2, 2])
    expect(result.scenarios.flatMap((scenario) => scenario.rows).every((row) => row.failure === 'preparation_failed')).toBe(true)
    expect(single).not.toHaveBeenCalled()
    expect(batch).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('private reference error')
  })
})
