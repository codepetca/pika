#!/usr/bin/env node

import { execFileSync } from 'node:child_process'

function percentile(values, fraction) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function summarize(values) {
  if (values.length === 0) return { min: null, p50: null, p95: null, max: null, average: null }
  return {
    min: Math.min(...values),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
    average: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
  }
}

function summarizeMeasured(values) {
  const valid = values.filter(value => value !== null)
  return { ...summarize(valid), sampleSize: valid.length, missingSamples: values.length - valid.length }
}

export function summarizeCiRuns(runs) {
  const completed = runs.filter((run) => run.status === 'completed')
  const successful = completed.filter((run) => run.conclusion === 'success')
  const counts = Object.fromEntries(
    [...new Set(completed.map((run) => run.conclusion || 'unknown'))]
      .sort()
      .map((conclusion) => [
        conclusion,
        completed.filter((run) => (run.conclusion || 'unknown') === conclusion).length,
      ]),
  )
  const queueSeconds = successful.map((run) => measuredSeconds(run.createdAt, run.startedAt))
  const runSeconds = successful.map((run) => measuredSeconds(run.startedAt, run.updatedAt))
  const wallSeconds = successful.map((run) => measuredSeconds(run.createdAt, run.updatedAt))
  const cancelled = completed.filter((run) => run.conclusion === 'cancelled')
  const successfulWithGate = successful.filter((run) => (
    run.prGate?.mode
    && measuredSeconds(run.prGate.startedAt, run.prGate.completedAt) !== null
  ))
  const perMode = Object.fromEntries(
    [...new Set(successfulWithGate.map((run) => run.prGate.mode))]
      .sort()
      .map((mode) => {
        const modeRuns = successfulWithGate.filter((run) => run.prGate.mode === mode)
        return [mode, {
          sampleSize: modeRuns.length,
          timeToGateStartSeconds: summarizeMeasured(modeRuns.map((run) => (
            measuredSeconds(run.createdAt, run.prGate.startedAt)
          ))),
          gateRunSeconds: summarizeMeasured(modeRuns.map((run) => (
            measuredSeconds(run.prGate.startedAt, run.prGate.completedAt)
          ))),
          timeToGatePassSeconds: summarizeMeasured(modeRuns.map((run) => (
            measuredSeconds(run.createdAt, run.prGate.completedAt)
          ))),
        }]
      }),
  )

  return {
    sampleSize: completed.length,
    successfulSampleSize: successful.length,
    counts,
    cancellationRate: completed.length === 0 ? null : cancelled.length / completed.length,
    cancelledElapsedSeconds: Math.round(cancelled.reduce(
      (sum, run) => sum + (measuredSeconds(run.startedAt, run.updatedAt) ?? 0),
      0,
    )),
    cancelledRunsWithoutElapsedEvidence: cancelled.filter(run => measuredSeconds(run.startedAt, run.updatedAt) === null).length,
    successfulQueueSeconds: summarizeMeasured(queueSeconds),
    successfulRunSeconds: summarizeMeasured(runSeconds),
    successfulWallSeconds: summarizeMeasured(wallSeconds),
    successfulRunsWithoutPrGateEvidence: successful.length - successfulWithGate.length,
    prGateByMode: perMode,
    ...summarizeJobEvidence(completed),
  }
}

// Rerunning failed jobs gives carried successes new IDs/attempt labels without
// executing them again. Retain all failures but count identical physical job
// intervals once, attributing carried evidence to its earliest observed attempt.
export function distinctJobExecutions(jobs) {
  const executions = new Map()
  for (const [index, job] of jobs.entries()) {
    const interval = measuredSeconds(job.started_at, job.completed_at)
    const key = interval === null ? `missing:${index}` : JSON.stringify([
      job.name, job.runner_id ?? null, job.started_at, job.completed_at, job.conclusion,
    ])
    const previous = executions.get(key)
    if (!previous) executions.set(key, { ...job })
    else if (Number.isInteger(job.run_attempt) && (!Number.isInteger(previous.run_attempt) || job.run_attempt < previous.run_attempt)) {
      previous.run_attempt = job.run_attempt
    }
  }
  return [...executions.values()]
}

function measuredSeconds(start, end) {
  const first = Date.parse(start)
  const last = Date.parse(end)
  return Number.isFinite(first) && Number.isFinite(last) && last >= first
    ? (last - first) / 1000 : null
}

