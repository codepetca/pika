#!/usr/bin/env node
// Trusted entrypoint. Candidate files are data only; never execute candidate tooling.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLI_VERSION, RUNTIME_CONFIG, validateInputs, hash, createPlan, parseHistory, parseDryRun, verifyApproval, verifyCi, checkoutSha } from './migration-rollout-policy.mjs'

export async function executeRollout(rawInput, io) {
  const input = validateInputs(rawInput)
  const { files, schemaTree, runtimeConfigHash } = await io.prepare(input)
  await io.ci(input, schemaTree)
  await io.link(input)
  const history = await io.history()
  const plan = createPlan(input, files, history, await io.preview(), schemaTree, runtimeConfigHash)
  await io.report({ status: 'preview', plan })
  if (input.mode === 'preview') return plan
  verifyApproval(input, plan)
  // A second read catches changes during preview/approval validation. External writers
  // still need an operational exclusion window; the CLI cannot lock this whole interval.
  const finalPlan = createPlan(input, files, await io.history(), await io.preview(), schemaTree, runtimeConfigHash)
  verifyApproval(input, finalPlan)
  let failed = false
  try { await io.apply() } catch { failed = true }
  let durableHistory = null
  try { durableHistory = await io.history() } catch { /* report an unknown durable state */ }
  const expected = files.map(f => ({ local: f.version, remote: f.version }))
  const verified = JSON.stringify(durableHistory) === JSON.stringify(expected)
  const result = { status: failed ? 'apply-failed' : verified ? 'applied-verified' : 'verification-failed', plan, durableHistory }
  await io.report(result)
  if (durableHistory === null) {
    throw new Error(failed
      ? 'Application failed; durable state is unknown. Obtain new approval before another attempt.'
      : 'Application command completed; durable state is unknown. Obtain new approval before another attempt.')
  }
  if (failed) throw new Error('Application failed; durable history recorded. Obtain new approval before another attempt.')
  if (!verified) throw new Error('Application state could not be verified; obtain new approval before another attempt.')
  return result
}

