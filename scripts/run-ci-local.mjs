#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const jobsByLane = {
  'test-build': 'test-and-build',
  database: 'architecture-database-contracts',
  'test-owner-sdk': 'contextual-test-owner-sdk',
  browser: 'browser-experience-matrix',
}
const actions = new Set(['actions/checkout@v7', 'actions/setup-node@v6', 'pnpm/action-setup@v6',
  'supabase/setup-cli@v1', 'actions/cache@v6', 'actions/upload-artifact@v7'])
const summaryNames = new Set(['Summarize dependency setup evidence', 'Summarize browser setup evidence'])
const selector = "needs.classify-changes.outputs.run_test_build == 'true'"
const cleanupCondition = "always() && steps.ci-isolation.outcome == 'success' && steps.supabase-start.outcome != 'skipped'"
const startCommand = 'supabase start -x analytics,edge-runtime,functions,imgproxy,inbucket,meta,realtime,studio,vector'
const conditions = new Set([selector, 'always()', 'success()', `failure() && ${selector}`, cleanupCondition])
const actionOptions = {
  'actions/checkout@v7': ['fetch-depth'],
  'actions/setup-node@v6': ['node-version'],
  'pnpm/action-setup@v6': ['version'],
  'supabase/setup-cli@v1': ['version'],
  'actions/cache@v6': ['path', 'key', 'restore-keys'],
  'actions/upload-artifact@v7': ['name', 'path', 'retention-days'],
}

export function parseArguments(argv) {
  const args = { lane: 'all', ref: null, dryRun: false, acknowledged: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--lane') args.lane = argv[++index]
    else if (value === '--ref') args.ref = argv[++index]
    else if (value === '--dry-run') args.dryRun = true
    else if (value === '--ack=DISPOSABLE_CI_DATABASE') args.acknowledged = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  if (!(args.lane in jobsByLane) && args.lane !== 'all') throw new Error('Use --lane test-build|database|test-owner-sdk|browser|all.')
  if (args.ref !== null && args.ref !== 'HEAD' && !/^[a-f0-9]{40}$/.test(args.ref ?? '')) throw new Error('--ref requires HEAD or a full lowercase 40-character commit SHA.')
  return args
}

function scalar(value) {
  if (!value || /^[|>&*!{[]/.test(value)) throw new Error(`Unsupported YAML scalar: ${value}`)
  if (value.startsWith('"')) return JSON.parse(value)
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new Error('Unterminated YAML scalar.')
    return value.slice(1, -1).replaceAll("''", "'")
  }
  return value
}

function literalEnvironment(lines, indent) {
  const env = {}
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const match = line.match(new RegExp(`^ {${indent}}([A-Z][A-Z0-9_]*): (.+)$`))
    if (!match || match[2].includes('${{')) throw new Error(`Unsupported CI environment entry: ${line.trim()}`)
    if (match[1] in env) throw new Error(`Duplicate CI environment entry: ${match[1]}`)
    env[match[1]] = scalar(match[2])
  }
  return env
}

function parseStep(lines) {
  const first = lines[0].match(/^      - name: (.+)$/)
  if (!first) throw new Error('Every local CI step must have a name.')
  const step = { name: scalar(first[1]), env: {}, with: {} }
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const property = line.match(/^        ([a-z-]+):(?: (.*))?$/)
    if (!property || !['id', 'shell', 'if', 'run', 'uses', 'env', 'with'].includes(property[1])) {
      throw new Error(`Unsupported CI step property in ${step.name}: ${line.trim()}`)
    }
    const [, key, value] = property
    if ((key !== 'env' && key !== 'with' && key in step) || ((key === 'env' || key === 'with') && Object.keys(step[key]).length)) throw new Error(`Duplicate ${key} in ${step.name}.`)
    if (key === 'run' && value === '|') {
      const body = []
      while (index + 1 < lines.length && (/^ {10}/.test(lines[index + 1]) || !lines[index + 1].trim())) {
        const bodyLine = lines[++index]
        body.push(bodyLine.trim() ? bodyLine.slice(10) : '')
      }
      step.run = body.join('\n').trimEnd()
    } else if (key === 'env' || key === 'with') {
      if (value) throw new Error(`Inline ${key} is unsupported in ${step.name}.`)
      const body = []
      while (index + 1 < lines.length && (/^ {10}/.test(lines[index + 1]) || !lines[index + 1].trim())) body.push(lines[++index])
      if (key === 'env') step.env = literalEnvironment(body, 10)
      else {
        // Action configuration is never executed locally. Preserve it for pinned
        // tool-version validation and report each action as an explicit override.
        let block = false
        for (const entry of body) {
          if (!entry.trim() || entry.trimStart().startsWith('#')) continue
          const match = entry.match(/^          ([a-z-]+): (.+)$/)
          if (match) {
            if (match[1] in step.with) throw new Error(`Duplicate action option in ${step.name}.`)
            step.with[match[1]] = match[2]
            block = match[2] === '|' && ['path', 'restore-keys'].includes(match[1])
            if (/^[|>]/.test(match[2]) && !block) throw new Error(`Unsupported action block in ${step.name}.`)
          } else if (!block || !/^ {12}\S/.test(entry)) throw new Error(`Unsupported action configuration in ${step.name}.`)
        }
      }
    } else step[key] = key === 'run' ? value : scalar(value)
  }
  if (Boolean(step.run) === Boolean(step.uses)) throw new Error(`${step.name} must contain exactly one run or uses.`)
  if (step.shell && step.shell !== 'bash') throw new Error(`Unsupported shell in ${step.name}.`)
  if (step.if && !conditions.has(step.if)) throw new Error(`Unsupported condition in ${step.name}: ${step.if}`)
  if (step.uses && !actions.has(step.uses)) throw new Error(`Unsupported action: ${step.uses}`)
  if (step.uses && Object.keys(step.with).some(key => !actionOptions[step.uses].includes(key))) throw new Error(`Unsupported action option in ${step.name}.`)
  if (step.uses === 'actions/setup-node@v6' && scalar(step.with['node-version']) !== '24') throw new Error('Local CI supports only the pinned Node 24 setup.')
  if (step.uses === 'pnpm/action-setup@v6' && scalar(step.with.version) !== '10.25.0') throw new Error('Local CI supports only pnpm 10.25.0.')
  if (step.uses === 'supabase/setup-cli@v1' && scalar(step.with.version) !== '2.103.0') throw new Error('Local CI supports only Supabase 2.103.0.')
  if (step.run?.includes('${{')) {
    if (!summaryNames.has(step.name) || step.run.replace(/\$\{\{ steps\.[a-z-]+\.outputs\.cache-hit \}\}/g, '').includes('${{')) throw new Error(`Unsupported run interpolation in ${step.name}.`)
    step.localOverride = 'Cache setup summary is emitted locally without GitHub cache evidence.'
    step.run = step.run.replace(/\$\{\{ steps\.[a-z-]+\.outputs\.cache-hit \}\}/g, 'unavailable (local setup)')
  }
  return step
}

