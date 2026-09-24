/**
 * Triage disagreements between AI test grading and the teacher's recorded
 * marks, over a stratified sample of exported snapshots.
 *
 * This is NOT an accuracy measurement. The teacher's marks are a second
 * opinion, not ground truth — they were recorded during live marking and may
 * contain errors and omissions. Every disagreement this tool reports is a
 * candidate for human adjudication, and may resolve as either an AI error or a
 * marking error. The output is ordered so the sharpest disagreements are
 * reviewed first.
 *
 * Never writes a grade anywhere and is never imported by application code.
 *
 * Sampling is stratified by (classroom, maxPoints). It defaults to a balanced
 * allocation — equal n per cell — because the question is whether the grader
 * drifts differently between point scales, which needs comparable cells rather
 * than a cell that mirrors the population. Pass --allocation proportional for a
 * representative sample of typical responses instead.
 *
 * Reasoning effort dominates cost on this path: the graded answer is only a
 * score and a sentence, but `medium` maps to DeepSeek's 'high' thinking tier and
 * spends most of its output on reasoning. --effort takes a comma-separated list
 * and grades the same sampled responses at each level, so the token cost and any
 * score change are measured on identical work. minimal and low share a provider
 * tier, so low vs medium is the comparison that means something.
 *
 * Usage:
 *   pnpm calibrate:test-grading --dry-run
 *   pnpm calibrate:test-grading --sample 80 --seed 1
 *   pnpm calibrate:test-grading --effort low,medium
 *   pnpm calibrate:test-grading --allocation proportional
 *   pnpm calibrate:test-grading --all --profiles both
 *   pnpm calibrate:test-grading --all --max-points 10 --batch-size 1,2,4 --order-seed 1,2 --profile bulk --dry-run
 *   pnpm calibrate:test-grading a.grading-snapshot.json b.grading-snapshot.json
 *
 * Comparison options, private verified targets and reference-rate pricing:
 * docs/guidance/test-grading-comparison.md
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { z } from 'zod'
import {
  suggestTestOpenResponseGrade,
  type TestOpenResponsePromptProfile,
} from '@/lib/ai-test-grading'
import type { StructuredOutputRequest } from '@/lib/grading/providers/types'
import {
  answerId, assertPrivateOutput, buildComparisonPlan, pricingSchema, runComparison, summarizeComparison,
  summarizeOrderSensitivity, validateTargets, type ComparisonResult,
} from './lib/test-grading-comparison'

type EffortLevel = StructuredOutputRequest['reasoningEffort']
const EFFORT_LEVELS: EffortLevel[] = ['minimal', 'low', 'medium', 'high']
// Ascending cost. The provider collapses minimal and low onto the same tier, so
// the primary result is read off the highest level requested.
const EFFORT_ORDER: Record<EffortLevel, number> = { minimal: 0, low: 1, medium: 2, high: 3 }

const DEFAULT_SNAPSHOTS = [
  'hl2v24-test.grading-snapshot.json',
  'tzxc84-test.grading-snapshot.json',
]
const DEFAULT_SAMPLE = 80
const DEFAULT_SEED = 1
// Must keep the `.grading-analysis.json` suffix: that is what .gitignore
// matches, and these rows contain student work.
const DEFAULT_OUT = 'test.grading-analysis.json'
const QUESTION_PREVIEW_CHARS = 160
const DEFAULT_EFFORT: EffortLevel[] = ['medium']

const responseSchema = z.object({
  testTitle: z.string(),
  questionText: z.string(),
  responseText: z.string(),
  responseMonospace: z.boolean().optional(),
  answerKey: z.string().nullable().optional(),
  sampleSolution: z.string().nullable().optional(),
  maxPoints: z.number(),
  questionType: z.string(),
  studentLabel: z.string(),
  teacherScore: z.number().nullable(),
})

const snapshotSchema = z.object({
  exportedAt: z.string(),
  schemaVersion: z.union([z.string(), z.number()]),
  responses: z.array(responseSchema),
})

type SnapshotResponse = z.infer<typeof responseSchema>

interface Candidate extends SnapshotResponse {
  classroom: string
  teacherScore: number
}

interface RunResult {
  effort: EffortLevel
  profile: TestOpenResponsePromptProfile
  aiScore: number
  rawDelta: number
  normalizedDelta: number
  aiFeedback: string
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

interface GradedRow {
  classroom: string
  studentLabel: string
  testTitle: string
  questionPreview: string
  maxPoints: number
  teacherScore: number
  runs: RunResult[]
  /** Highest effort on the bulk profile — what production would have produced. */
  primaryNormalizedDelta: number
  /** Score change from the cheapest to the dearest effort, bulk profile. */
  effortScoreDelta?: number
  /** manual minus bulk at the primary effort, when both profiles ran. */
  parityDelta?: number
}

