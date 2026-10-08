#!/usr/bin/env node

import { execFileSync } from 'node:child_process'

function secondsBetween(start, end) {
  return Math.max(0, (Date.parse(end) - Date.parse(start)) / 1000)
}

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

export function summarizeCiRuns(runs) {
  const completed = runs.filter((run) => run.status === 'completed' && run.startedAt && run.updatedAt)
  const successful = completed.filter((run) => run.conclusion === 'success')
  const counts = Object.fromEntries(
    [...new Set(completed.map((run) => run.conclusion || 'unknown'))]
      .sort()
      .map((conclusion) => [
        conclusion,
        completed.filter((run) => (run.conclusion || 'unknown') === conclusion).length,
      ]),
  )
  const queueSeconds = successful.map((run) => secondsBetween(run.createdAt, run.startedAt))
  const runSeconds = successful.map((run) => secondsBetween(run.startedAt, run.updatedAt))
  const wallSeconds = successful.map((run) => secondsBetween(run.createdAt, run.updatedAt))
  const cancelled = completed.filter((run) => run.conclusion === 'cancelled')
  const successfulWithGate = successful.filter((run) => (
    run.prGate?.mode
    && run.prGate.startedAt
    && run.prGate.completedAt
  ))
  const perMode = Object.fromEntries(
    [...new Set(successfulWithGate.map((run) => run.prGate.mode))]
      .sort()
      .map((mode) => {
        const modeRuns = successfulWithGate.filter((run) => run.prGate.mode === mode)
        return [mode, {
          sampleSize: modeRuns.length,
          timeToGateStartSeconds: summarize(modeRuns.map((run) => (
            secondsBetween(run.createdAt, run.prGate.startedAt)
          ))),
          gateRunSeconds: summarize(modeRuns.map((run) => (
            secondsBetween(run.prGate.startedAt, run.prGate.completedAt)
          ))),
          timeToGatePassSeconds: summarize(modeRuns.map((run) => (
            secondsBetween(run.createdAt, run.prGate.completedAt)
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
      (sum, run) => sum + secondsBetween(run.startedAt, run.updatedAt),
      0,
    )),
    successfulQueueSeconds: summarize(queueSeconds),
    successfulRunSeconds: summarize(runSeconds),
    successfulWallSeconds: summarize(wallSeconds),
    successfulRunsWithoutPrGateEvidence: successful.length - successfulWithGate.length,
    prGateByMode: perMode,
    ...summarizeJobEvidence(completed),
  }
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
    for (const job of run.jobs) {
      if (job.conclusion === 'skipped') continue
      const runner = job.labels?.includes('self-hosted') ? 'self-hosted'
        : job.labels?.some(label => label.startsWith('ubuntu-')) ? 'hosted' : 'unknown'
      const identity = { mode, job: job.name, runner }
      const seconds = measuredSeconds(job.started_at, job.completed_at)
      if (seconds === null) missingJobDurations++
      else {
        runnerSeconds += seconds
        timedJobs++
        if (run.conclusion === 'success' && job.conclusion === 'success') collect(jobs, identity, seconds)
      }
      for (const step of job.steps ?? []) {
        if (step.conclusion === 'skipped') continue
        const elapsed = measuredSeconds(step.started_at, step.completed_at)
        if (run.conclusion === 'success' && step.conclusion === 'success' && elapsed !== null) {
          collect(steps, { ...identity, step: step.name }, elapsed)
        }
        if (step.conclusion === 'failure') failedSteps.push({ job: job.name, step: step.name,
          timeToFailureSeconds: measuredSeconds(run.createdAt, step.completed_at) })
      }
    }
    if (run.conclusion === 'cancelled') cancelledJobSeconds += runnerSeconds
    evidence.push({ runId: run.databaseId ?? null, headSha: run.headSha ?? null,
      mode, conclusion: run.conclusion, timedJobs, runnerSeconds, failedSteps })
  }
  const finish = groups => [...groups.values()].map(({ durations, ...identity }) => ({
    ...identity, sampleSize: durations.length, seconds: summarize(durations),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return {
    runsWithoutJobEvidence: runs.filter(run => !Array.isArray(run.jobs)).length,
    missingJobDurations,
    cancelledJobSeconds,
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
      'api', `repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
      '--paginate', '--slurp',
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))
    if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page.jobs))) return null
    return pages.flatMap(page => page.jobs)
  } catch { return null }
}

function loadPrGateEvidence(runId, repo, jobs) {
  try {
    const gate = jobs?.find((job) => job.name === 'PR Gate')
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
      'databaseId,status,conclusion,createdAt,startedAt,updatedAt,url,headSha',
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