export function extractWorkflow(source) {
  const lines = source.split(/\r?\n/)
  const jobs = {}
  for (const [lane, id] of Object.entries(jobsByLane)) {
    const starts = lines.map((line, index) => line === `  ${id}:` ? index : -1).filter(index => index !== -1)
    if (starts.length !== 1) throw new Error(`Missing or duplicate canonical job: ${id}`)
    const start = starts[0] + 1
    let end = start
    while (end < lines.length && !/^  [a-z][a-z-]*:$/.test(lines[end])) end += 1
    const body = lines.slice(start, end)
    const stepsIndex = body.findIndex(line => line === '    steps:')
    if (stepsIndex === -1) throw new Error(`Missing steps in ${id}.`)
    for (const line of body.slice(0, stepsIndex)) {
      if (!line.trim() || line.trimStart().startsWith('#') || /^ {6}[A-Z][A-Z0-9_]*:/.test(line)) continue
      if (!/^    (?:name|needs|if|runs-on|timeout-minutes|env):/.test(line)) throw new Error(`Unsupported canonical job property in ${id}: ${line.trim()}`)
    }
    const envIndex = body.slice(0, stepsIndex).findIndex(line => line === '    env:')
    const env = envIndex === -1 ? {} : literalEnvironment(body.slice(envIndex + 1, stepsIndex), 6)
    const steps = []
    let chunk = []
    for (const line of body.slice(stepsIndex + 1)) {
      if (/^      - /.test(line)) {
        if (chunk.length) steps.push(parseStep(chunk))
        chunk = [line]
      } else if (chunk.length) chunk.push(line)
      else if (line.trim() && !line.trimStart().startsWith('#')) throw new Error(`Unsupported steps syntax in ${id}.`)
    }
    if (chunk.length) steps.push(parseStep(chunk))
    if (!steps.length) throw new Error(`No steps in ${id}.`)
    jobs[id] = { id, lane, env, steps }
    validateLaneSafety(jobs[id])
  }
  return jobs
}