/**
 * A response the provider refused to grade. Recorded rather than thrown so one bad
 * response cannot discard an entire run — at 80 calls a run is expensive enough that
 * all-or-nothing is the wrong failure mode. Grading errors are content-free by
 * contract, so the message carries no student work.
 */
interface FailedRow {
  classroom: string
  studentLabel: string
  testTitle: string
  maxPoints: number
  reason: string
}

/** Deterministic PRNG so a given --seed always selects the same sample. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function classroomFromPath(path: string): string {
  return basename(path).replace(/-test\.grading-snapshot\.json$/, '').replace(/\.grading-snapshot\.json$/, '')
}

function cellKey(classroom: string, maxPoints: number): string {
  return `${classroom} @ ${maxPoints}pt`
}

function loadCandidates(paths: string[]): Candidate[] {
  const candidates: Candidate[] = []
  for (const path of paths) {
    if (!existsSync(path)) {
      throw new Error(`Snapshot not found: ${path}`)
    }
    const snapshot = snapshotSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    const classroom = classroomFromPath(path)
    for (const response of snapshot.responses) {
      // Only marked work can be disagreed with.
      if (response.teacherScore == null) continue
      candidates.push({ ...response, classroom, teacherScore: response.teacherScore })
    }
  }
  return candidates
}

type AllocationMode = 'balanced' | 'proportional'

function buildCells(candidates: Candidate[]): Map<string, Candidate[]> {
  const cells = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    const key = cellKey(candidate.classroom, candidate.maxPoints)
    const cell = cells.get(key)
    if (cell) cell.push(candidate)
    else cells.set(key, [candidate])
  }
  return cells
}

/**
 * Equalize n across cells, so per-cell drift is comparable between point
 * scales. A cell smaller than its even share is capped at its population and
 * the freed capacity is re-spread over the cells that still have room. This is
 * the default because the tool exists to ask whether the grader drifts
 * *differently* on a 3-point question than a 10-point one, and a cell of three
 * responses cannot separate drift from noise.
 */
function balancedAllocation(cells: Map<string, Candidate[]>, target: number): Map<string, number> {
  const keys = [...cells.keys()].sort()
  const capacity = new Map(keys.map((key) => [key, (cells.get(key) as Candidate[]).length]))
  const allocation = new Map(keys.map((key) => [key, 0]))
  const totalCapacity = keys.reduce((sum, key) => sum + (capacity.get(key) as number), 0)
  let remaining = Math.min(target, totalCapacity)

  // Each pass hands every uncapped cell an equal share. Cells that fill up drop
  // out, and their unused share is re-spread on the next pass.
  let open = keys.filter((key) => (capacity.get(key) as number) > 0)
  while (remaining > 0 && open.length > 0) {
    const share = Math.floor(remaining / open.length)
    if (share === 0) break
    let progressed = false
    for (const key of open) {
      const room = (capacity.get(key) as number) - (allocation.get(key) as number)
      const give = Math.min(share, room)
      if (give > 0) {
        allocation.set(key, (allocation.get(key) as number) + give)
        remaining -= give
        progressed = true
      }
    }
    open = open.filter((key) => (allocation.get(key) as number) < (capacity.get(key) as number))
    if (!progressed) break
  }

  // Fewer left than there are cells: hand them out one apiece in key order so
  // the result stays reproducible.
  while (remaining > 0) {
    const withRoom = keys.filter((key) => (allocation.get(key) as number) < (capacity.get(key) as number))
    if (withRoom.length === 0) break
    for (const key of withRoom) {
      if (remaining <= 0) break
      allocation.set(key, (allocation.get(key) as number) + 1)
      remaining -= 1
    }
  }

  return allocation
}