function command(binary, args, cwd, env, phase, encoding = 'utf8') {
  // No shell, no inherited stdin, no raw CLI output in public logs (even on error).
  const result = spawnSync(binary, args, { cwd, env, encoding, stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`${phase} failed; private command output withheld.`)
  return result.stdout
}

export function environmentInputs(env) {
  return {
    mode: env.ROLLOUT_MODE ?? 'preview', target: env.ROLLOUT_TARGET,
    boundTarget: env.ROLLOUT_BOUND_TARGET, projectRef: env.SUPABASE_PROJECT_REF,
    sourceSha: env.ROLLOUT_SOURCE_SHA, ciRunId: env.ROLLOUT_CI_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT ?? '1', approvedDigest: env.ROLLOUT_APPROVED_DIGEST ?? '',
    approvedMigrations: env.ROLLOUT_APPROVED_MIGRATIONS ?? '', confirmation: env.ROLLOUT_CONFIRMATION ?? '', impact: env.ROLLOUT_IMPACT_ACK ?? '',
  }
}

export function createRuntime(env) {
  const toolRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const sourceRoot = resolve(env.ROLLOUT_SOURCE_DIR ?? '.')
  const repository = env.GITHUB_REPOSITORY
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw new Error('Invalid repository binding.')
  if (env.GITHUB_ACTIONS === 'true' && (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_WORKFLOW_REF !== `${repository}/.github/workflows/migrations.yml@refs/heads/main`)) throw new Error('Run this manual workflow from main only.')
  if (!env.GH_TOKEN || !env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_DB_PASSWORD) throw new Error('Required environment-scoped credentials are missing.')
  const workdir = mkdtempSync(join(tmpdir(), 'pika-migration-rollout-'))
  // Only pass environment values the CLI needs. In particular, do not pass a
  // caller-provided DB URL, debug configuration, or alternate Supabase profile.
  const cliEnv = {
    PATH: env.PATH, HOME: workdir, CI: 'true', NO_COLOR: '1',
    SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD: env.SUPABASE_DB_PASSWORD,
  }
  const gitEnv = {
    PATH: env.PATH, HOME: workdir, GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${env.GH_TOKEN}`).toString('base64')}`,
  }
  const git = (args, encoding) => command('git', args, sourceRoot, gitEnv, 'Git validation', encoding)
  const cli = (args) => command('supabase', [...args, '--workdir', workdir], workdir, cliEnv, 'Supabase CLI')
  const api = async (path, text = false) => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error('GitHub CI evidence could not be read; response withheld.')
    const body = await response.text()
    if (body.length > 16 * 1024 * 1024) throw new Error('GitHub evidence exceeds the private read limit.')
    try { return text ? body : JSON.parse(body) } catch { throw new Error('Invalid GitHub CI evidence.') }
  }
  const schemaTree = (sha) => git(['rev-parse', `${sha}:supabase`]).trim()
  return {
    cleanup: () => rmSync(workdir, { recursive: true, force: true }),
    async prepare(input) {
      if (command('supabase', ['--version'], workdir, cliEnv, 'CLI version').trim() !== CLI_VERSION) throw new Error('Install the pinned Supabase CLI version before rollout.')
      const remote = git(['remote', 'get-url', 'origin']).trim()
      if (![ `https://github.com/${repository}.git`, `https://github.com/${repository}` ].includes(remote)) throw new Error('Source checkout origin differs from the repository binding.')
      if (git(['rev-parse', 'HEAD']).trim() !== input.sourceSha) throw new Error('Data checkout is not the exact approved source SHA.')
      git(['fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main', '+refs/heads/production:refs/remotes/origin/production'])
      // Schema-first rollout may use merged main before application promotion.
      let merged = false
      for (const branch of ['main', 'production']) {
        try { git(['merge-base', '--is-ancestor', input.sourceSha, `origin/${branch}`]); merged = true; break } catch { /* check the other trusted branch */ }
      }
      if (!merged) throw new Error('Source must already be merged into main or production.')
      mkdirSync(join(workdir, 'supabase', 'migrations'), { recursive: true, mode: 0o700 })
      const entries = git(['ls-tree', input.sourceSha, 'supabase/config.toml']).trim()
      if (!/^100644 blob [a-f0-9]{40}\tsupabase\/config\.toml$/.test(entries)) throw new Error('Source config must be a regular tracked file.')
      writeFileSync(join(workdir, 'supabase', 'config.toml'), RUNTIME_CONFIG, { mode: 0o600 })
      const migrations = git(['ls-tree', `${input.sourceSha}:supabase/migrations`]).trim().split('\n')
      const files = migrations.map(entry => {
        const match = /^100644 blob [a-f0-9]{40}\t((\d+)_[a-zA-Z0-9_-]+\.sql)$/.exec(entry)
        if (!match) throw new Error('Migration inventory must contain only regular numbered SQL files.')
        const content = git(['show', `${input.sourceSha}:supabase/migrations/${match[1]}`], null)
        writeFileSync(join(workdir, 'supabase', 'migrations', match[1]), content, { mode: 0o600 })
        return { version: match[2], name: match[1], hash: hash(content) }
      }).sort((a, b) => BigInt(a.version) < BigInt(b.version) ? -1 : BigInt(a.version) > BigInt(b.version) ? 1 : 0)
      return { files, schemaTree: schemaTree(input.sourceSha), runtimeConfigHash: hash(RUNTIME_CONFIG) }
    },
    async ci(input, expectedTree) {
      const run = await api(`actions/runs/${input.ciRunId}`)
      if (!Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) throw new Error('Invalid CI run attempt.')
      const jobs = []
      for (let page = 1; page <= 10; page++) {
        const response = await api(`actions/runs/${input.ciRunId}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`)
        if (!Array.isArray(response.jobs)) throw new Error('Invalid CI jobs evidence.')
        jobs.push(...response.jobs)
        if (response.jobs.length < 100) break
        if (page === 10) throw new Error('CI jobs evidence exceeded the pagination limit.')
      }
      verifyCi(run, jobs, repository, input.ciRunId)
      for (const name of ['Architecture Database Contracts', 'Test & Build']) {
        const job = jobs.find(j => j.name === name)
        if (!Number.isSafeInteger(job.id)) throw new Error('Invalid CI job identifier.')
        const checkedSha = checkoutSha(await api(`actions/jobs/${job.id}/logs`, true))
        // Fetch the recorded historical commit, never today's moving PR merge ref.
        git(['fetch', '--no-tags', 'origin', checkedSha])
        if (schemaTree(checkedSha) !== expectedTree) throw new Error('CI checked a different Supabase tree; obtain fresh replay/test evidence.')
        const checkedWorkflow = git(['show', `${checkedSha}:.github/workflows/ci.yml`], null)
        if (hash(checkedWorkflow) !== hash(readFileSync(join(toolRoot, '.github/workflows/ci.yml')))) throw new Error('CI workflow differs from trusted tooling; obtain fresh evidence.')
      }
    },
    async link(input) {
      cli(['link', '--project-ref', input.projectRef])
      if (readFileSync(join(workdir, 'supabase', '.temp', 'project-ref'), 'utf8').trim() !== input.projectRef) throw new Error('Linked project binding could not be verified.')
    },
    async history() { return parseHistory(cli(['migration', 'list', '--linked'])) },
    async preview() {
      // db push writes its dry-run plan to stderr in pinned CLI 2.103.0.
      const result = spawnSync('supabase', ['db', 'push', '--linked', '--dry-run', '--workdir', workdir], { cwd: workdir, env: cliEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000, maxBuffer: 16 * 1024 * 1024 })
      if (result.error || result.status !== 0) throw new Error('Supabase preview failed; private output withheld.')
      return parseDryRun(`${result.stdout}\n${result.stderr}`)
    },
    async apply() { cli(['db', 'push', '--linked', '--yes']) },
    async report(result) {
      // Only structured allowlisted identifiers and hashes reach public logs.
      const { plan, status, durableHistory } = result
      const compact = {
        status, target: plan.target, project: plan.project, sourceSha: plan.sourceSha, ciRunId: env.ROLLOUT_CI_RUN_ID,
        digest: plan.digest, runtimeConfigHash: plan.runtimeConfigHash, pending: plan.pending,
        approval: { approved_digest: plan.digest, approved_migrations: plan.pending.map(f => f.version).join(','), confirmation: `APPLY ${plan.target} ${plan.sourceSha}`, impact_ack: 'I reviewed the SQL and acknowledge all destructive or irreversible effects.' },
        sql: plan.pending.map(f => `https://github.com/${repository}/blob/${plan.sourceSha}/supabase/migrations/${f.name}`),
        ...(status === 'applied-verified' ? { appliedVersions: plan.pending.map(f => f.version), verifiedHistoryCount: durableHistory.length } : durableHistory !== undefined ? { durableHistory } : { appliedHistoryCount: plan.history.filter(r => r.remote).length }),
      }
      const safe = JSON.stringify(compact, null, 2)
      console.log(safe)
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Migration rollout: ${result.status}\n\n\`\`\`json\n${safe}\n\`\`\`\n`)
    },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let runtime
  try {
    const input = validateInputs(environmentInputs(process.env))
    runtime = createRuntime(process.env)
    await executeRollout(input, runtime)
  } catch (error) {
    // All adapter failures use fixed safe messages. Never emit stack/raw CLI/API data.
    console.error(error instanceof Error ? error.message : 'Migration rollout failed.')
    process.exitCode = 1
  } finally { runtime?.cleanup() }
}