export function selectPlan(jobs, lane) {
  // Keep the existing database selection complete after moving its SDK proofs.
  // All jobs run serially locally, each with its own guarded startup/cleanup.
  const lanes = lane === 'all' ? Object.keys(jobsByLane) : lane === 'database' ? ['database', 'test-owner-sdk'] : [lane]
  return lanes.map(value => jobs[jobsByLane[value]])
}

export function validateLaneSafety(job) {
  const preflight = job.steps.filter(step => step.id === 'ci-isolation' || step.name === 'Verify isolated CI runner')
  if (preflight.length !== 1 || preflight[0].id !== 'ci-isolation' || preflight[0].if || preflight[0].run !== `node scripts/ci-runner-preflight.mjs --lane ${job.lane}`) throw new Error(`Canonical ${job.lane} preflight is missing or changed.`)
  if (job.lane === 'test-build') return
  const starts = job.steps.filter(step => step.id === 'supabase-start' || /\bsupabase\s+start\b/.test(step.run ?? ''))
  const stops = job.steps.filter(step => /\bsupabase\s+stop\b/.test(step.run ?? ''))
  if (starts.length !== 1 || starts[0].id !== 'supabase-start' || starts[0].if || starts[0].run !== startCommand || stops.length !== 1 || stops[0].run !== 'supabase stop --no-backup' || stops[0].if !== cleanupCondition) throw new Error(`Canonical ${job.lane} startup or cleanup changed; update the local safety contract.`)
  if (job.steps.indexOf(preflight[0]) >= job.steps.indexOf(starts[0]) || job.steps.indexOf(starts[0]) >= job.steps.indexOf(stops[0]) || job.steps.some((step, index) => index > job.steps.indexOf(stops[0]) && step.run)) throw new Error(`Canonical ${job.lane} preflight/start/cleanup order changed.`)
}

export function shouldRun(condition, failed, outcomes = {}) {
  if (condition && !conditions.has(condition)) throw new Error(`Unsupported condition: ${condition}`)
  if (condition === 'always()') return true
  if (condition === cleanupCondition) return outcomes['ci-isolation'] === 'success' && ['success', 'failure'].includes(outcomes['supabase-start'])
  if (condition === `failure() && ${selector}`) return failed
  return !failed
}

