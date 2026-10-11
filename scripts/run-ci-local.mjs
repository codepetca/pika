#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const jobsByLane = {
  'test-build': 'test-and-build',
  database: 'architecture-database-contracts',
  'database-lifecycle': 'architecture-database-contracts-lifecycle',
  'test-owner-sdk': 'contextual-test-owner-sdk',
  'test-owner-sdk-lifecycle': 'contextual-test-owner-sdk-lifecycle',
  browser: 'browser-experience-matrix',
  'browser-dark': 'browser-experience-dark',
  'browser-pattern-dark': 'browser-pattern-lab-dark',
}
const browserCommands = {
  browser: 'pnpm e2e:ci --project=chromium-desktop --project=chromium-mobile-light --project=pattern-lab-desktop-light --project=pattern-lab-mobile-light',
  'browser-dark': 'pnpm e2e:ci --project=chromium-desktop-dark --project=chromium-mobile-dark',
  'browser-pattern-dark': 'pnpm e2e:ci --project=pattern-lab-desktop-dark --project=pattern-lab-mobile-dark',
}
const historicalDarkCommand = browserCommands['browser-dark'] + ' --project=pattern-lab-desktop-dark --project=pattern-lab-mobile-dark'
const isBrowserLane = lane => ['browser', 'browser-dark', 'browser-pattern-dark'].includes(lane)
const ownerProofs = [
  ['detail', 'Verify isolated contextual Test owner-detail SDK reads'],
  ['list', 'Verify isolated contextual Test owner-list SDK reads'],
  ['draft-get', 'Verify isolated contextual Test owner-draft GET transactions'],
  ['draft-save', 'Verify isolated contextual Test owner-draft save transactions'],
  ['create', 'Verify isolated contextual Test owner creation transactions'],
  ['pristine-discard', 'Verify isolated contextual pristine Test draft discard transactions'],
  ['publication', 'Verify isolated contextual Test owner publication transactions'],
]
const lifecycleProofs = new Set(['draft-get', 'pristine-discard', 'publication'])
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
  if (!Object.hasOwn(jobsByLane, args.lane) && args.lane !== 'all') throw new Error('Use --lane test-build|database|database-lifecycle|test-owner-sdk|test-owner-sdk-lifecycle|browser|browser-dark|browser-pattern-dark|all.')
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

// Reviewed ordered proof-name inventories, not copies of executable scripts.
// Intentional additions/renames/repartitioning update counts/digests after review.
// Historical combined DB layouts retain their own commands and established
// sentinels; today's inventories apply only to the explicit split layout.
const databaseProofInventories = {
  database: [52, '7caa4a5884cbc819df40f43b070b6e8c2d2e8c10303cfe325616dafe4870e383'],
  'database-lifecycle': [86, '5cfe4e6f6cae186ffd8dbbbcac8635792dfa89399e0e62d3d3c7e9a245cfd77f'],
}
function databaseProofs(job) {
  const start = job.steps.findIndex(step => step.id === 'supabase-start')
  const stop = job.steps.findIndex(step => step.run === 'supabase stop --no-backup')
  if (start < 0 || stop <= start) throw new Error('Missing database proof boundaries.')
  return job.steps.slice(start + 1, stop)
}
function validateDatabaseInventory(jobs) {
  const primary = jobs[jobsByLane.database]
  if (!primary) throw new Error('Missing canonical database job.')
  const secondary = jobs[jobsByLane['database-lifecycle']]
  if (secondary) {
    for (const lane of ['database', 'database-lifecycle']) {
      const job = jobs[jobsByLane[lane]], proofs = databaseProofs(job)
      const [count, digest] = databaseProofInventories[lane]
      const namesDigest = createHash('sha256').update(JSON.stringify(proofs.map(step => step.name))).digest('hex')
      if (job.id !== jobsByLane[lane] || job.lane !== lane || proofs.length !== count || namesDigest !== digest
        || proofs.some(step => !step.run || step.uses || step.if)) {
        throw new Error(`Canonical ${lane} database proof inventory is incomplete, reordered or changed.`)
      }
    }
  } else {
    // Daily Log exists in supported generations and rejects a truncated split
    // prefix even if all new markers were erased. The earlier pre-SDK generation
    // predates both member-list/reorder; it still retains all seven SDK proofs.
    const proofs = databaseProofs(primary)
    const pair = [
      ['Verify isolated contextual Test member-list SDK reads', 'scripts/check-contextual-test-member-list-lifecycle.ts'],
      ['Verify isolated contextual Test owner reorder transactions', 'scripts/check-contextual-test-owner-reorder-lifecycle.ts'],
    ]
    const pairRequired = Boolean(jobs[jobsByLane['test-owner-sdk']])
      || pair.some(([name, script]) => primary.steps.some(step => step.name === name || step.run?.includes(script)))
    const sentinels = [
      ...(pairRequired ? pair : []),
      ['Verify contextual Daily Log save atomicity and privileges', 'scripts/check-contextual-daily-log-save-database.sh'],
    ]
    let previous = -1
    for (const [name, script] of sentinels) {
      const matches = primary.steps.filter(step => step.name === name || step.run?.includes(script))
      const index = proofs.indexOf(matches[0])
      if (matches.length !== 1 || matches[0].name !== name || !matches[0].run?.includes(script)
        || matches[0].if || index <= previous) throw new Error('Incomplete historical combined database proof inventory.')
      previous = index
    }
  }
}