/**
 * Mirror the population: every cell gets at least one row, and the remainder is
 * distributed by cell size. Use this when a representative sample of typical
 * responses matters more than per-cell comparability.
 */
function proportionalAllocation(cells: Map<string, Candidate[]>, target: number): Map<string, number> {
  const keys = [...cells.keys()].sort()
  const population = keys.reduce((sum, key) => sum + (cells.get(key) as Candidate[]).length, 0)
  const allocation = new Map<string, number>()
  let remaining = Math.min(target, population)

  for (const key of keys) {
    allocation.set(key, 1)
    remaining -= 1
  }
  // Negative remaining means more cells than the requested sample; the floor of
  // one per cell wins, and the sample comes out slightly larger than asked.
  if (remaining > 0) {
    const pool = population - keys.length
    let handedOut = 0
    const shares = keys.map((key) => {
      const size = (cells.get(key) as Candidate[]).length - 1
      const share = pool > 0 ? Math.floor((size / pool) * remaining) : 0
      handedOut += share
      return { key, share, size }
    })
    // Hand leftovers to the largest cells first.
    const leftover = remaining - handedOut
    shares.sort((a, b) => b.size - a.size)
    for (let i = 0; i < leftover; i++) {
      shares[i % shares.length].share += 1
    }
    for (const { key, share } of shares) {
      const cell = cells.get(key) as Candidate[]
      allocation.set(key, Math.min(cell.length, (allocation.get(key) as number) + share))
    }
  }

  return allocation
}

function stratify(
  candidates: Candidate[],
  target: number,
  random: () => number,
  mode: AllocationMode,
): Candidate[] {
  const cells = buildCells(candidates)

  if (target >= candidates.length) {
    const keys = [...cells.keys()].sort()
    return keys.flatMap((key) => shuffled(cells.get(key) as Candidate[], random))
  }

  const allocation = mode === 'balanced'
    ? balancedAllocation(cells, target)
    : proportionalAllocation(cells, target)

  return [...cells.keys()].sort().flatMap((key) => {
    const cell = cells.get(key) as Candidate[]
    return shuffled(cell, random).slice(0, allocation.get(key) as number)
  })
}

function hasAnswerKey(response: SnapshotResponse): boolean {
  return typeof response.answerKey === 'string' && response.answerKey.trim().length > 0
}

