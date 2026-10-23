#!/usr/bin/env node
// Read-only observation. Eligibility is a request for human review, never permission to change visibility.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { distinctJobExecutions } from './measure-ci-performance.mjs'

const REPOSITORY = 'codepetca/pika'
const DAY = 86_400_000
const TARGET_MINUTES = 1000
const TARGET_BYTES = 250_000_000
const execute = promisify(execFile)

function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(value)) throw new Error('Invalid UTC date')
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error('Invalid UTC date')
  return date.toISOString()
}

export function completeUtcWindow(now = new Date(), endDate) {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  // Leave two complete days for billing report ingestion; this is a buffer, not a guaranteed settlement SLA.
  const end = endDate === undefined ? midnight - 2 * DAY : Date.parse(instant(endDate))
  if (end > midnight || end % DAY !== 0) throw new Error('Window endpoint must be a complete UTC midnight')
  return { start: new Date(end - 7 * DAY).toISOString(), end_exclusive: new Date(end).toISOString(), days: 7 }
}

export function parseQuotaArguments(args, now = new Date()) {
  let endDate, notBefore = null
  const seen = new Set()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1]
    if (!['--end', '--not-before'].includes(key) || seen.has(key) || !value) throw new Error('Use only --end YYYY-MM-DD and --not-before UTC-date-or-instant')
    seen.add(key)
    if (key === '--end') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('--end requires YYYY-MM-DD')
      endDate = value
    } else notBefore = instant(value)
  }
  return { now, window: completeUtcWindow(now, endDate), notBefore }
}

async function github(path) {
  try {
    const { stdout } = await execute('gh', ['api', '--hostname', 'github.com', '--method', 'GET', path],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60_000, shell: false })
    return JSON.parse(stdout)
  } catch {
    // Do not print gh stderr, API bodies, auth diagnostics or child exception objects.
    throw new Error('GitHub read failed or returned invalid JSON')
  }
}

async function collection(provider, path, key, capped = false) {
  const rows = [], ids = new Set()
  let expected
  for (let page = 1; page <= 10_000; page++) {
    const result = await provider(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
    if (!result || !Array.isArray(result[key]) || !Number.isSafeInteger(result.total_count) || result.total_count < 0) throw new Error('Invalid pagination evidence')
    if (expected === undefined) expected = result.total_count
    if (result.total_count !== expected || (capped && expected >= 1000)) throw new Error('Changing or capped pagination evidence')
    if (result[key].length > 100) throw new Error('Oversized API page')
    for (const row of result[key]) {
      if (!row || !Number.isSafeInteger(row.id) || ids.has(row.id)) throw new Error('Missing or duplicated API identity')
      ids.add(row.id); rows.push(row)
    }
    if (rows.length === expected) return rows
    if (rows.length > expected || result[key].length < 100) throw new Error('Incomplete pagination evidence')
  }
  throw new Error('Pagination safety bound exceeded')
}

async function mapBounded(items, callback) {
  const result = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await callback(items[index]) }
  }))
  return result
}

export async function auditCiQuota({ provider = github, now = new Date(), window = completeUtcWindow(now), notBefore = null } = {}) {
  const repository = await provider(`/repos/${REPOSITORY}`)
  if (repository?.full_name !== REPOSITORY) throw new Error('Repository identity mismatch')
  const start = Date.parse(window.start), end = Date.parse(window.end_exclusive)
  if (end - start !== 7 * DAY || start % DAY || end % DAY) throw new Error('Audit requires exactly seven UTC days')
  const days = Array.from({ length: 7 }, (_, index) => start + index * DAY)
  const dailyRuns = await mapBounded(days, day => collection(provider,
    `/repos/${REPOSITORY}/actions/runs?created=${new Date(day).toISOString().replace('.000Z', 'Z')}..${new Date(day + DAY - 1000).toISOString().replace('.000Z', 'Z')}`,
    'workflow_runs', true))
  const runs = dailyRuns.flat()
  if (new Set(runs.map(run => run.id)).size !== runs.length) throw new Error('Duplicated run across daily windows')
  const withJobs = await mapBounded(runs, async run => ({ ...run, jobs: await collection(provider,
    `/repos/${REPOSITORY}/actions/runs/${run.id}/jobs?filter=all`, 'jobs') }))
  const artifacts = await collection(provider, `/repos/${REPOSITORY}/actions/artifacts`, 'artifacts')
  const months = [...new Set(days.map(day => new Date(day).toISOString().slice(0, 7)))]
  let billingRows = [], billingAvailable = true
  try {
    for (const month of months) {
      const [year, number] = month.split('-').map(Number)
      const result = await provider(`/organizations/codepetca/settings/billing/usage?year=${year}&month=${number}`)
      if (!result || !Array.isArray(result.usageItems)) throw new Error('Missing billing evidence')
      billingRows.push(...result.usageItems)
    }
  } catch { billingAvailable = false; billingRows = [] }
  return summarizeQuotaEvidence({ repository, runs: withJobs, artifacts, window, now, notBefore, billingRows, billingAvailable })
}

