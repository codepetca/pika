#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const envPath = resolve(repoRoot, '.env.local')

if (existsSync(envPath)) {
  dotenv.config({ path: envPath })
} else {
  dotenv.config()
}

const TABLE = 'developer_feedback_candidates'
const STATUSES = new Set(['new', 'approved', 'in_progress', 'pr_opened', 'done', 'dismissed'])
const AGENTS = new Set(['codex', 'claude', 'either'])
const CANDIDATE_COLUMNS = [
  'id',
  'dedupe_key',
  'source_type',
  'title',
  'original_request',
  'refined_request',
  'implementation_hint',
  'affected_area',
  'suggested_agent',
  'confidence',
  'signal_count',
  'source_entry_count',
  'source_classroom_ids',
  'source_dates',
  'first_seen_at',
  'last_seen_at',
  'last_seen_date',
  'model',
  'status',
  'status_note',
  'status_updated_at',
  'direct_feedback_category',
  'submitter_role',
  'source_metadata',
  'approved_at',
  'dismissed_at',
  'started_at',
  'pr_url',
  'completed_at',
  'created_at',
  'updated_at',
].join(',')

async function main() {
  const { command, args, options } = parseArgs(process.argv.slice(2))

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  const client = createServiceClient()

  if (command === 'list') {
    const rows = await listCandidates(client, {
      status: options.status || 'new',
      limit: Number(options.limit || 10),
    })
    writeOutput(options, { candidates: rows }, formatCandidateList(rows))
    return
  }

  if (command === 'show') {
    const id = requireOneArg(args, 'show requires a candidate id')
    const row = await loadCandidate(client, id)
    writeOutput(options, { candidate: row }, formatCandidateDetail(row))
    return
  }

  if (command === 'prompt') {
    const id = requireOneArg(args, 'prompt requires a candidate id')
    const row = await loadCandidate(client, id)
    const agent = normalizeAgent(options.agent || row.suggested_agent || 'codex')
    writeOutput(options, { candidate: row, prompt: formatImplementationPrompt(row, agent) }, formatImplementationPrompt(row, agent))
    return
  }

  if (command === 'approve') {
    const ids = requireManyArgs(args, 'approve requires at least one candidate id')
    const rows = await updateCandidates(client, ids, {
      status: 'approved',
      status_note: options.note || null,
      status_updated_at: new Date().toISOString(),
      approved_at: new Date().toISOString(),
      dismissed_at: null,
    })
    writeOutput(options, { candidates: rows }, formatStatusUpdate(rows, 'approved'))
    return
  }

  if (command === 'dismiss' || command === 'disapprove') {
    const ids = requireManyArgs(args, `${command} requires at least one candidate id`)
    const rows = await updateCandidates(client, ids, {
      status: 'dismissed',
      status_note: options.reason || options.note || null,
      status_updated_at: new Date().toISOString(),
      dismissed_at: new Date().toISOString(),
    })
    writeOutput(options, { candidates: rows }, formatStatusUpdate(rows, 'dismissed'))
    return
  }

  if (command === 'start') {
    const id = requireOneArg(args, 'start requires a candidate id')
    const row = await loadCandidate(client, id)
    const agent = normalizeAgent(options.agent || row.suggested_agent || 'codex')
    const rows = await updateCandidates(client, [id], {
      status: 'in_progress',
      suggested_agent: agent,
      status_note: options.note || null,
      status_updated_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      approved_at: row.approved_at || new Date().toISOString(),
    })
    writeOutput(options, { candidate: rows[0], prompt: formatImplementationPrompt(rows[0], agent) }, formatImplementationPrompt(rows[0], agent))
    return
  }

  if (command === 'pr') {
    const id = requireOneArg(args, 'pr requires a candidate id')
    const url = options.url || options.pr
    if (!url) fail('pr requires --url <pull-request-url>')
    const rows = await updateCandidates(client, [id], {
      status: 'pr_opened',
      pr_url: url,
      status_note: options.note || null,
      status_updated_at: new Date().toISOString(),
    })
    writeOutput(options, { candidate: rows[0] }, formatStatusUpdate(rows, 'pr_opened'))
    return
  }

  if (command === 'done') {
    const id = requireOneArg(args, 'done requires a candidate id')
    const payload = {
      status: 'done',
      status_note: options.note || null,
      status_updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }
    if (options.url || options.pr) {
      payload.pr_url = options.url || options.pr
    }
    const rows = await updateCandidates(client, [id], payload)
    writeOutput(options, { candidate: rows[0] }, formatStatusUpdate(rows, 'done'))
    return
  }

  fail(`Unknown command: ${command}`)
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const args = []
  const options = {}

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]
    if (!token.startsWith('--')) {
      args.push(token)
      continue
    }

    const eqIndex = token.indexOf('=')
    if (eqIndex !== -1) {
      const key = token.slice(2, eqIndex)
      options[key] = token.slice(eqIndex + 1)
      continue
    }

    const key = token.slice(2)
    const next = rest[i + 1]
    if (!next || next.startsWith('--')) {
      options[key] = true
      continue
    }

    options[key] = next
    i += 1
  }

  return { command, args, options }
}

