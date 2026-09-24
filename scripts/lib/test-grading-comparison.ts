/** Offline comparison only. Never imported by application code or writes grades. */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import {
  prepareTestOpenResponseGradingContext,
  suggestTestOpenResponseGradeWithContext,
  suggestTestOpenResponseGradesBatchWithContext,
  type TestOpenResponsePromptProfile,
} from '@/lib/ai-test-grading'
import { PIKA_TEST_MAX_BATCH_RESPONSES } from '@/lib/grading/profiles/pika-test-open-response'

export interface ComparisonCandidate {
  classroom: string
  studentLabel: string
  testTitle: string
  questionText: string
  responseText: string
  maxPoints: number
  answerKey?: string | null
  sampleSolution?: string | null
  responseMonospace?: boolean
  questionType?: string
  teacherScore: number | null
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const questionKey = (row: ComparisonCandidate) => hash([
  row.classroom, row.testTitle, row.questionText, row.maxPoints,
  row.answerKey ?? null, row.sampleSolution ?? null, row.responseMonospace === true,
  row.questionType ?? null,
])
export const answerId = (row: ComparisonCandidate) => hash([questionKey(row), row.studentLabel, row.responseText])

function randomFor(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function groupsOf(rows: ComparisonCandidate[]) {
  const groups = new Map<string, ComparisonCandidate[]>()
  for (const row of rows) {
    const key = questionKey(row)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export function buildComparisonPlan(rows: ComparisonCandidate[], batchSizes: number[], orderSeeds: number[]) {
  if (!rows.length || new Set(rows.map(answerId)).size !== rows.length) throw new Error('Empty or duplicate comparison answers')
  if (!batchSizes.length || batchSizes.some((size) => ![1, 2, 4].includes(size) || size > PIKA_TEST_MAX_BATCH_RESPONSES)) {
    throw new Error('--batch-size must contain only 1, 2 or 4, within the production ceiling')
  }
  if (!orderSeeds.length || orderSeeds.some((seed) => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) {
    throw new Error('--order-seed must contain unsigned 32-bit integers')
  }
  return [...new Set(orderSeeds)].flatMap((orderSeed, seedIndex) => {
    const random = randomFor(orderSeed)
    const groups = groupsOf(rows).map(([, group]) => {
      const ordered = [...group].sort((a, b) => answerId(a).localeCompare(answerId(b)))
      for (let i = ordered.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[ordered[i], ordered[j]] = [ordered[j], ordered[i]]
      }
      return ordered
    })
    // Counterbalance first/last strategy across seeds; cache effects are still reported.
    const sizes = [...new Set(batchSizes)]
    if (seedIndex % 2) sizes.reverse()
    return sizes.map((batchSize) => ({
      batchSize, orderSeed,
      chunks: groups.flatMap((group) => {
        const chunks: ComparisonCandidate[][] = []
        for (let i = 0; i < group.length; i += batchSize) chunks.push(group.slice(i, i + batchSize))
        return chunks
      }),
    }))
  })
}

const targetSchema = z.object({ answerId: z.string().regex(/^[a-f0-9]{64}$/), minimum: z.number().finite().nonnegative(), maximum: z.number().finite().nonnegative() })
export type VerifiedTarget = z.infer<typeof targetSchema>
export function validateTargets(document: unknown, population: ComparisonCandidate[]) {
  const parsed = z.object({ schemaVersion: z.literal(1), source: z.string().min(1), targets: z.array(targetSchema).min(1) }).parse(document)
  const result = new Map<string, VerifiedTarget>()
  for (const target of parsed.targets) {
    if (result.has(target.answerId)) throw new Error('Duplicate verified target')
    const matches = population.filter((row) => answerId(row) === target.answerId)
    if (matches.length !== 1) throw new Error('Verified target must match exactly one unchanged input answer')
    if (target.minimum > target.maximum || target.maximum > matches[0].maxPoints) throw new Error('Verified target range is invalid')
    result.set(target.answerId, target)
  }
  return result
}

export const pricingSchema = z.object({
  model: z.string().min(1), asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source: z.string().min(1),
  cachedInput: z.number().finite().nonnegative(), uncachedInput: z.number().finite().nonnegative(), output: z.number().finite().nonnegative(),
})
export type ComparisonPricing = z.infer<typeof pricingSchema>

export function assertPrivateOutput(output: string, inputs: string[]) {
  if (!output.endsWith('.grading-analysis.json')) throw new Error('Comparison output must end in .grading-analysis.json (gitignored private data)')
  if (existsSync(output) && lstatSync(output).isSymbolicLink()) throw new Error('Comparison output must not be a symlink')
  const identity = (path: string) => existsSync(path) ? realpathSync(path) : resolve(path)
  const outputStat = existsSync(output) ? statSync(output) : null
  for (const input of inputs) {
    const inputStat = existsSync(input) ? statSync(input) : null
    if (identity(input) === identity(output) || (outputStat && inputStat && outputStat.dev === inputStat.dev && outputStat.ino === inputStat.ino)) {
      throw new Error('Comparison output must not overwrite an input file')
    }
  }
}

type Usage = Record<'inputTokens' | 'outputTokens' | 'totalTokens' | 'cachedInputTokens' | 'uncachedInputTokens' | 'reasoningTokens', number | null>
interface ProviderRequest {
  model: string | null
  reasoningEffort: string | null
  startedAt: string
  elapsedMs: number
  status: number | null
  usage: Usage | null
  costUsd: number | null
}
const integer = (value: unknown): number | null => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
const record = (value: unknown): Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function readUsage(payload: unknown): Usage | null {
  const usage = record(record(payload).usage)
  if (!Object.keys(usage).length) return null
  return {
    inputTokens: integer(usage.prompt_tokens), outputTokens: integer(usage.completion_tokens), totalTokens: integer(usage.total_tokens),
    cachedInputTokens: integer(usage.prompt_cache_hit_tokens), uncachedInputTokens: integer(usage.prompt_cache_miss_tokens),
    reasoningTokens: integer(record(usage.completion_tokens_details).reasoning_tokens),
  }
}

function costOf(request: ProviderRequest, pricing?: ComparisonPricing) {
  const u = request.usage
  if (!pricing || request.model !== pricing.model || !u || u.inputTokens == null || u.outputTokens == null
    || u.cachedInputTokens == null || u.uncachedInputTokens == null
    || u.cachedInputTokens + u.uncachedInputTokens !== u.inputTokens) return null
  return (u.cachedInputTokens * pricing.cachedInput + u.uncachedInputTokens * pricing.uncachedInput + u.outputTokens * pricing.output) / 1_000_000
}

let measuring = false
/** Script-scoped observer captures retries and failed-call usage without changing production adapters.
 * Only allowlisted usage/operation metadata survive; no prompts, headers, bodies or error text. */
export async function measureOperation<T>(operation: () => Promise<T>, pricing?: ComparisonPricing) {
  if (measuring) throw new Error('Comparison measurements must run sequentially')
  measuring = true
  const originalFetch = globalThis.fetch
  const requests: ProviderRequest[] = []
  const started = performance.now()
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url !== 'https://api.deepseek.com/chat/completions') return originalFetch(input, init)
    let metadata: Record<string, unknown> = {}
    try { metadata = record(JSON.parse(typeof init?.body === 'string' ? init.body : '{}')) } catch { /* unknown metadata remains unknown */ }
    const request: ProviderRequest = {
      model: typeof metadata.model === 'string' ? metadata.model : null,
      reasoningEffort: typeof metadata.reasoning_effort === 'string' ? metadata.reasoning_effort : null,
      startedAt: new Date().toISOString(), elapsedMs: 0, status: null, usage: null, costUsd: null,
    }
    requests.push(request)
    const requestStarted = performance.now()
    try {
      const response = await originalFetch(input, init)
      request.status = response.status
      try { request.usage = readUsage(await response.clone().json()) } catch { /* timeout/invalid body has no measured usage */ }
      request.costUsd = costOf(request, pricing)
      return response
    } finally { request.elapsedMs = performance.now() - requestStarted }
  }
  let value: T | undefined
  let failed = false
  try { value = await operation() } catch { failed = true } finally {
    globalThis.fetch = originalFetch
    measuring = false
  }
  const knownCostUsd = requests.reduce((sum, request) => sum + (request.costUsd ?? 0), 0)
  return {
    value, failed, elapsedMs: performance.now() - started, requests, knownCostUsd,
    costUsd: requests.every((request) => request.costUsd != null) ? knownCostUsd : null,
  }
}

type Measurement = Omit<Awaited<ReturnType<typeof measureOperation>>, 'value'>
interface Operation extends Measurement { id: number; kind: 'prepare' | 'single' | 'batch'; answerIds: string[] }
interface ComparisonRow {
  answerId: string
  score: number | null
  feedback: string | null
  recordedScoreDelta: number | null
  targetDistance: number | null
  failure: 'preparation_failed' | 'grading_failed' | 'missing_result' | null
  operationId: number
  latencyMs: number
  allocatedCostUsd: number | null
  provenance: unknown
}
interface Scenario {
  batchSize: number
  orderSeed: number
  manifest: string[][]
  operations: Operation[]
  rows: ComparisonRow[]
}
export interface ComparisonResult {
  complete: boolean
  profile: TestOpenResponsePromptProfile
  effort: 'production-default'
  pricing: ComparisonPricing | null
  answers: Array<{ answerId: string; classroom: string; studentLabel: string; testTitle: string; maxPoints: number; teacherScore: number | null; target: VerifiedTarget | null }>
  preparation: Operation[]
  scenarios: Scenario[]
}

export async function runComparison(rows: ComparisonCandidate[], opts: {
  profile: TestOpenResponsePromptProfile
  batchSizes: number[]
  orderSeeds: number[]
  targets: Map<string, VerifiedTarget>
  pricing?: ComparisonPricing
  checkpoint?: (result: ComparisonResult) => void
}): Promise<ComparisonResult> {
  const plans = buildComparisonPlan(rows, opts.batchSizes, opts.orderSeeds)
  const result: ComparisonResult = {
    complete: false, profile: opts.profile, effort: 'production-default', pricing: opts.pricing ?? null,
    answers: rows.map((row) => ({ answerId: answerId(row), classroom: row.classroom, studentLabel: row.studentLabel,
      testTitle: row.testTitle, maxPoints: row.maxPoints, teacherScore: row.teacherScore, target: opts.targets.get(answerId(row)) ?? null })),
    preparation: [], scenarios: [],
  }
  // Fail unwritable output before the first paid request, and preserve a crash checkpoint.
  opts.checkpoint?.(result)
  type Prepared = Awaited<ReturnType<typeof prepareTestOpenResponseGradingContext>>
  const prepared = new Map<string, Prepared>()
  const preparationByQuestion = new Map<string, Operation>()
  let operationId = 0
  for (const [key, group] of groupsOf(rows)) {
    const row = group[0]
    const { value, ...measurement } = await measureOperation(() => prepareTestOpenResponseGradingContext({
      testTitle: row.testTitle, questionText: row.questionText, maxPoints: row.maxPoints,
      answerKey: row.answerKey, sampleSolution: row.sampleSolution, responseMonospace: row.responseMonospace,
      promptProfile: opts.profile,
    }), opts.pricing)
    const operation: Operation = { ...measurement, id: operationId++, kind: 'prepare', answerIds: group.map(answerId) }
    result.preparation.push(operation)
    preparationByQuestion.set(key, operation)
    if (value) prepared.set(key, value)
    opts.checkpoint?.(result)
  }
  for (const plan of plans) {
    const scenario: Scenario = { batchSize: plan.batchSize, orderSeed: plan.orderSeed, manifest: plan.chunks.map((chunk) => chunk.map(answerId)), operations: [], rows: [] }
    result.scenarios.push(scenario)
    for (const chunk of plan.chunks) {
      const key = questionKey(chunk[0])
      const context = prepared.get(key)
      if (!context) {
        const preparation = preparationByQuestion.get(key)!
        scenario.rows.push(...chunk.map((row): ComparisonRow => ({ answerId: answerId(row), score: null, feedback: null,
          recordedScoreDelta: null, targetDistance: null, failure: 'preparation_failed', operationId: preparation.id,
          latencyMs: preparation.elapsedMs, allocatedCostUsd: null, provenance: null })))
        opts.checkpoint?.(result)
        continue
      }
      const { value, ...measurement } = await measureOperation(async () => {
        if (chunk.length === 1) {
          const suggestion = await suggestTestOpenResponseGradeWithContext(context, chunk[0].responseText)
          return [{ ...suggestion, responseId: answerId(chunk[0]) }]
        }
        return suggestTestOpenResponseGradesBatchWithContext(context, chunk.map((row) => ({ responseId: answerId(row), responseText: row.responseText })))
      }, opts.pricing)
      const operation: Operation = { ...measurement, id: operationId++, kind: chunk.length === 1 ? 'single' : 'batch', answerIds: chunk.map(answerId) }
      scenario.operations.push(operation)
      const byId = new Map(value?.map((suggestion) => [suggestion.responseId, suggestion]))
      for (const row of chunk) {
        const id = answerId(row)
        const suggestion = byId.get(id)
        const target = opts.targets.get(id)
        scenario.rows.push({
          answerId: id, score: suggestion?.score ?? null, feedback: suggestion?.feedback ?? null,
          recordedScoreDelta: suggestion && row.teacherScore != null ? suggestion.score - row.teacherScore : null,
          targetDistance: suggestion && target ? Math.max(target.minimum - suggestion.score, suggestion.score - target.maximum, 0) : null,
          failure: measurement.failed ? 'grading_failed' : !suggestion ? 'missing_result' : null,
          operationId: operation.id, latencyMs: operation.elapsedMs,
          allocatedCostUsd: operation.costUsd == null ? null : operation.costUsd / chunk.length,
          provenance: suggestion?.provenance ?? null,
        })
      }
      opts.checkpoint?.(result)
    }
  }
  result.complete = true
  opts.checkpoint?.(result)
  return result
}

export function summarizeComparison(result: ComparisonResult) {
  return result.scenarios.map((scenario) => {
    const verified = scenario.rows.filter((row) => row.targetDistance != null)
    const requests = scenario.operations.flatMap((operation) => operation.requests)
    const knownCostUsd = scenario.operations.reduce((sum, operation) => sum + operation.knownCostUsd, 0)
    const measured = requests.filter((request) => request.costUsd != null).length
    const elapsedMs = scenario.operations.reduce((sum, operation) => sum + operation.elapsedMs, 0)
    const latencies = scenario.rows.filter((row) => row.failure !== 'preparation_failed').map((row) => row.latencyMs).sort((a, b) => a - b)
    const tokens = (key: keyof Usage) => requests.every((request) => request.usage?.[key] != null)
      ? requests.reduce((sum, request) => sum + request.usage![key]!, 0) : null
    const baseline = result.scenarios.find((other) => other.orderSeed === scenario.orderSeed && other.batchSize === 1)
    const pairs = scenario.rows.flatMap((row) => {
      const other = baseline?.rows.find((entry) => entry.answerId === row.answerId)
      return row.score != null && other?.score != null ? [row.score - other.score] : []
    })
    return {
      batchSize: scenario.batchSize, orderSeed: scenario.orderSeed, attempted: scenario.rows.length,
      succeeded: scenario.rows.filter((row) => row.score != null).length, failures: scenario.rows.filter((row) => row.failure).length,
      verifiedTotal: result.answers.filter((row) => row.target).length, verifiedScored: verified.length,
      withinVerifiedRange: verified.filter((row) => row.targetDistance === 0).length,
      meanDistanceFromVerifiedRange: verified.length ? verified.reduce((sum, row) => sum + row.targetDistance!, 0) / verified.length : null,
      pairedWithSingle: pairs.length, changedFromSingle: pairs.filter((delta) => delta !== 0).length,
      meanAbsoluteChangeFromSingle: pairs.length ? pairs.reduce((sum, delta) => sum + Math.abs(delta), 0) / pairs.length : null,
      httpRequests: requests.length, requestsWithMeasuredCost: measured, knownCostUsd,
      inputTokens: tokens('inputTokens'), cachedInputTokens: tokens('cachedInputTokens'), uncachedInputTokens: tokens('uncachedInputTokens'),
      outputTokens: tokens('outputTokens'), reasoningTokens: tokens('reasoningTokens'),
      costUsd: measured === requests.length ? knownCostUsd : null,
      elapsedMs, amortizedMsPerAnswer: scenario.rows.length ? elapsedMs / scenario.rows.length : null,
      meanAnswerLatencyMs: latencies.length ? latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length : null,
      p95AnswerLatencyMs: latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1] : null,
    }
  })
}

export function summarizeOrderSensitivity(result: ComparisonResult) {
  return [...new Set(result.scenarios.map((scenario) => scenario.batchSize))].map((batchSize) => {
    const scenarios = result.scenarios.filter((scenario) => scenario.batchSize === batchSize)
    const ranges = result.answers.flatMap((answer) => {
      const scores = scenarios.map((scenario) => scenario.rows.find((row) => row.answerId === answer.answerId)?.score)
      if (scenarios.length < 2 || scores.some((score) => score == null)) return []
      const completeScores = scores as number[]
      return [Math.max(...completeScores) - Math.min(...completeScores)]
    })
    return { batchSize, orderSeeds: scenarios.map((scenario) => scenario.orderSeed), fullyScoredAcrossSeeds: ranges.length,
      changedAcrossSeeds: ranges.filter((range) => range > 0).length,
      meanScoreRange: ranges.length ? ranges.reduce((sum, range) => sum + range, 0) / ranges.length : null,
      maxScoreRange: ranges.length ? Math.max(...ranges) : null }
  })
}
