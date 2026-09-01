#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_LOG = resolve(homedir(), '.codex', 'metrics', 'pika-pr-lifecycle.jsonl')
const EVENTS = new Set(['started', 'draft-created', 'implementation', 'independent-review', 'remediation', 'ready-for-ci', 'ci-passed', 'ci-failed', 'merged'])
const METRIC_OPTIONS = new Set(['active-seconds', 'input-tokens', 'output-tokens', 'reasoning-tokens', 'ci-queue-seconds', 'ci-run-seconds', 'correction-or-sync-pushes', 'quality'])

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
    else if (key === 'pr' || key === 'event' || METRIC_OPTIONS.has(key)) args.values[key] = value
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
  }
  if (command === 'summary') args.values.pr = numberArg(args.values.pr, '--pr')
  return args
}

function eventFrom(values, recordedAt = new Date().toISOString()) {
  return {
    recordedAt, pr: values.pr, event: values.event,
    ...(values['active-seconds'] !== undefined ? { activeSeconds: values['active-seconds'] } : {}),
    ...(values['input-tokens'] !== undefined ? { inputTokens: values['input-tokens'] } : {}),
    ...(values['output-tokens'] !== undefined ? { outputTokens: values['output-tokens'] } : {}),
    ...(values['reasoning-tokens'] !== undefined ? { reasoningTokens: values['reasoning-tokens'] } : {}),
    ...(values['ci-queue-seconds'] !== undefined ? { ciQueueSeconds: values['ci-queue-seconds'] } : {}),
    ...(values['ci-run-seconds'] !== undefined ? { ciRunSeconds: values['ci-run-seconds'] } : {}),
    ...(values['correction-or-sync-pushes'] !== undefined ? { correctionOrSyncPushes: values['correction-or-sync-pushes'] } : {}),
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
  const selected = events.filter((event) => event.pr === pr)
  const latest = (key) => [...selected].reverse().find((event) => Number.isInteger(event[key]))?.[key] ?? null
  return {
    pr, eventCount: selected.length,
    startedAt: selected.find((event) => event.event === 'started')?.recordedAt ?? null,
    completedAt: selected.find((event) => event.event === 'merged')?.recordedAt ?? null,
    activeDevelopmentSeconds: sumOrUnknown(selected, 'activeSeconds'),
    tokens: { input: sumOrUnknown(selected, 'inputTokens'), output: sumOrUnknown(selected, 'outputTokens'), reasoning: sumOrUnknown(selected, 'reasoningTokens') },
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
    'Metrics are optional and must be attributable: --active-seconds, --input-tokens, --output-tokens, --reasoning-tokens, --ci-queue-seconds, --ci-run-seconds, --correction-or-sync-pushes, --quality passed|failed|unknown.',
    'Writes local append-only metadata only; it never records prompts, source, secrets, or identifiers beyond the PR number.',
  ].join('\n')
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2))
    if (args.command === 'help') return console.log(usage())
    if (args.command === 'event') {
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