function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !secretKey) {
    fail('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local')
  }

  return createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

async function listCandidates(client, { status, limit }) {
  if (status !== 'all' && !STATUSES.has(status)) {
    fail(`Invalid status "${status}". Use one of: all, ${[...STATUSES].join(', ')}`)
  }

  const safeLimit = Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.floor(limit))) : 10
  let query = client
    .from(TABLE)
    .select(CANDIDATE_COLUMNS)
    .order('signal_count', { ascending: false })
    .order('last_seen_at', { ascending: false })
    .limit(safeLimit)

  if (status !== 'all') {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) fail(formatSupabaseError(error))
  return data || []
}

async function loadCandidate(client, id) {
  const { data, error } = await client
    .from(TABLE)
    .select(CANDIDATE_COLUMNS)
    .eq('id', id)
    .single()

  if (error) fail(formatSupabaseError(error))
  return data
}

async function updateCandidates(client, ids, payload) {
  const { data, error } = await client
    .from(TABLE)
    .update(payload)
    .in('id', ids)
    .select(CANDIDATE_COLUMNS)

  if (error) fail(formatSupabaseError(error))
  return data || []
}

function formatCandidateList(rows) {
  if (rows.length === 0) {
    return 'No developer feedback candidates found.'
  }

  return rows.map((row, index) => {
    return [
      `${index + 1}. ${row.title}`,
      `   ID: ${row.id}`,
      `   Status: ${row.status} · ${formatSourceLabel(row)} · ${formatSignalSummary(row)}`,
      `   Rewrite: ${row.refined_request}`,
      `   Suggested: ${row.suggested_agent || 'codex'} · ${row.affected_area || 'unknown area'} · confidence ${formatConfidence(row.confidence)}`,
    ].join('\n')
  }).join('\n\n')
}

function formatCandidateDetail(row) {
  return [
    `# ${row.title}`,
    '',
    `ID: ${row.id}`,
    `Status: ${row.status}`,
    `Source: ${formatSourceLabel(row)}`,
    `Suggested agent: ${row.suggested_agent || 'codex'}`,
    `Affected area: ${row.affected_area || 'unknown'}`,
    `Confidence: ${formatConfidence(row.confidence)}`,
    `Signal: ${formatSignalSummary(row)}`,
    formatSourcePage(row) ? `Page: ${formatSourcePage(row)}` : '',
    '',
    '## Original Signal',
    row.original_request || '(none)',
    '',
    '## Refined Request',
    row.refined_request || '(none)',
    '',
    '## Implementation Hint',
    row.implementation_hint || '(none)',
    row.pr_url ? `\nPR: ${row.pr_url}` : '',
  ].filter(Boolean).join('\n')
}