export function summarizeQuotaEvidence({ repository, runs, artifacts, window, now = new Date(), notBefore = null,
  billingRows = [], billingAvailable = false }) {
  const issues = {}
  const issue = code => { issues[code] = (issues[code] ?? 0) + 1 }
  const start = Date.parse(window.start), end = Date.parse(window.end_exclusive)
  const safeEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 2 * DAY
  if (!Number.isFinite(start) || end - start !== 7 * DAY || start % DAY || end % DAY || end > safeEnd) issue('window_incomplete_or_billing_freshness_gap')
  const publicHold = repository?.full_name === REPOSITORY && repository?.visibility === 'public' && repository?.private === false
  if (!publicHold) issue('public_repository_hold_not_satisfied')
  let activation = null
  try { if (notBefore) activation = instant(notBefore) } catch { issue('invalid_activation_timestamp') }
  if (!activation || start < Date.parse(activation)) issue('seven_complete_post_activation_days_not_observed')
  if (!Array.isArray(runs) || runs.length === 0) issue('no_observed_runs')
  let raw = 0, distinct = 0, skipped = 0, skippedRuns = 0, cancelledRuns = 0, cancelledUnassigned = 0
  let selfHosted = 0, hostedJobs = 0, hostedMinutes = 0
  for (const run of runs ?? []) {
    const created = Date.parse(run.created_at)
    if (!Number.isFinite(created) || created < start || created >= end) issue('run_outside_creation_cohort')
    if (run.status !== 'completed') issue('incomplete_run')
    if (run.status === 'completed' && ['skipped', 'cancelled'].includes(run.conclusion)
      && Array.isArray(run.jobs) && run.jobs.length === 0) {
      if (run.conclusion === 'skipped') skippedRuns++
      else cancelledRuns++
      continue
    }
    if (!Array.isArray(run.jobs) || run.jobs.length === 0) { issue('missing_job_evidence'); continue }
    raw += run.jobs.length
    const executions = distinctJobExecutions(run.jobs); distinct += executions.length
    for (const job of executions) {
      if (job.status !== 'completed') { issue('incomplete_job'); continue }
      if (job.conclusion === 'skipped') { skipped++; continue }
      // GitHub emits synthetic timestamps when cancellation precedes runner assignment.
      // Only the explicit empty assignment/steps shape establishes zero execution.
      if (job.conclusion === 'cancelled' && (job.runner_id === null || job.runner_id === 0)
        && (job.runner_name === null || job.runner_name === '')
        && [undefined, null, 0].includes(job.runner_group_id)
        && [undefined, null, ''].includes(job.runner_group_name)
        && Array.isArray(job.steps) && job.steps.length === 0
        && typeof job.name === 'string' && job.name.length > 0) {
        cancelledUnassigned++; continue
      }
      const first = Date.parse(job.started_at), last = Date.parse(job.completed_at)
      if (!Number.isFinite(first) || !Number.isFinite(last) || last < first || last > now.getTime()
        || typeof job.name !== 'string' || !job.conclusion) { issue('missing_job_duration_or_identity'); continue }
      if (!Array.isArray(job.labels) || !job.labels.every(label => typeof label === 'string')
        || !Number.isSafeInteger(job.runner_id) || job.runner_id <= 0) { issue('unknown_runner_identity'); continue }
      if (job.labels.includes('self-hosted')) { selfHosted++; continue }
      // Standard Linux only. Larger, Windows, macOS and unknown runner SKUs require a reviewed billing model.
      if (job.labels.length !== 1 || !/^ubuntu-(?:latest|22\.04|24\.04)(?:-arm)?$/.test(job.labels[0])) {
        issue('unsupported_hosted_runner_labels'); continue
      }
      hostedJobs++; hostedMinutes += Math.ceil((last - first) / 60_000)
    }
  }
  if (selfHosted === 0) issue('no_observed_self_hosted_execution')
  let retainedBytes = 0, retainedCount = 0
  for (const artifact of artifacts ?? []) {
    if (typeof artifact.expired !== 'boolean') { issue('invalid_artifact_evidence'); continue }
    if (artifact.expired) continue
    if (!Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 0) { issue('invalid_artifact_evidence'); continue }
    retainedCount++; retainedBytes += artifact.size_in_bytes
    if (!Number.isSafeInteger(retainedBytes)) issue('artifact_size_overflow')
  }
  if (!Array.isArray(artifacts)) issue('missing_artifact_evidence')
  let ledgerMinutes = 0, ledgerRows = 0
  if (!billingAvailable || !Array.isArray(billingRows)) issue('billing_ledger_unavailable')
  for (const row of billingRows ?? []) {
    if (!['pika', REPOSITORY].includes(row.repositoryName)) continue
    const date = Date.parse(row.date)
    if (!Number.isFinite(date)) { issue('invalid_billing_date'); continue }
    if (date < start || date >= end || String(row.product).toLowerCase() !== 'actions') continue
    if (String(row.unitType).toLowerCase() === 'gigabytehours' && row.sku === 'Actions storage') continue
    if (row.sku !== 'Actions Linux' || String(row.unitType).toLowerCase() !== 'minutes'
      || !Number.isFinite(row.quantity) || row.quantity < 0) { issue('unsupported_billing_sku_or_quantity'); continue }
    ledgerRows++; ledgerMinutes += row.quantity
  }
  if (hostedJobs > 0 && ledgerRows === 0) issue('missing_hosted_billing_rows')
  const conservativeMinutes = Math.max(hostedMinutes, ledgerMinutes)
  const projected = conservativeMinutes * 30 / 7
  const targetsMet = projected <= TARGET_MINUTES && retainedBytes <= TARGET_BYTES
  const complete = Object.keys(issues).length === 0
  return {
    repository: REPOSITORY, measured_at: now.toISOString(), window, activation_not_before: activation,
    status: !complete ? 'inconclusive' : targetsMet ? 'pass' : 'fail',
    eligible_for_private_review: complete && targetsMet, targets_met: targetsMet,
    visibility: repository?.visibility ?? 'unknown',
    user_hold: { keep_public: true, satisfied: publicHold, visibility_change_authorized: false },
    runs: runs?.length ?? 0, skipped_runs: skippedRuns, cancelled_unassigned_runs: cancelledRuns,
    jobs: { raw, distinct, carried_duplicates_removed: raw - distinct, skipped,
      cancelled_unassigned: cancelledUnassigned, self_hosted: selfHosted },
    hosted: { jobs: hostedJobs, rounded_minutes: hostedMinutes, billing_ledger_minutes: ledgerMinutes,
      conservative_minutes: conservativeMinutes, monthly_projection_30_days: projected,
      monthly_target_minutes: TARGET_MINUTES, monthly_headroom_minutes: TARGET_MINUTES - projected,
      free_allowance_reference_minutes: 2000 },
    artifacts: { unexpired_count: retainedCount, unexpired_bytes: retainedBytes, target_bytes: TARGET_BYTES,
      headroom_bytes: TARGET_BYTES - retainedBytes, free_allowance_reference_bytes: 500_000_000 },
    evidence: { issues, billing_ledger_available: billingAvailable, billing_rows: ledgerRows,
      billing_lag_buffer_days: 2, organization_allowance_verified: false,
      private_review_requires: ['Verify shared organization-wide allowance and branch protection.',
        'Verify self-hosted lane coverage and sustained queue capacity separately.'],
      job_scope: 'all attempts of runs created within the seven-day window',
      projection_basis: 'maximum of job-cohort rounded minutes and repository billing ledger Linux minutes',
      limitations: ['Billing ingestion can lag beyond the two-day buffer; recheck before review.',
        'This repository projection does not establish unused organization-wide allowance.',
        'Passing permits manual visibility and branch-protection review only.'] },
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = await auditCiQuota(parseQuotaArguments(process.argv.slice(2)))
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.status === 'pass' ? 0 : 1
  } catch {
    console.log(JSON.stringify({ repository: REPOSITORY, status: 'inconclusive', eligible_for_private_review: false,
      error: 'Read-only audit could not obtain complete evidence; verify arguments, read access, and pagination.' }, null, 2))
    process.exitCode = 1
  }
}
