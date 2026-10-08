#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_LOG = resolve(homedir(), '.codex', 'metrics', 'pika-pr-lifecycle.jsonl')
const EVENTS = new Set(['started', 'draft-created', 'implementation', 'independent-review', 'remediation', 'ready-for-ci', 'ci-passed', 'ci-failed', 'merged'])
const METRIC_OPTIONS = new Set(['active-seconds', 'input-tokens', 'cached-input-tokens', 'output-tokens', 'reasoning-tokens', 'ci-queue-seconds', 'ci-run-seconds', 'correction-or-sync-pushes', 'review-seconds', 'accepted-findings', 'rejected-findings', 'quality'])
const REVIEW_FIELDS = { 'review-id': 'reviewId', 'head-sha': 'headSha', model: 'model', effort: 'effort', coverage: 'coverage' }
const REVIEW_METRICS = ['review-seconds', 'accepted-findings', 'rejected-findings']

function numberArg(value, name) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`)
  return parsed
}

export function parseArgs(argv) {
  const args = { log: DEFAULT_LOG, values: {} }
  const [command, ...rest] = argv
  args.command = command
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index]
    const value = rest[index + 1]
    if (option === '--help' || option === '-h') return { command: 'help', values: {} }
    if (!option.startsWith('--') || value === undefined) throw new Error(`Unknown or incomplete argument: ${option}`)
    const key = option.slice(2)
    if (key === 'log') args.log = resolve(value)
    else if (key === 'pr' || key === 'event' || METRIC_OPTIONS.has(key) || Object.hasOwn(REVIEW_FIELDS, key)) args.values[key] = value
    else throw new Error(`Unknown argument: ${option}`)
    index += 1
  }
  if (!['event', 'summary', 'help'].includes(command)) throw new Error('Use event or summary')
  if (command === 'event') {
    args.values.pr = numberArg(args.values.pr, '--pr')
    if (!EVENTS.has(args.values.event)) throw new Error(`--event must be one of: ${[...EVENTS].join(', ')}`)
    for (const key of METRIC_OPTIONS) {
      if (key === 'quality') continue
      if (args.values[key] !== undefined) args.values[key] = numberArg(args.values[key], `--${key}`)
    }
    if (args.values.quality && !['passed', 'failed', 'unknown'].includes(args.values.quality)) throw new Error('--quality must be passed, failed, or unknown')
    const hasReview = [...Object.keys(REVIEW_FIELDS), ...REVIEW_METRICS].some((key) => args.values[key] !== undefined)
    if (hasReview && (args.values.event !== 'independent-review' || !args.values['review-id'])) throw new Error('Review metadata requires --event independent-review and a unique --review-id')
    for (const key of ['review-id', 'model', 'effort']) {
      if (args.values[key] !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(args.values[key])) throw new Error(`--${key} must be a short metadata identifier`)
    }
    if (args.values['head-sha'] !== undefined && !/^[a-f0-9]{40}$/.test(args.values['head-sha'])) throw new Error('--head-sha must be a full Git SHA')
    if (args.values.coverage !== undefined && !['complete', 'partial'].includes(args.values.coverage)) throw new Error('--coverage must be complete or partial')
    if (args.values['cached-input-tokens'] !== undefined && args.values['input-tokens'] !== undefined && args.values['cached-input-tokens'] > args.values['input-tokens']) throw new Error('--cached-input-tokens cannot exceed --input-tokens')
  }
  if (command === 'summary') args.values.pr = numberArg(args.values.pr, '--pr')
  return args
}

function eventFrom(values, recordedAt = new Date().toISOString()) {
  return {
    recordedAt, pr: values.pr, event: values.event,
    ...(values['active-seconds'] !== undefined ? { activeSeconds: values['active-seconds'] } : {}),
    ...(values['input-tokens'] !== undefined ? { inputTokens: values['input-tokens'] } : {}),
    ...(values['cached-input-tokens'] !== undefined ? { cachedInputTokens: values['cached-input-tokens'] } : {}),
    ...(values['output-tokens'] !== undefined ? { outputTokens: values['output-tokens'] } : {}),
    ...(values['reasoning-tokens'] !== undefined ? { reasoningTokens: values['reasoning-tokens'] } : {}),
    ...(values['ci-queue-seconds'] !== undefined ? { ciQueueSeconds: values['ci-queue-seconds'] } : {}),
    ...(values['ci-run-seconds'] !== undefined ? { ciRunSeconds: values['ci-run-seconds'] } : {}),
    ...(values['correction-or-sync-pushes'] !== undefined ? { correctionOrSyncPushes: values['correction-or-sync-pushes'] } : {}),
    ...(values['review-seconds'] !== undefined ? { reviewSeconds: values['review-seconds'] } : {}),
    ...(values['accepted-findings'] !== undefined ? { acceptedFindings: values['accepted-findings'] } : {}),
    ...(values['rejected-findings'] !== undefined ? { rejectedFindings: values['rejected-findings'] } : {}),
    ...Object.fromEntries(Object.entries(REVIEW_FIELDS).filter(([key]) => values[key] !== undefined).map(([key, field]) => [field, values[key]])),
    ...(values.quality ? { quality: values.quality } : {}),
  }
}

export function readEvents(logPath) {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) } catch { throw new Error(`${logPath} contains invalid JSON on line ${index + 1}`) }
  })
}

function sumOrUnknown(events, key) {
  const values = events.map((event) => event[key]).filter((value) => Number.isInteger(value))
  return values.length ? values.reduce((total, value) => total + value, 0) : null
}

export function summarizeEvents(events, pr) {
  const recorded = events.filter((event) => event.pr === pr)
  const invalidated = new Set(recorded.filter((event) => event.event === 'merge-recording-correction').map((event) => event.invalidatesRecordedAt))
  const selected = recorded.filter((event) => !(event.event === 'merged' && invalidated.has(event.recordedAt)))
  const reviewEvents = selected.filter((event) => event.event === 'independent-review')
  const reviews = reviewEvents.filter((event) => event.reviewId)
  const latest = (key) => [...selected].reverse().find((event) => Number.isInteger(event[key]))?.[key] ?? null
  return {
    pr, eventCount: recorded.length, invalidatedMergeRecords: recorded.length - selected.length,
    trackingStartedAt: selected.find((event) => event.event === 'started')?.recordedAt ?? null,
    completedAt: selected.find((event) => event.event === 'merged')?.recordedAt ?? null,
    activeDevelopmentSeconds: sumOrUnknown(selected, 'activeSeconds'),
    tokens: { input: sumOrUnknown(selected, 'inputTokens'), cachedInput: sumOrUnknown(selected, 'cachedInputTokens'), output: sumOrUnknown(selected, 'outputTokens'), reasoning: sumOrUnknown(selected, 'reasoningTokens') },
    reviews: {
      recordedAttempts: reviews.length || null, unidentifiedEvents: reviewEvents.length - reviews.length,
      elapsedSeconds: sumOrUnknown(reviews, 'reviewSeconds'),
      acceptedFindings: sumOrUnknown(reviews, 'acceptedFindings'), rejectedFindings: sumOrUnknown(reviews, 'rejectedFindings'),
      attempts: reviews,
    },
    ci: { queueSeconds: latest('ciQueueSeconds'), runSeconds: latest('ciRunSeconds') },
    correctionOrSyncPushes: sumOrUnknown(selected, 'correctionOrSyncPushes'),
    quality: [...selected].reverse().find((event) => event.quality)?.quality ?? 'unknown',
    events: selected.map(({ recordedAt, event }) => ({ recordedAt, event })),
  }
}

function usage() {
  return [
    'Usage:',
    '  node scripts/record-ai-pr-lifecycle.mjs event --pr <number> --event <stage> [metrics]',
    '  node scripts/record-ai-pr-lifecycle.mjs summary --pr <number> [--log <path>]',
    '', `Stages: ${[...EVENTS].join(', ')}`,
    'Optional attributable metrics: --active-seconds, --input-tokens, --cached-input-tokens, --output-tokens, --reasoning-tokens, --ci-queue-seconds, --ci-run-seconds, --correction-or-sync-pushes, --quality passed|failed|unknown.',
    'For each independent-review attempt: --review-id <reviewer:turn> [--head-sha <40-hex> --model <id> --effort <level> --coverage complete|partial --review-seconds <elapsed> --accepted-findings <n> --rejected-findings <n>]. Include failed attempts with partial coverage; never infer active time from elapsed time.',
    'Use per-attempt token deltas, not cumulative worker totals. Omit unavailable metrics; partial sums do not establish total PR cost.',
    'Writes local append-only metadata only; never include prompts, source, secrets, or personal identifiers.',
  ].join('\n')
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2))
    if (args.command === 'help') return console.log(usage())
    if (args.command === 'event') {
      const existing = readEvents(args.log)
      if (args.values['review-id'] && existing.some((event) => event.pr === args.values.pr && event.reviewId === args.values['review-id'])) throw new Error('This review-id is already recorded for the PR; use one unique ID per attempt')
      mkdirSync(dirname(args.log), { recursive: true })
      appendFileSync(args.log, `${JSON.stringify(eventFrom(args.values))}\n`)
      return console.log(JSON.stringify(summarizeEvents(readEvents(args.log), args.values.pr)))
    }
    console.log(JSON.stringify(summarizeEvents(readEvents(args.log), args.values.pr)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
