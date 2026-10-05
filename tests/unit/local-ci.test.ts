import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CiProcessGroupError, executeStep, extractWorkflow, importedEnvironment, localEnvironment, parseArguments, runLane, selectPlan, shouldRun } from '../../scripts/run-ci-local.mjs'

const workflow = () => readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')

describe('local canonical CI', () => {
  it.each([
    ['TERM-resistant shell', 'trap "" TERM; printf "READY\\n"; while :; do sleep 1; done'],
    ['descendant outliving shell', `node -e 'process.on("SIGTERM",()=>{}); console.log("READY"); setInterval(()=>{},1000)' & wait`],
  ])('interrupts the whole actual process group: %s', async (_, script) => {
    const directory = mkdtempSync(join(tmpdir(), 'pika-ci-cancel-test-'))
    const path = join(directory, 'step.log')
    let terminate: (() => void) | undefined
    let pid: number | undefined
    const run = executeStep(script, directory,
      localEnvironment(process.env), (child, cancel) => { if (child) pid = child.pid; if (cancel) terminate = cancel }, path,
      { terminationGraceMs: 25 })
    try {
      const deadline = Date.now() + 2_000
      while (!readFileSync(path, 'utf8').includes('READY')) {
        if (Date.now() > deadline) throw new Error('Subprocess did not become ready')
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      expect(terminate).toBeTypeOf('function')
      terminate?.()
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const outcome = await Promise.race([run, new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Interruption did not terminate the subprocess')), 2_000)
        })])
        expect(outcome).not.toBe(0)
        expect(() => process.kill(-pid!, 0)).toThrow()
      } finally { clearTimeout(timeout) }
    } finally {
      if (pid) { try { process.kill(-pid, 'SIGKILL') } catch {} }
      await run.catch(() => {})
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('retains every executable database and browser contract in canonical order', () => {
    const jobs = extractWorkflow(workflow())
    const database = selectPlan(jobs, 'database')[0]
    const browser = selectPlan(jobs, 'browser')[0]
    expect(database.steps.find(step => step.name === 'Check generated database types')?.run).toBe('pnpm run db:types:check')
    const integrated = database.steps.find(step => step.name === 'Verify isolated contextual Assignment integrated SDK effects and private delivery')
    expect(integrated?.run).toContain('for assignment_integrated_mode in after-fixture before-capture; do')
    expect(integrated?.run).toContain('[[ "$(wc -l < "$assignment_integrated_log" | tr -d \' \')" -eq 2 ]] || exit 1')
    expect(database.steps.filter(step => step.run).length).toBeGreaterThan(100)
    expect(browser.steps.find(step => step.name === 'Export local Supabase environment')?.run).toContain('>> "$GITHUB_ENV"')
    expect(browser.steps.find(step => step.name === 'Seed browser fixtures')?.run).toBe('pnpm seed')
    expect(browser.steps.find(step => step.name === 'Run combined browser contracts')?.run).toBe('pnpm e2e:ci')
    expect(browser.steps.at(-1)?.run).toBe('supabase stop --no-backup')
  })

  it('runs all Test & Build checks with the literal build environment', () => {
    const job = selectPlan(extractWorkflow(workflow()), 'test-build')[0]
    expect(job.steps.filter(step => step.run).map(step => step.name)).toEqual(expect.arrayContaining([
      'Check workflow and documentation contracts', 'Check architecture boundaries',
      'Check governed UI imports and native controls', 'Check governed design values',
      'Run tests with coverage', 'Check TypeScript', 'Run linter', 'Build production bundle',
    ]))
    const build = job.steps.find(step => step.name === 'Build production bundle')
    expect(build?.env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://placeholder.supabase.co')
    expect(shouldRun(build?.if, false)).toBe(true)
    expect(selectPlan(extractWorkflow(workflow()), 'all').map(job => job.lane)).toEqual(['test-build', 'database', 'browser'])
  })

  it.each([
    ['unknown action', (text: string) => text.replaceAll('uses: actions/checkout@v7', 'uses: example/run@v1')],
    ['unknown step property', (text: string) => text.replace('      - name: Check generated database types', '      - name: Check generated database types\n        continue-on-error: true')],
    ['unknown condition', (text: string) => text.replace("if: needs.classify-changes.outputs.run_test_build == 'true'", 'if: github.actor == \'someone\'')],
    ['run interpolation', (text: string) => text.replace('run: pnpm run db:types:check', 'run: pnpm run ${{ inputs.command }}')],
    ['environment interpolation', (text: string) => text.replace('SESSION_SECRET: ci-browser-session-secret-with-at-least-32-characters', 'SESSION_SECRET: ${{ secrets.SESSION_SECRET }}')],
    ['folded run block', (text: string) => text.replace('run: pnpm run db:types:check', 'run: >\n          pnpm run db:types:check')],
    ['different Node version', (text: string) => text.replaceAll("node-version: '24'", "node-version: '22'")],
    ['unknown job setting', (text: string) => text.replace('  test-and-build:\n', '  test-and-build:\n    container: unsafe-image\n')],
    ['action behavior override', (text: string) => text.replaceAll("node-version: '24'", "node-version: '24'\n          run-install: true")],
    ['multiline startup drift', (text: string) => text.replace('run: supabase start -x analytics,edge-runtime,functions,imgproxy,inbucket,meta,realtime,studio,vector', 'run: |\n          supabase start -x analytics,edge-runtime,functions,imgproxy,inbucket,meta,realtime,studio,vector\n          echo changed')],
    ['cleanup guard drift', (text: string) => text.replace("if: always() && steps.ci-isolation.outcome == 'success' && steps.supabase-start.outcome != 'skipped'", 'if: always()')],
  ])('fails closed on %s', (_, mutate) => {
    expect(() => extractWorkflow(mutate(workflow()))).toThrow()
  })

  it('supports only known conditions and preserves cleanup after failures', () => {
    expect(shouldRun(undefined, false)).toBe(true)
    expect(shouldRun(undefined, true)).toBe(false)
    expect(shouldRun('always()', true)).toBe(true)
    expect(shouldRun("failure() && needs.classify-changes.outputs.run_test_build == 'true'", true)).toBe(true)
    expect(shouldRun('success()', false)).toBe(true)
    const cleanup = "always() && steps.ci-isolation.outcome == 'success' && steps.supabase-start.outcome != 'skipped'"
    expect(shouldRun(cleanup, true, { 'ci-isolation': 'failure', 'supabase-start': 'skipped' })).toBe(false)
    expect(shouldRun(cleanup, true, { 'ci-isolation': 'success', 'supabase-start': 'failure' })).toBe(true)
    expect(shouldRun(cleanup, true, { 'ci-isolation': 'success' })).toBe(false)
    expect(() => shouldRun('cancelled()', false)).toThrow()
  })

  it('keeps tool paths while removing provider credentials and environment-file controls', () => {
    const env = localEnvironment({ PATH: '/bin', HOME: '/tmp/home', TMPDIR: '/tmp', DOCKER_HOST: 'unix:///tmp/disposable.sock',
      SESSION_SECRET: 'hosted-secret', SUPABASE_SECRET_KEY: 'hosted-key', GH_TOKEN: 'github-token',
      ENV_FILE: '/tmp/hosted.env', NODE_OPTIONS: '--require /tmp/inject.js', ALLOW_DB_WIPE: 'true',
      WORKOS_API_KEY: 'workos', STRIPE_SECRET_KEY: 'stripe', NEXT_PUBLIC_SUPABASE_URL: 'https://hosted.test',
    })
    expect(env).toMatchObject({ PATH: '/bin', HOME: '/tmp/home', TMPDIR: '/tmp', DOCKER_HOST: 'unix:///tmp/disposable.sock', CI: 'true' })
    for (const key of ['SESSION_SECRET', 'SUPABASE_SECRET_KEY', 'GH_TOKEN', 'ENV_FILE', 'NODE_OPTIONS', 'ALLOW_DB_WIPE', 'WORKOS_API_KEY', 'STRIPE_SECRET_KEY', 'NEXT_PUBLIC_SUPABASE_URL']) expect(env).not.toHaveProperty(key)
  })

  it('validates lane, immutable SHA and exact disposable-database acknowledgement', () => {
    expect(parseArguments(['--lane', 'browser', '--ref', 'a'.repeat(40), '--dry-run'])).toMatchObject({ lane: 'browser', ref: 'a'.repeat(40), dryRun: true })
    expect(parseArguments(['--ack=DISPOSABLE_CI_DATABASE']).acknowledged).toBe(true)
    expect(parseArguments(['--ref', 'HEAD']).ref).toBe('HEAD')
    for (const args of [['--lane', 'unknown'], ['--ref', 'main'], ['--ack=YES'], ['--lane'], ['--unexpected']]) expect(() => parseArguments(args)).toThrow()
  })

  it('rejects unknown and multiline environment exports without exposing values', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pika-ci-env-test-'))
    const path = join(directory, 'exports')
    try {
      writeFileSync(path, 'STORE_PATH=/tmp/store\nNEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n')
      expect(importedEnvironment(path)).toEqual({ STORE_PATH: '/tmp/store', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' })
      for (const text of ['NODE_OPTIONS=secret\n', 'SUPABASE_SECRET_KEY<<EOF\nsecret\nEOF\n', 'STORE_PATH=first\nSTORE_PATH=second\n']) {
        writeFileSync(path, text)
        expect(() => importedEnvironment(path)).toThrow('Unsupported local GITHUB_ENV entry.')
      }
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it.each(['refusal', 'partial-start', 'exception', 'interrupted', 'cleanup-failure', 'unconfirmed-group'])(
    'contains database cleanup during %s without executing Docker', async mode => {
      const directory = mkdtempSync(join(tmpdir(), 'pika-ci-run-test-'))
      const calls: string[] = []
      let interrupted = false
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const job = { lane: 'database', env: {}, steps: [
        { name: 'Verify isolated CI runner', id: 'ci-isolation', run: 'node scripts/ci-runner-preflight.mjs --lane database', env: {} },
        { name: 'Start ephemeral Supabase and replay migrations', id: 'supabase-start', run: 'supabase start -x analytics,edge-runtime,functions,imgproxy,inbucket,meta,realtime,studio,vector', env: {} },
        { name: 'A database contract', run: 'do-not-execute-real-contract', env: {} },
        { name: 'Stop ephemeral database', if: "always() && steps.ci-isolation.outcome == 'success' && steps.supabase-start.outcome != 'skipped'", run: 'supabase stop --no-backup', env: {} },
      ] }
      const execute = async (script: string, _cwd: string, _env: unknown, _child: unknown, path: string) => {
        calls.push(script)
        writeFileSync(path, 'fake executor receipt\n', { mode: 0o600 })
        if (mode === 'refusal' && script.startsWith('node ')) return 1
        if (mode === 'exception' && script.startsWith('supabase start ')) throw new Error('fake startup exception')
        if (mode === 'unconfirmed-group' && script === 'do-not-execute-real-contract') throw new CiProcessGroupError()
        if (mode === 'partial-start' && script.startsWith('supabase start ')) return 1
        if (mode === 'interrupted' && script.startsWith('supabase start ')) interrupted = true
        if (mode === 'cleanup-failure' && script.startsWith('supabase stop ')) return 1
        return 0
      }
      try {
        const run = runLane(job, directory, directory, {}, { execute, interrupted: () => interrupted })
        if (mode === 'exception') await expect(run).rejects.toThrow('fake startup exception')
        else if (mode === 'unconfirmed-group') await expect(run).rejects.toThrow('CI process group did not stop')
        else expect(await run).toBe(['refusal', 'partial-start', 'cleanup-failure'].includes(mode))
        if (mode === 'refusal') expect(calls).toEqual(['node scripts/ci-runner-preflight.mjs --lane database'])
        else if (mode === 'unconfirmed-group') expect(calls).not.toContain('supabase stop --no-backup')
        else expect(calls.at(-1)).toBe('supabase stop --no-backup')
        if (['refusal', 'partial-start', 'exception', 'interrupted'].includes(mode)) expect(calls).not.toContain('do-not-execute-real-contract')
      } finally {
        log.mockRestore(); error.mockRestore()
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )
})