export function localEnvironment(input) {
  // No provider credentials, NODE_OPTIONS, env-file inputs, or developer app
  // settings may cross into the disposable checkout. Docker connection settings
  // select the dedicated daemon whose empty resource inventory preflight checks.
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'LOGNAME', 'SHELL',
    'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH',
    'PNPM_HOME', 'NVM_BIN', 'NVM_DIR', 'VOLTA_HOME', 'ASDF_DIR', 'ASDF_DATA_DIR',
    'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'LANG', 'LC_ALL']
  return { ...Object.fromEntries(allowed.filter(key => typeof input[key] === 'string').map(key => [key, input[key]])),
    CI: 'true', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
}

function command(binary, args, cwd, env) {
  return execFileSync(binary, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function stripEnvironmentFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const path = join(directory, entry.name)
    if (entry.name.startsWith('.env') && entry.name !== '.env.example') rmSync(path, { force: true, recursive: entry.isDirectory() })
    else if (entry.isDirectory()) stripEnvironmentFiles(path)
  }
}

export function importedEnvironment(path) {
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (!match || !['STORE_PATH', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'].includes(match[1]) || match[2].includes('\r') || match[1] in env) throw new Error('Unsupported local GITHUB_ENV entry.')
    env[match[1]] = match[2]
  }
  return env
}

export class CiProcessGroupError extends Error {
  constructor() {
    super('CI process group did not stop; inspect the dedicated VM before retrying')
  }
}

async function terminateGroup(pid, graceMs) {
  const alive = () => {
    try { process.kill(-pid, 0); return true }
    catch (error) { return error.code !== 'ESRCH' }
  }
  const signal = value => { try { process.kill(-pid, value) } catch {} }
  signal('SIGTERM')
  const escalateAt = Date.now() + graceMs
  let escalated = false
  while (alive()) {
    if (!escalated && Date.now() >= escalateAt) { signal('SIGKILL'); escalated = true }
    if (Date.now() > escalateAt + 2_000) throw new CiProcessGroupError()
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

export async function executeStep(script, cwd, env, onChild, logPath, { terminationGraceMs = 10_000 } = {}) {
  return await new Promise((resolveStep, reject) => {
    const log = openSync(logPath, 'w', 0o600)
    const child = spawn('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], { cwd, env, stdio: ['ignore', log, log], detached: true })
    let closed = false
    let termination
    let outcome = 128
    const finish = () => {
      if (closed) return
      closed = true
      clearTimeout(timeout)
      closeSync(log)
      onChild(null)
    }
    const terminate = () => {
      if (closed || termination) return
      // Await the whole group, including descendants that outlive Bash. Never
      // clear escalation merely because the process-group leader exits.
      termination = terminateGroup(child.pid, terminationGraceMs).then(() => {
        finish()
        resolveStep(outcome === 0 ? 128 : outcome)
      }, error => {
        child.unref()
        finish()
        reject(error)
      })
    }
    const timeout = setTimeout(terminate, script === 'supabase stop --no-backup' ? 120_000 : 90 * 60_000)
    child.once('error', error => { finish(); reject(error) })
    child.once('exit', (code, signal) => {
      outcome = code === 0 ? 0 : code ?? (signal ? 128 : 1)
      if (!termination) { finish(); resolveStep(outcome) }
    })
    onChild(child, terminate)
  })
}

// The injectable executor makes refusal, partial startup and interruption
// behavior testable without invoking Docker, installing tools, or replaying SQL.
export async function runLane(job, checkout, temp, env, { execute = executeStep, interrupted = () => false, onChild = () => {} } = {}) {
  validateLaneSafety(job)
  let startedDatabase = false
  let stopSucceeded = false
  let laneFailed = false
  let cleanupSafe = true
  const outcomes = {}
  let laneEnv = { ...env, ...job.env, GITHUB_WORKSPACE: checkout, RUNNER_TEMP: temp }
  try {
    // The canonical workflow repeats this guard before its contracts. Locally,
    // also refuse an unsafe checkout/daemon before dependency install hooks run.
    if (interrupted()) return false
    const earlyLog = join(temp, `${job.lane}-early-preflight.log`)
    const earlyStatus = await execute(`node scripts/ci-runner-preflight.mjs --lane ${job.lane}`, checkout, laneEnv, onChild, earlyLog)
    if (earlyStatus !== 0) {
      console.error(`Local CI preflight refused ${job.lane}. Log: ${earlyLog}\n${readFileSync(earlyLog, 'utf8')}`)
      return true
    }
    for (const [index, step] of job.steps.entries()) {
      if (interrupted() && step.run !== 'supabase stop --no-backup') { if (step.id) outcomes[step.id] = 'skipped'; continue }
      if (!shouldRun(step.if, laneFailed || interrupted(), outcomes)) { if (step.id) outcomes[step.id] = 'skipped'; continue }
      if (step.uses) {
        console.log(`Local setup override: ${step.name}`)
        if (step.id) outcomes[step.id] = 'success'
        continue
      }
      if (step.localOverride) console.log(step.localOverride)
      const envFile = join(temp, `${job.lane}-${index}.env`)
      const summary = join(temp, `${job.lane}-${index}.summary.md`)
      writeFileSync(envFile, '', { mode: 0o600 })
      writeFileSync(summary, '', { mode: 0o600 })
      if (step.run === startCommand) {
        if (outcomes['ci-isolation'] !== 'success') throw new Error('Supabase start requires successful isolated-runner preflight.')
        startedDatabase = true
      }
      console.log(`\nRunning ${job.lane}: ${step.name}`)
      const log = join(temp, `${job.lane}-${index}.log`)
      const status = await execute(step.run, checkout, { ...laneEnv, ...step.env, GITHUB_ENV: envFile, GITHUB_STEP_SUMMARY: summary }, onChild, log)
      if (step.id) outcomes[step.id] = status === 0 ? 'success' : 'failure'
      if (step.run === 'supabase stop --no-backup') stopSucceeded = status === 0
      if (status !== 0) { laneFailed = true; console.error(`FAIL ${step.name} (status ${status}). Log: ${log}\n${readFileSync(log, 'utf8')}`) }
      else {
        console.log(`PASS ${step.name}. Log: ${log}`)
        laneEnv = { ...laneEnv, ...importedEnvironment(envFile) }
      }
    }
  } catch (error) {
    if (error instanceof CiProcessGroupError) cleanupSafe = false
    throw error
  } finally {
    if (startedDatabase && !stopSucceeded && !cleanupSafe) {
      console.error('A CI process group may still be running; no database cleanup was attempted. Inspect the dedicated VM.')
    }
    if (startedDatabase && !stopSucceeded && cleanupSafe) {
      console.log('Cleaning up the disposable Supabase stack started by this lane.')
      const status = await execute('supabase stop --no-backup', checkout, laneEnv, onChild, join(temp, `${job.lane}-cleanup.log`))
      if (status !== 0) { laneFailed = true; console.error('Disposable Supabase cleanup failed; inspect the retained receipts and dedicated daemon.') }
    }
  }
  return laneFailed
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const env = localEnvironment(process.env)
  const sha = command('git', ['rev-parse', '--verify', `${args.ref ?? 'HEAD'}^{commit}`], root, env)
  if (!/^[a-f0-9]{40}$/.test(sha) || (args.ref && args.ref !== 'HEAD' && sha !== args.ref)) throw new Error('The exact commit could not be resolved.')
  const source = command('git', ['show', `${sha}:.github/workflows/ci.yml`], root, env)
  const plan = selectPlan(extractWorkflow(source), args.lane)
  const migrations = command('git', ['ls-tree', '-r', '--name-only', sha, '--', 'supabase/migrations'], root, env).split('\n').filter(Boolean).sort()
  console.log(`Local CI commit: ${sha}\nSource: canonical CI workflow at this commit\nLanes: ${plan.map(job => job.lane).join(', ')}`)
  for (const job of plan) {
    console.log(`\n${job.lane}:`)
    for (const step of job.steps) console.log(`- ${step.name}: ${step.uses ? `local override (${step.uses}); pinned tools verified, cache/artifact actions skipped` : step.localOverride ?? step.run}`)
  }
  const hasDatabase = plan.some(job => job.lane !== 'test-build')
  if (hasDatabase) {
    console.log(`\nComplete disposable migration replay (${migrations.length} files):\n${migrations.join('\n')}`)
    console.log('Database/browser lanes require a dedicated Linux VM and Docker daemon, with one runner and no developer resources.')
  }
  if (args.dryRun) return
  if (hasDatabase && !args.acknowledged) throw new Error('Review this exact commit and migration inventory, then repeat with --ack=DISPOSABLE_CI_DATABASE. No database was started.')
  if (hasDatabase && process.platform !== 'linux') throw new Error('Disposable database/browser CI requires Linux.')
  if (process.versions.node.split('.')[0] !== '24') throw new Error('Node 24 is required.')
  if (command('pnpm', ['--version'], root, env) !== '10.25.0') throw new Error('pnpm 10.25.0 is required.')
  if (hasDatabase && command('supabase', ['--version'], root, env) !== '2.103.0') throw new Error('Supabase CLI 2.103.0 is required.')
  const temp = mkdtempSync(join(tmpdir(), 'pika-ci-local-'))
  const checkout = join(temp, 'source')
  console.log(`\nLocal CI checkout and receipts: ${temp}`)
  command('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--no-hardlinks', '--no-checkout', '--', root, checkout], root, env)
  command('git', ['-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', sha], checkout, env)
  stripEnvironmentFiles(checkout)
  let terminateChild = null
  let interrupted = false
  const interrupt = () => {
    interrupted = true
    terminateChild?.()
  }
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', interrupt)
  let failed = false
  try {
    for (const job of plan) {
      if (failed || interrupted) break
      failed ||= await runLane(job, checkout, temp, env, {
        interrupted: () => interrupted,
        onChild: (child, terminate) => { terminateChild = child ? terminate : null },
      })
    }
    if (failed || interrupted) throw new Error(`Local CI ${interrupted ? 'interrupted' : 'failed'}. Receipts retained at ${temp}.`)
    console.log(`\nPASS canonical local CI for ${sha}. Receipts: ${temp}`)
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
}