function formatImplementationPrompt(row, agent) {
  return [
    `# Pika Developer Feedback Candidate`,
    '',
    `Candidate ID: ${row.id}`,
    `Status: ${row.status}`,
    `Preferred agent: ${agent}`,
    `Source: ${formatSourceLabel(row)}`,
    `Affected area: ${row.affected_area || 'unknown'}`,
    `Signal: ${formatSignalSummary(row)}`,
    formatSourcePage(row) ? `Page: ${formatSourcePage(row)}` : '',
    '',
    '## Task',
    row.refined_request,
    '',
    '## User Signal',
    row.original_request,
    '',
    '## Implementation Notes',
    row.implementation_hint || 'Inspect the affected area and keep the change narrowly scoped.',
    '',
    '## Workflow',
    '- Follow Pika startup/worktree rules before editing.',
    '- Write or update focused tests before implementation where practical.',
    '- Keep business logic out of UI components.',
    '- Run focused tests, then lint/build/full tests as appropriate.',
    '- If UI changes are made, run mandatory Playwright visual verification.',
    '- When a PR is opened, mark this candidate with `node scripts/dev-feedback.mjs pr <id> --url <url>`.',
  ].join('\n')
}

function formatStatusUpdate(rows, status) {
  if (rows.length === 0) return `No candidates were marked ${status}.`
  return rows.map((row) => `${row.id} ${row.status}: ${row.title}`).join('\n')
}

function formatSourceLabel(row) {
  if (row.source_type === 'direct_feedback') {
    let category = 'submission'
    if (row.direct_feedback_category === 'bug') category = 'bug report'
    if (row.direct_feedback_category === 'suggestion') category = 'feature idea'
    return `Direct ${category}${row.submitter_role ? ` from ${row.submitter_role}` : ''}`
  }

  return 'Daily logs'
}

function formatSignalSummary(row) {
  if (row.source_type === 'direct_feedback') {
    const submittedAt = formatDateOnly(row.created_at)
    return `1 direct submission · submitted ${submittedAt}`
  }

  const signal = `${row.signal_count || 0} signal${row.signal_count === 1 ? '' : 's'}`
  const classrooms = Array.isArray(row.source_classroom_ids) ? row.source_classroom_ids.length : 0
  const dates = Array.isArray(row.source_dates) ? row.source_dates.join(', ') : ''
  return `${signal} · ${classrooms} classroom${classrooms === 1 ? '' : 's'} · ${dates || 'no dates'}`
}

function formatSourcePage(row) {
  const metadata = row.source_metadata
  if (!metadata || typeof metadata !== 'object') return ''
  const url = metadata.url
  return typeof url === 'string' ? url : ''
}

function formatDateOnly(value) {
  if (typeof value !== 'string') return 'unknown date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown date'
  return date.toISOString().slice(0, 10)
}

function formatConfidence(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '0%'
  return `${Math.round(numeric * 100)}%`
}

function normalizeAgent(value) {
  const agent = String(value || '').toLowerCase().trim()
  if (!AGENTS.has(agent)) fail(`Invalid agent "${value}". Use codex, claude, or either.`)
  return agent
}

function writeOutput(options, jsonPayload, markdown) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(jsonPayload, null, 2)}\n`)
  } else {
    process.stdout.write(`${markdown}\n`)
  }
}

function requireOneArg(args, message) {
  if (args.length !== 1) fail(message)
  return args[0]
}

function requireManyArgs(args, message) {
  if (args.length < 1) fail(message)
  return args
}

function formatSupabaseError(error) {
  const message = error?.message || String(error)
  if (message.includes('developer_feedback_candidates') || error?.code === 'PGRST205') {
    return `${message}\n\nHas the developer feedback migration been applied?`
  }
  return message
}

function printHelp() {
  process.stdout.write(`Pika developer feedback helper

Usage:
  node scripts/dev-feedback.mjs list [--status new] [--limit 10] [--json]
  node scripts/dev-feedback.mjs show <candidate-id> [--json]
  node scripts/dev-feedback.mjs prompt <candidate-id> [--agent codex|claude|either]
  node scripts/dev-feedback.mjs approve <candidate-id...> [--note "..."]
  node scripts/dev-feedback.mjs dismiss <candidate-id...> [--reason "..."]
  node scripts/dev-feedback.mjs start <candidate-id> [--agent codex|claude|either]
  node scripts/dev-feedback.mjs pr <candidate-id> --url <pull-request-url>
  node scripts/dev-feedback.mjs done <candidate-id> [--url <pull-request-url>]
`)
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