/** Questions without an answer key cost one extra call to build references. */
function referenceGenerationCount(sample: Candidate[]): number {
  const keyless = new Set<string>()
  for (const candidate of sample) {
    if (!hasAnswerKey(candidate)) keyless.add(candidate.questionText)
  }
  return keyless.size
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function describePlan(
  sample: Candidate[],
  population: Candidate[],
  profiles: TestOpenResponsePromptProfile[],
  efforts: EffortLevel[],
  mode: AllocationMode,
): void {
  const sampled = new Map<string, number>()
  for (const candidate of sample) {
    const key = cellKey(candidate.classroom, candidate.maxPoints)
    sampled.set(key, (sampled.get(key) ?? 0) + 1)
  }
  const available = new Map<string, number>()
  for (const candidate of population) {
    const key = cellKey(candidate.classroom, candidate.maxPoints)
    available.set(key, (available.get(key) ?? 0) + 1)
  }
  console.log(`Sampling plan (${mode} allocation)`)
  console.table(
    [...sampled.entries()].sort().map(([cell, count]) => ({
      cell,
      sampled: count,
      available: available.get(cell) ?? 0,
    })),
  )
  const grading = sample.length * profiles.length * efforts.length
  const references = referenceGenerationCount(sample)
  console.log(
    `Provider calls: ${grading} grading (${sample.length} responses × ${profiles.length} profile${profiles.length > 1 ? 's' : ''} × ${efforts.length} effort level${efforts.length > 1 ? 's' : ''} [${efforts.join(', ')}])` +
      ` + ${references} reference generation = ${grading + references} total`,
  )
  if (references > 0) {
    console.log(
      `  (${references} sampled question${references > 1 ? 's have' : ' has'} no answer key; references are generated once per question at the default effort and reused across levels)`,
    )
  }
}

/** Agreement profile for one set of runs, against the teacher's recorded mark. */
function agreementOf(label: string, runs: RunResult[]) {
  const n = runs.length
  if (n === 0) return { group: label, n: 0 }
  const meanRaw = runs.reduce((sum, run) => sum + run.rawDelta, 0) / n
  const meanNorm = runs.reduce((sum, run) => sum + run.normalizedDelta, 0) / n
  const meanAbsNorm = runs.reduce((sum, run) => sum + Math.abs(run.normalizedDelta), 0) / n
  return {
    group: label,
    n,
    aiHarsher: runs.filter((run) => run.rawDelta < 0).length,
    agreed: runs.filter((run) => run.rawDelta === 0).length,
    aiLenient: runs.filter((run) => run.rawDelta > 0).length,
    meanRawDelta: Number(meanRaw.toFixed(2)),
    meanNormDelta: Number(meanNorm.toFixed(3)),
    meanAbsNormDelta: Number(meanAbsNorm.toFixed(3)),
  }
}

function tokensOf(label: string, runs: RunResult[]) {
  const out = runs.map((run) => run.outputTokens ?? 0)
  const total = runs.reduce((sum, run) => sum + (run.totalTokens ?? 0), 0)
  return {
    group: label,
    calls: runs.length,
    medianOutput: Math.round(median(out)),
    maxOutput: out.length > 0 ? Math.max(...out) : 0,
    totalTokens: total,
  }
}

function summarize(rows: GradedRow[], efforts: EffortLevel[], profiles: TestOpenResponsePromptProfile[]): void {
  const allRuns = rows.flatMap((row) => row.runs)
  const primary = (row: GradedRow) => row.runs.find((run) => run.profile === 'bulk')
    ?? row.runs[0]

  console.log('\nToken spend by effort level')
  console.table(efforts.map((effort) => tokensOf(effort, allRuns.filter((run) => run.effort === effort))))

  console.log('Token spend by cell, at each effort level')
  const cells = [...new Set(rows.map((row) => cellKey(row.classroom, row.maxPoints)))].sort()
  console.table(
    cells.flatMap((cell) => efforts.map((effort) => tokensOf(
      `${cell} · ${effort}`,
      rows.filter((row) => cellKey(row.classroom, row.maxPoints) === cell)
        .flatMap((row) => row.runs.filter((run) => run.effort === effort)),
    ))),
  )

  console.log('Agreement with the recorded mark, by effort level (negative = AI scored below the teacher)')
  console.table(efforts.map((effort) => agreementOf(
    effort,
    allRuns.filter((run) => run.effort === effort && run.profile === 'bulk'),
  )))

  console.log('Agreement by cell, at the primary effort level')
  console.table(cells.map((cell) => agreementOf(
    cell,
    rows.filter((row) => cellKey(row.classroom, row.maxPoints) === cell)
      .map((row) => primary(row))
      .filter((run): run is RunResult => run != null),
  )))

  // The cost/quality question: does the dearer level actually score differently?
  if (efforts.length > 1) {
    const cheapest = efforts[0]
    const dearest = efforts[efforts.length - 1]
    const paired = rows
      .map((row) => {
        const low = row.runs.find((run) => run.effort === cheapest && run.profile === 'bulk')
        const high = row.runs.find((run) => run.effort === dearest && run.profile === 'bulk')
        return low && high ? { low, high, maxPoints: row.maxPoints } : null
      })
      .filter((pair): pair is { low: RunResult; high: RunResult; maxPoints: number } => pair != null)

    if (paired.length > 0) {
      const changed = paired.filter((pair) => pair.low.aiScore !== pair.high.aiScore)
      const diffs = changed.map((pair) => Math.abs(pair.high.aiScore - pair.low.aiScore))
      const lowTokens = paired.reduce((sum, pair) => sum + (pair.low.totalTokens ?? 0), 0)
      const highTokens = paired.reduce((sum, pair) => sum + (pair.high.totalTokens ?? 0), 0)
      const ratio = lowTokens > 0 ? (highTokens / lowTokens).toFixed(1) : 'n/a'
      const closerToTeacher = changed.filter(
        (pair) => Math.abs(pair.high.rawDelta) < Math.abs(pair.low.rawDelta),
      ).length
      const fartherFromTeacher = changed.filter(
        (pair) => Math.abs(pair.high.rawDelta) > Math.abs(pair.low.rawDelta),
      ).length

      console.log(`\nPaired comparison: ${cheapest} vs ${dearest}, same ${paired.length} responses, bulk profile`)
      console.table([{
        responses: paired.length,
        sameScore: paired.length - changed.length,
        differentScore: changed.length,
        meanAbsChange: changed.length > 0 ? Number((diffs.reduce((a, b) => a + b, 0) / changed.length).toFixed(2)) : 0,
        maxAbsChange: diffs.length > 0 ? Math.max(...diffs) : 0,
        tokenRatio: `${ratio}x`,
      }])
      console.log(
        `Of the ${changed.length} response${changed.length === 1 ? '' : 's'} where the score changed, ` +
          `${closerToTeacher} moved toward the recorded mark and ${fartherFromTeacher} away from it.`,
      )
      if (changed.length === 0) {
        console.log(
          `${dearest} never changed a score while costing ${ratio}x the tokens. On this sample the extra reasoning bought nothing.`,
        )
      }
      console.log(
        'Moving toward the recorded mark is not proof of improvement either, since that mark is itself under review.',
      )
    }
  }

  if (profiles.length > 1) {
    const parity = rows.filter((row) => row.parityDelta != null)
    const disagreeing = parity.filter((row) => Math.abs(row.parityDelta as number) > 1)
    console.log(
      `\nManual vs bulk parity: ${disagreeing.length} of ${parity.length} differ by more than 1 point.`,
    )
  }

  console.log(
    '\nThese are disagreements, not errors. Each one is either the grader missing something or the original mark missing something; both need a human to say which.',
  )
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const flag = (name: string): string | null => {
    const index = argv.indexOf(name)
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null
  }
  const dryRun = argv.includes('--dry-run')
  const useAll = argv.includes('--all')
  const bothProfiles = flag('--profiles') === 'both'
  const sampleSize = Number(flag('--sample') ?? DEFAULT_SAMPLE)
  const seed = Number(flag('--seed') ?? DEFAULT_SEED)
  const outPath = flag('--out') ?? DEFAULT_OUT
  const allocationArg = flag('--allocation') ?? 'balanced'
  const effortArg = flag('--effort')
  const maxPointsArg = flag('--max-points')
  const comparisonFlags = ['--batch-size', '--order-seed', '--profile', '--verified-targets', '--pricing']
  const comparison = comparisonFlags.some((name) => argv.includes(name))
  const valueFlags = new Set([
    '--sample', '--seed', '--profiles', '--out', '--allocation', '--effort', '--max-points',
    ...comparisonFlags,
  ])
  for (const [index, arg] of argv.entries()) {
    if (arg.startsWith('--') && !valueFlags.has(arg) && !['--all', '--dry-run'].includes(arg)) throw new Error(`Unknown option: ${arg}`)
    if (valueFlags.has(arg) && (argv[index + 1] == null || argv[index + 1].startsWith('--'))) throw new Error(`Missing value for ${arg}`)
  }
  const snapshotPaths = argv.filter((arg, index) => {
    if (arg.startsWith('--')) return false
    const previous = argv[index - 1]
    return !(previous && valueFlags.has(previous))
  })
  const paths = snapshotPaths.length > 0 ? snapshotPaths : DEFAULT_SNAPSHOTS

  if (!Number.isInteger(sampleSize) || sampleSize < 1) {
    console.error('--sample must be a positive number.')
    process.exitCode = 1
    return
  }
  if (allocationArg !== 'balanced' && allocationArg !== 'proportional') {
    console.error('--allocation must be "balanced" or "proportional".')
    process.exitCode = 1
    return
  }
  const allocation: AllocationMode = allocationArg

  let maxPointsFilter: number | null = null
  if (maxPointsArg != null) {
    maxPointsFilter = Number(maxPointsArg)
    if (!Number.isInteger(maxPointsFilter) || maxPointsFilter < 1) {
      console.error('--max-points must be a positive whole number.')
      process.exitCode = 1
      return
    }
  }

  const requested = effortArg
    ? effortArg.split(',').map((value) => value.trim()).filter(Boolean)
    : DEFAULT_EFFORT
  const invalid = requested.filter((value) => !EFFORT_LEVELS.includes(value as EffortLevel))
  if (invalid.length > 0) {
    console.error(`Unknown effort level(s): ${invalid.join(', ')}. Valid: ${EFFORT_LEVELS.join(', ')}.`)
    process.exitCode = 1
    return
  }
  const efforts = [...new Set(requested as EffortLevel[])].sort(
    (a, b) => EFFORT_ORDER[a] - EFFORT_ORDER[b],
  )
  // The provider maps minimal and low onto the same thinking tier, so asking
  // for both spends twice to measure nothing.
  if (efforts.includes('minimal') && efforts.includes('low')) {
    console.error(
      'minimal and low map to the same provider tier; comparing them measures nothing. Use low vs medium.',
    )
    process.exitCode = 1
    return
  }

  const allCandidates = loadCandidates(paths)
  // Narrowing to one point scale lets a question-shaped hypothesis be tested against that
  // whole population rather than the handful a balanced sample would reach.
  const candidates = maxPointsFilter == null
    ? allCandidates
    : allCandidates.filter((candidate) => candidate.maxPoints === maxPointsFilter)
  if (candidates.length === 0) {
    console.error(
      maxPointsFilter == null
        ? 'No responses with a teacher score were found.'
        : `No scored responses worth ${maxPointsFilter} points were found.`,
    )
    process.exitCode = 1
    return
  }
  if (maxPointsFilter != null) {
    console.log(
      `Filtered to ${candidates.length} of ${allCandidates.length} scored responses at ${maxPointsFilter} points.`,
    )
  }

  const profiles: TestOpenResponsePromptProfile[] = bothProfiles ? ['bulk', 'manual'] : ['bulk']
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('--seed must be an unsigned 32-bit integer')
  const random = mulberry32(seed)
  const sample = useAll
    ? stratify(candidates, candidates.length, random, allocation)
    : stratify(candidates, sampleSize, random, allocation)

  console.log(
    `Loaded ${candidates.length} teacher-scored responses from ${paths.length} snapshot${paths.length > 1 ? 's' : ''}; sampling ${sample.length} (seed ${seed}).`,
  )
  if (comparison) {
    if (argv.includes('--profiles') || argv.includes('--effort')) throw new Error('Comparison uses one --profile and the production-default effort; omit --profiles and --effort')
    const profile = flag('--profile') ?? 'bulk'
    if (profile !== 'manual' && profile !== 'bulk') throw new Error('--profile must be manual or bulk')
    const numberList = (value: string) => {
      if (value.split(',').some((part) => !part.trim())) throw new Error('Comparison lists cannot have empty entries')
      return value.split(',').map(Number)
    }
    const batchSizes = numberList(flag('--batch-size') ?? '1,2,4')
    const orderSeeds = numberList(flag('--order-seed') ?? '1')
    const targetPath = flag('--verified-targets')
    const pricingPath = flag('--pricing')
    assertPrivateOutput(outPath, [...paths, ...[targetPath, pricingPath].filter((path): path is string => path != null)])
    const targets = targetPath ? validateTargets(JSON.parse(readFileSync(targetPath, 'utf8')), allCandidates) : new Map()
    const pricing = pricingPath ? pricingSchema.parse(JSON.parse(readFileSync(pricingPath, 'utf8'))) : undefined
    const plans = buildComparisonPlan(sample, batchSizes, orderSeeds)
    console.table(plans.map((plan) => ({ batchSize: plan.batchSize, orderSeed: plan.orderSeed, answers: sample.length,
      singleCalls: plan.chunks.filter((chunk) => chunk.length === 1).length, batchCalls: plan.chunks.filter((chunk) => chunk.length > 1).length })))
    process.stdout.write(`One fixed ${profile} profile; production-default effort. ${sample.filter((row) => targets.has(answerId(row))).length}/${targets.size} verified targets sampled. ${plans.reduce((sum, plan) => sum + plan.chunks.length, 0)} grading operations; references prepared once per exact question; HTTP retries may add calls.\n`)
    if (dryRun) { process.stdout.write('--dry-run: no provider calls made, no file written.\n'); return }
    if (!process.env.DEEPSEEK_API_KEY?.trim()) throw new Error('DEEPSEEK_API_KEY is not configured')
    const startedAt = new Date().toISOString()
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const sourceDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0
    let lastReported = 0
    const checkpoint = (result: ComparisonResult) => {
      const temporary = `${outPath}.${process.pid}.tmp.grading-analysis.json`
      writeFileSync(temporary, JSON.stringify({ schemaVersion: 'test-grading-comparison-v1', startedAt,
        updatedAt: new Date().toISOString(), sourceCommit, sourceDirty, snapshots: paths, sampleSeed: seed, allocation,
        note: 'Verified target intervals are adjudications; recorded marks are second opinions. Costs use supplied reference rates, not billed charges. Shared preparation spend is separate. Per-answer cost is allocated equally within its call; latency is the whole call. Missing usage remains unknown. Sequential execution and cache state can affect comparisons.',
        ...result, summary: summarizeComparison(result), orderSensitivity: summarizeOrderSensitivity(result) }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
      renameSync(temporary, outPath)
      const operations = result.preparation.length + result.scenarios.reduce((sum, scenario) => sum + scenario.operations.length, 0)
      if (operations >= lastReported + 5 || result.complete) { process.stdout.write(`Completed ${operations} comparison operations${result.complete ? ' (finished)' : ''}.\n`); lastReported = operations }
    }
    const result = await runComparison(sample, { profile, batchSizes, orderSeeds, targets, pricing, checkpoint })
    console.table(summarizeComparison(result))
    console.table(summarizeOrderSensitivity(result))
    process.stdout.write(`Private comparison saved to ${outPath}\n`)
    if (result.scenarios.some((scenario) => scenario.rows.some((row) => row.failure))) process.exitCode = 1
    return
  }
  describePlan(sample, candidates, profiles, efforts, allocation)

  if (dryRun) {
    console.log('\n--dry-run: no provider calls made, no file written.')
    return
  }

  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    console.error('DEEPSEEK_API_KEY is not configured.')
    process.exitCode = 1
    return
  }

  // References are per question, not per response. Generating them once and
  // reusing keeps a keyless question from paying for them on every response.
  const referenceCache = new Map<string, string[]>()
  const rows: GradedRow[] = []
  // Without this, a result file cannot say which prompt produced it, and comparing two
  // runs becomes an argument about timestamps. Keyed so a mid-run change stays visible
  // rather than being averaged away.
  const gradedWith = new Map<string, Record<string, string>>()
  const failures: FailedRow[] = []

  for (const [index, candidate] of sample.entries()) {
    const keyed = hasAnswerKey(candidate)
    const runs: RunResult[] = []

    try {
    // Every effort level grades the same response, so the comparison is paired.
    for (const effort of efforts) {
      for (const promptProfile of profiles) {
        const cached = keyed ? null : referenceCache.get(candidate.questionText) ?? null
        const suggestion = await suggestTestOpenResponseGrade({
          testTitle: candidate.testTitle,
          questionText: candidate.questionText,
          responseText: candidate.responseText,
          maxPoints: candidate.maxPoints,
          answerKey: candidate.answerKey ?? null,
          sampleSolution: candidate.sampleSolution ?? null,
          referenceAnswers: cached,
          responseMonospace: candidate.responseMonospace,
          promptProfile,
          reasoningEffort: effort,
        })
        if (!keyed && !cached && suggestion.reference_answers.length > 0) {
          referenceCache.set(candidate.questionText, suggestion.reference_answers)
        }
        const stamp = {
          provider: suggestion.provenance.provider,
          model: suggestion.provenance.model,
          policyVersion: suggestion.provenance.policyVersion,
          promptVersion: suggestion.provenance.promptVersion,
          gradingProfileVersion: suggestion.provenance.gradingProfileVersion,
          rubricVersion: suggestion.provenance.rubricVersion,
        }
        gradedWith.set(Object.values(stamp).join('|'), stamp)
        const rawDelta = suggestion.score - candidate.teacherScore
        runs.push({
          effort,
          profile: promptProfile,
          aiScore: suggestion.score,
          rawDelta,
          normalizedDelta: Number((rawDelta / candidate.maxPoints).toFixed(4)),
          aiFeedback: suggestion.feedback,
          inputTokens: suggestion.usage?.inputTokens ?? null,
          outputTokens: suggestion.usage?.outputTokens ?? null,
          totalTokens: suggestion.usage?.totalTokens ?? null,
        })
      }
    }
    } catch (error) {
      // A paired comparison needs every run for this response, so a partial set is
      // dropped rather than reported as if it were complete.
      const reason = error instanceof Error ? error.message : 'unknown grading failure'
      failures.push({
        classroom: candidate.classroom,
        studentLabel: candidate.studentLabel,
        testTitle: candidate.testTitle,
        maxPoints: candidate.maxPoints,
        reason,
      })
      console.log(`  ${index + 1}/${sample.length} failed, continuing: ${reason}`)
      continue
    }

    const dearest = efforts[efforts.length - 1]
    const cheapest = efforts[0]
    const onBulk = (effort: EffortLevel) => runs.find(
      (run) => run.effort === effort && run.profile === 'bulk',
    ) ?? runs.find((run) => run.effort === effort)
    const primaryRun = onBulk(dearest) as RunResult

    const row: GradedRow = {
      classroom: candidate.classroom,
      studentLabel: candidate.studentLabel,
      testTitle: candidate.testTitle,
      questionPreview: candidate.questionText.slice(0, QUESTION_PREVIEW_CHARS),
      maxPoints: candidate.maxPoints,
      teacherScore: candidate.teacherScore,
      runs,
      primaryNormalizedDelta: primaryRun.normalizedDelta,
    }
    if (efforts.length > 1) {
      const low = onBulk(cheapest)
      if (low) row.effortScoreDelta = primaryRun.aiScore - low.aiScore
    }
    if (bothProfiles) {
      const manual = runs.find((run) => run.effort === dearest && run.profile === 'manual')
      const bulk = runs.find((run) => run.effort === dearest && run.profile === 'bulk')
      if (manual && bulk) row.parityDelta = manual.aiScore - bulk.aiScore
    }
    rows.push(row)

    if ((index + 1) % 10 === 0 || index + 1 === sample.length) {
      console.log(`  graded ${index + 1}/${sample.length} (${runs.length} call${runs.length === 1 ? '' : 's'} each)`)
    }
  }

  rows.sort((a, b) => Math.abs(b.primaryNormalizedDelta) - Math.abs(a.primaryNormalizedDelta))

  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        snapshots: paths,
        seed,
        allocation,
        profiles,
        efforts,
        sampled: rows.length,
        attempted: rows.length + failures.length,
        populationScored: candidates.length,
        gradedWith: [...gradedWith.values()],
        failures,
        totalTokens: rows.reduce(
          (sum, row) => sum + row.runs.reduce((inner, run) => inner + (run.totalTokens ?? 0), 0),
          0,
        ),
        note: 'teacherScore is a second opinion, not ground truth. Rows are ordered by disagreement size for human adjudication.',
        rows,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  summarize(rows, efforts, profiles)
  for (const stamp of gradedWith.values()) {
    console.log(
      `\nGraded with: ${stamp.model} · policy ${stamp.policyVersion} · prompt ${stamp.promptVersion}`,
    )
  }
  if (failures.length > 0) {
    console.log(
      `\n${failures.length} of ${rows.length + failures.length} responses could not be graded:`,
    )
    const byReason = new Map<string, number>()
    for (const failure of failures) {
      byReason.set(failure.reason, (byReason.get(failure.reason) ?? 0) + 1)
    }
    for (const [reason, count] of byReason) console.log(`  ${count}× ${reason}`)
    console.log('Their rows are absent from the results; the run is not a complete sample.')
  }
  console.log(`Wrote ${rows.length} rows to ${outPath} (gitignored), sharpest disagreement first.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Test grading calibration failed')
  process.exitCode = 1
})