export function extractWorkflow(source) {
  const lines = source.split(/\r?\n/)
  const split = lines.includes(`  ${jobsByLane['test-owner-sdk']}:`)
  const sdkPartitioned = lines.includes(`  ${jobsByLane['test-owner-sdk-lifecycle']}:`)
  const databaseSplit = lines.includes(`  ${jobsByLane['database-lifecycle']}:`)
  if (!databaseSplit && /architecture-database-contracts-lifecycle|DATABASE_LIFECYCLE_RESULT|--lane database-lifecycle/.test(source)) throw new Error('Missing or renamed canonical database lifecycle job in partitioned workflow.')
  const browserSplit = lines.includes(`  ${jobsByLane['browser-dark']}:`)
  const browserPatternSplit = lines.includes(`  ${jobsByLane['browser-pattern-dark']}:`)
  // Historical reviewed commits retain all seven proofs in the original job.
  // A damaged split workflow must never silently become a legacy plan.
  if (!split && /contextual-test-owner-sdk|TEST_OWNER_SDK_RESULT/.test(source)) throw new Error('Missing or renamed canonical SDK job in split workflow.')
  if (!sdkPartitioned && /contextual-test-owner-sdk-lifecycle|TEST_OWNER_SDK_LIFECYCLE_RESULT/.test(source)) throw new Error('Missing or renamed canonical SDK lifecycle job in partitioned workflow.')
  if (sdkPartitioned && !split) throw new Error('Missing canonical primary SDK job in partitioned workflow.')
  if (!browserSplit && /browser-experience-dark|BROWSER_DARK_RESULT|pnpm e2e:ci --project=/.test(source)) throw new Error('Missing or renamed canonical dark browser job in split workflow.')
  if (!browserPatternSplit && /browser-pattern-lab-dark|BROWSER_PATTERN_DARK_RESULT|--lane browser-pattern-dark/.test(source)) throw new Error('Missing or renamed canonical Pattern Lab dark browser job in family-partitioned workflow.')
  if (browserPatternSplit && !browserSplit) throw new Error('Missing canonical Experience dark browser job in family-partitioned workflow.')
  const jobs = {}
  for (const [lane, id] of Object.entries(jobsByLane)) {
    if (!databaseSplit && lane === 'database-lifecycle') continue
    if (!split && lane === 'test-owner-sdk') continue
    if (!sdkPartitioned && lane === 'test-owner-sdk-lifecycle') continue
    if (!browserSplit && lane === 'browser-dark') continue
    if (!browserPatternSplit && lane === 'browser-pattern-dark') continue
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
    if (databaseSplit && ['database', 'database-lifecycle'].includes(lane)) {
      const header = body.slice(0, stepsIndex)
      const required = ['    needs: classify-changes', "    if: needs.classify-changes.outputs.run_database == 'true'", '    timeout-minutes: 90',
        lane === 'database-lifecycle' ? '    runs-on: ubuntu-latest' : '    runs-on: ${{ fromJSON(needs.classify-changes.outputs.heavy_runner) }}']
      if (required.some(line => header.filter(value => value === line).length !== 1) || header.includes('    env:')) throw new Error(`Canonical ${lane} database job topology changed.`)
    }
    if (isBrowserLane(lane)) {
      const header = body.slice(0, stepsIndex)
      const required = ['    needs: classify-changes', "    if: needs.classify-changes.outputs.run_browser == 'true'", '    timeout-minutes: 90',
        lane === 'browser' ? '    runs-on: ${{ fromJSON(needs.classify-changes.outputs.heavy_runner) }}' : '    runs-on: ubuntu-latest']
      if (required.some(line => header.filter(value => value === line).length !== 1)) throw new Error(`Canonical ${lane} browser job topology changed.`)
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
  validateDatabaseInventory(jobs)
  if (databaseSplit) {
    const gate = source.split('  pr-gate:\n')[1] ?? ''
    for (const line of ['      - architecture-database-contracts-lifecycle',
      '          DATABASE_LIFECYCLE_RESULT: ${{ needs.architecture-database-contracts-lifecycle.result }}',
      '          if [[ "$DATABASE_REQUIRED" == "true" && "$DATABASE_LIFECYCLE_RESULT" != "success" ]]; then']) {
      if (gate.split('\n').filter(value => value === line).length !== 1) throw new Error('Canonical database lifecycle gate closure changed.')
    }
  }
  for (const [profile, name] of ownerProofs) {
    const proofOwner = sdkPartitioned && lifecycleProofs.has(profile) ? jobsByLane['test-owner-sdk-lifecycle']
      : split ? jobsByLane['test-owner-sdk'] : jobsByLane.database
    const script = `scripts/check-contextual-test-owner-${profile}-lifecycle.ts`
    const matches = Object.values(jobs).flatMap(job => job.steps
      .filter(step => step.name === name || step.run?.includes(script)).map(step => ({ job, step })))
    const variable = `test_owner_${profile.replaceAll('-', '_')}`
    const step = matches[0]?.step
    const owner = jobs[proofOwner]
    if (matches.length !== 1 || matches[0].job.id !== proofOwner || step.name !== name || step.if
      || owner.steps.indexOf(step) <= owner.steps.findIndex(value => value.id === 'supabase-start')
      || owner.steps.indexOf(step) >= owner.steps.findIndex(value => value.run === 'supabase stop --no-backup')
      || source.split(script).length !== 3 || step.run?.split(script).length !== 3
      || !step.run?.includes(`${script} --reviewed-head "$${variable}_head" --mode normal`)
      || !step.run.includes(`for ${variable}_mode in after-fixture before-capture; do`)
      || !step.run.includes(`${script} --reviewed-head "$${variable}_head" --mode "$${variable}_mode"`)
      || !step.run.includes(`[[ "$${variable}_status" -eq 1 ]] || exit 1`)
      || !step.run.includes(`[[ "$(wc -l < "$${variable}_log" | tr -d ' ')" -eq 2 ]] || exit 1`)
      || !step.run.includes(`grep -Fx "FAIL forced isolated test-owner-${profile} lifecycle: \${${variable}_mode}."`)
      || !step.run.includes(`grep -Fx 'PASS isolated test-owner-${profile} exact teardown and unchanged canonical baseline.'`)) {
      throw new Error(`Canonical ${sdkPartitioned ? 'partitioned' : split ? 'split' : 'legacy'} SDK proof inventory is incomplete or changed: ${profile}`)
    }
  }
  for (const lane of split ? ['test-owner-sdk', ...(sdkPartitioned ? ['test-owner-sdk-lifecycle'] : [])] : []) {
    const expectedProfiles = sdkPartitioned ? ownerProofs.filter(([profile]) => lifecycleProofs.has(profile) === (lane === 'test-owner-sdk-lifecycle')).length : ownerProofs.length
    if (jobs[jobsByLane[lane]].steps.filter(step => step.run?.includes('--reviewed-head')).length !== expectedProfiles) {
      throw new Error(`Canonical ${lane} SDK proof inventory has unexpected profiles.`)
    }
  }
  // Never accept a partial partition as the historical combined browser lane.
  const browserLanes = ['browser', ...(browserSplit ? ['browser-dark'] : []), ...(browserPatternSplit ? ['browser-pattern-dark'] : [])]
  for (const lane of browserLanes) {
    const commands = jobs[jobsByLane[lane]].steps.filter(step => /\bpnpm e2e:ci\b/.test(step.run ?? ''))
    const expected = !browserSplit ? 'pnpm e2e:ci'
      : lane === 'browser-dark' && !browserPatternSplit ? historicalDarkCommand : browserCommands[lane]
    if (commands.length !== 1 || commands[0].if || commands[0].run !== expected) {
      throw new Error(`Canonical ${lane} browser coverage command is missing or changed.`)
    }
  }
  // Every supported browser generation retains its exact selected-evidence gate.
  const gate = source.split('  pr-gate:\n')[1] ?? ''
  for (const line of ['    name: PR Gate', '    if: >-', '      always() &&',
    "      (github.event_name == 'workflow_dispatch' || github.event.pull_request.draft == false)", '    runs-on: ubuntu-latest']) {
    if (gate.split('\n').filter(value => value === line).length !== 1) throw new Error('Canonical browser PR gate routing changed.')
  }
  for (const lane of browserLanes) {
    const id = jobsByLane[lane]
    const variable = { browser: 'BROWSER_RESULT', 'browser-dark': 'BROWSER_DARK_RESULT', 'browser-pattern-dark': 'BROWSER_PATTERN_DARK_RESULT' }[lane]
    const guard = `          if [[ "$BROWSER_REQUIRED" == "true" && "$${variable}" != "success" ]]; then`
    for (const line of [`      - ${id}`, `          ${variable}: \${{ needs.${id}.result }}`, guard]) {
      if (gate.split('\n').filter(value => value === line).length !== 1) throw new Error(`Canonical ${lane} browser gate closure changed.`)
    }
    const label = { browser: 'Browser Experience Matrix', 'browser-dark': 'Browser Experience Matrix Dark', 'browser-pattern-dark': 'Browser Pattern Lab Dark' }[lane]
    const failureBlock = `${guard}\n            echo "${label} was required but ended: $${variable}"\n            exit 1\n          fi\n`
    if (gate.split(failureBlock).length !== 2) throw new Error(`Canonical ${lane} browser gate failure block changed.`)
  }
  return jobs
}

export function selectPlan(jobs, lane) {
  if (!Object.hasOwn(jobsByLane, lane) && lane !== 'all') throw new Error('Unknown CI lane.')
  validateDatabaseInventory(jobs)
  const databaseSplit = Boolean(jobs[jobsByLane['database-lifecycle']])
  if (lane === 'database-lifecycle' && !databaseSplit) throw new Error('The selected historical workflow has no separate database-lifecycle lane; use --lane database.')
  // Keep database and SDK aliases complete; all local jobs stay serial, with
  // guarded startup/cleanup on the same dedicated disposable daemon.
  const split = Boolean(jobs[jobsByLane['test-owner-sdk']])
  const sdkPartitioned = Boolean(jobs[jobsByLane['test-owner-sdk-lifecycle']])
  const browserSplit = Boolean(jobs[jobsByLane['browser-dark']])
  const browserPatternSplit = Boolean(jobs[jobsByLane['browser-pattern-dark']])
  if (lane === 'test-owner-sdk' && !split) throw new Error('The selected historical workflow has no separate test-owner-sdk lane; use --lane database.')
  if (lane === 'test-owner-sdk-lifecycle' && !sdkPartitioned) throw new Error('The selected historical workflow has no separate test-owner-sdk-lifecycle lane; use --lane test-owner-sdk or database.')
  if (lane === 'browser-dark' && !browserSplit) throw new Error('The selected historical workflow has no separate browser-dark lane; use --lane browser.')
  if (lane === 'browser-pattern-dark' && !browserPatternSplit) throw new Error('The selected historical workflow has no separate browser-pattern-dark lane; use --lane browser-dark or browser.')
  const sdkLanes = split ? ['test-owner-sdk', ...(sdkPartitioned ? ['test-owner-sdk-lifecycle'] : [])] : []
  const lanes = lane === 'all' ? Object.keys(jobsByLane).filter(value => jobs[jobsByLane[value]])
    : lane === 'database' ? ['database', ...(databaseSplit ? ['database-lifecycle'] : []), ...sdkLanes]
      : lane === 'test-owner-sdk' ? sdkLanes
        : lane === 'browser' && browserSplit ? ['browser', 'browser-dark', ...(browserPatternSplit ? ['browser-pattern-dark'] : [])]
          : lane === 'browser-dark' && browserPatternSplit ? ['browser-dark', 'browser-pattern-dark'] : [lane]
  const plan = lanes.map(value => jobs[jobsByLane[value]])
  if (plan.some((job, index) => !job || job.id !== jobsByLane[lanes[index]] || job.lane !== lanes[index]) || new Set(plan.map(job => job.id)).size !== plan.length) throw new Error('Incomplete or duplicate canonical local CI plan.')
  return plan
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
    if (isBrowserLane(job.lane)) {
      // A setup failure must not label the preceding lane's reports as its own.
      // The runner uses a private disposable checkout; remove only browser output.
      for (const directory of ['playwright-report', 'test-results']) rmSync(join(checkout, directory), { recursive: true, force: true })
    }
    for (const [index, step] of job.steps.entries()) {
      if (interrupted() && step.run !== 'supabase stop --no-backup') { if (step.id) outcomes[step.id] = 'skipped'; continue }
      if (!shouldRun(step.if, laneFailed || interrupted(), outcomes)) { if (step.id) outcomes[step.id] = 'skipped'; continue }
      if (step.uses) {
        console.log(`Local setup override: ${step.name}`)
        if (step.uses === 'actions/upload-artifact@v7' && isBrowserLane(job.lane)) {
          // The next serial partition overwrites Playwright's output directories.
          // Retain only the canonical diagnostics; never copy .auth or symlinks.
          const destination = join(temp, `${job.lane}-diagnostics`)
          mkdirSync(destination, { recursive: true, mode: 0o700 })
          for (const directory of ['playwright-report', 'test-results']) {
            const source = join(checkout, directory)
            if (existsSync(source)) cpSync(source, join(destination, directory), {
              recursive: true, filter: path => !lstatSync(path).isSymbolicLink(),
            })
          }
          console.log(`Local browser diagnostics: ${destination}`)
        }
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