// Job elapsed time includes setup and teardown. Summing it measures runner
// consumption; overlapping jobs must never be summed as workflow wall time.
export function summarizeJobEvidence(runs) {
  const jobs = new Map()
  const steps = new Map()
  const evidence = []
  let cancelledJobSeconds = 0
  let missingJobDurations = 0
  let missingStepDurations = 0
  let earlierFailedJobSeconds = 0
  const collect = (groups, identity, seconds) => {
    const key = JSON.stringify(identity)
    const group = groups.get(key) ?? { ...identity, durations: [] }
    group.durations.push(seconds)
    groups.set(key, group)
  }
  for (const run of runs) {
    if (!Array.isArray(run.jobs)) continue
    const mode = run.prGate?.mode ?? 'unknown'
    const failedSteps = []
    let runnerSeconds = 0
    let timedJobs = 0
    for (const job of distinctJobExecutions(run.jobs)) {
      if (job.conclusion === 'skipped') continue
      const runner = job.labels?.includes('self-hosted') ? 'self-hosted'
        : job.labels?.some(label => label.startsWith('ubuntu-')) ? 'hosted' : 'unknown'
      const identity = { mode, job: job.name, runner }
      const seconds = measuredSeconds(job.started_at, job.completed_at)
      if (seconds === null) missingJobDurations++
      else {
        runnerSeconds += seconds
        timedJobs++
        if (job.conclusion === 'failure' && Number.isInteger(run.attempt) && job.run_attempt < run.attempt) earlierFailedJobSeconds += seconds
        if (run.conclusion === 'success' && job.conclusion === 'success') collect(jobs, identity, seconds)
      }
      for (const step of job.steps ?? []) {
        if (step.conclusion === 'skipped') continue
        const elapsed = measuredSeconds(step.started_at, step.completed_at)
        if (elapsed === null) missingStepDurations++
        if (run.conclusion === 'success' && step.conclusion === 'success' && elapsed !== null) {
          collect(steps, { ...identity, step: step.name }, elapsed)
        }
        if (step.conclusion === 'failure') failedSteps.push({ job: job.name, step: step.name, attempt: job.run_attempt ?? null,
          timeToFailureSeconds: measuredSeconds(run.createdAt, step.completed_at) })
      }
    }
    if (run.conclusion === 'cancelled') cancelledJobSeconds += runnerSeconds
    evidence.push({ runId: run.databaseId ?? null, headSha: run.headSha ?? null, latestAttempt: run.attempt ?? null,
      executionAttempts: [...new Set(run.jobs.map(job => job.run_attempt).filter(Number.isInteger))].sort((a, b) => a - b),
      mode, conclusion: run.conclusion, timedJobs, runnerSeconds, failedSteps })
  }
  const finish = groups => [...groups.values()].map(({ durations, ...identity }) => ({
    ...identity, sampleSize: durations.length, seconds: summarize(durations),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return {
    runsWithoutJobEvidence: runs.filter(run => !Array.isArray(run.jobs)).length,
    missingJobDurations,
    missingStepDurations,
    cancelledJobSeconds,
    earlierFailedJobSeconds,
    successfulJobTimings: finish(jobs),
    successfulStepTimings: finish(steps),
    runEvidence: evidence,
  }
}

function parseArguments(argv) {
  const args = { repo: 'codepetca/pika', workflow: 'ci.yml', limit: 20 }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    else if (value === '--repo') args.repo = argv[++index]
    else if (value === '--workflow') args.workflow = argv[++index]
    else if (value === '--limit') args.limit = Number(argv[++index])
    else throw new Error(`Unknown argument: ${value}`)
  }
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) {
    throw new Error('--limit must be an integer from 1 to 100')
  }
  return args
}

function loadJobs(runId, repo) {
  try {
    const pages = JSON.parse(execFileSync('gh', [
      'api', `repos/${repo}/actions/runs/${runId}/jobs?filter=all&per_page=100`,
      '--paginate', '--slurp',
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))
    if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page.jobs))) return null
    return pages.flatMap(page => page.jobs)
  } catch { return null }
}

function loadPrGateEvidence(runId, repo, jobs) {
  try {
    const gate = jobs?.filter((job) => job.name === 'PR Gate' && job.conclusion === 'success')
      .sort((a, b) => (b.run_attempt ?? 0) - (a.run_attempt ?? 0))[0]
    if (!gate?.id || !gate.started_at || !gate.completed_at) return null

    const log = execFileSync('gh', [
      'run',
      'view',
      String(runId),
      '--repo',
      repo,
      '--job',
      String(gate.id),
      '--log',
    ], { encoding: 'utf8' })
    const mode = log.match(/CI mode:\s*([a-z-]+)/)?.[1] ?? null
    if (!mode) return null
    return {
      mode,
      startedAt: gate.started_at,
      completedAt: gate.completed_at,
    }
  } catch {
    return null
  }
}

const invokedPath = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : null
if (invokedPath === import.meta.url) {
  try {
    const args = parseArguments(process.argv.slice(2))
    const raw = execFileSync('gh', [
      'run',
      'list',
      '--repo',
      args.repo,
      '--workflow',
      args.workflow,
      '--limit',
      String(args.limit),
      '--json',
      'databaseId,status,conclusion,createdAt,startedAt,updatedAt,url,headSha,attempt',
    ], { encoding: 'utf8' })
    const runs = JSON.parse(raw).map((run) => {
      const jobs = run.status === 'completed' ? loadJobs(run.databaseId, args.repo) : null
      return { ...run, jobs,
        prGate: run.status === 'completed' && run.conclusion === 'success'
          ? loadPrGateEvidence(run.databaseId, args.repo, jobs) : null }
    })
    console.log(JSON.stringify(summarizeCiRuns(runs), null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
