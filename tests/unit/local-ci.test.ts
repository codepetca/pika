import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CiProcessGroupError, executeStep, extractWorkflow, importedEnvironment, localEnvironment, parseArguments, runLane, selectPlan, shouldRun } from '../../scripts/run-ci-local.mjs'

const workflow = () => readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')

function combinedBrowserWorkflow(source = workflow()) {
  return source.replace(/^  browser-experience-dark:\n[\s\S]*?(?=^  pr-gate:\n)/m, '')
    .replace(/run: pnpm e2e:ci --project=[^\n]+/, 'run: pnpm e2e:ci')
    .replace('      - browser-experience-dark\n', '')
    .replace('          BROWSER_DARK_RESULT: ${{ needs.browser-experience-dark.result }}\n', '')
    .replace(/          if \[\[ "\$BROWSER_REQUIRED" == "true" && "\$BROWSER_DARK_RESULT" != "success" \]\]; then\n[\s\S]*?          fi\n/, '')
}

// Reconstruct the original three-job layout from the unchanged proof blocks,
// without depending on Git history being available in a shallow CI checkout.
function legacyWorkflow() {
  const source = combinedBrowserWorkflow()
  const shard = source.match(/^  contextual-test-owner-sdk:\n[\s\S]*?(?=^  test-and-build:\n)/m)![0]
  const blocks = new Map([...shard.matchAll(/^      - name: ([^\n]+)\n[\s\S]*?(?=^      - name: |$(?![\s\S]))/gm)]
    .map(match => [match[1], match[0]]))
  const reads = ['Verify isolated contextual Test owner-detail SDK reads', 'Verify isolated contextual Test owner-list SDK reads']
    .map(name => blocks.get(name)!).join('')
  const writes = ['Verify isolated contextual Test owner-draft GET transactions', 'Verify isolated contextual Test owner-draft save transactions',
    'Verify isolated contextual Test owner creation transactions', 'Verify isolated contextual pristine Test draft discard transactions',
    'Verify isolated contextual Test owner publication transactions'].map(name => blocks.get(name)!).join('')
  return source.replace(shard, '')
    .replace('      - name: Verify isolated contextual Test member-list SDK reads\n', reads + '      - name: Verify isolated contextual Test member-list SDK reads\n')
    .replace('      - name: Verify isolated contextual Test owner reorder transactions\n', writes + '      - name: Verify isolated contextual Test owner reorder transactions\n')
    .replace('  test-and-build:\n', blocks.get('Upload sanitized Test proof timings')! + '  test-and-build:\n')
    .replace('      - contextual-test-owner-sdk\n', '')
    .replace('          TEST_OWNER_SDK_RESULT: ${{ needs.contextual-test-owner-sdk.result }}\n', '')
    .replace(/          if \[\[ "\$DATABASE_REQUIRED" == "true" && "\$TEST_OWNER_SDK_RESULT" != "success" \]\]; then\n[\s\S]*?          fi\n/, '')
}

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
    expect(browser.steps.find(step => step.name === 'Run combined browser contracts')?.run).toContain('pnpm e2e:ci --project=chromium-desktop ')
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
    expect(selectPlan(extractWorkflow(workflow()), 'all').map(job => job.lane)).toEqual(['test-build', 'database', 'test-owner-sdk', 'browser', 'browser-dark'])
  })

  it('keeps database selection complete and includes each canonical SDK command once locally', () => {
    const jobs = extractWorkflow(workflow())
    const database = selectPlan(jobs, 'database')
    const all = selectPlan(jobs, 'all')
    const sdk = selectPlan(jobs, 'test-owner-sdk')
    expect(database.map(job => job.lane)).toEqual(['database', 'test-owner-sdk'])
    expect(sdk.map(job => job.id)).toEqual(['contextual-test-owner-sdk'])
    expect(new Set(all.map(job => job.id)).size).toBe(all.length)
    for (const profile of ['detail', 'list', 'draft-get', 'draft-save', 'create', 'pristine-discard', 'publication']) {
      const command = `scripts/check-contextual-test-owner-${profile}-lifecycle.ts`
      const steps = (plan: typeof all) => plan.flatMap(job => job.steps).filter(step => step.run?.includes(command))
      expect(steps(database)).toHaveLength(1)
      expect(steps(all)).toHaveLength(1)
      expect(steps(sdk)[0]).toEqual(steps(database)[0])
    }
    for (const job of database) {
      expect(job.steps.find(step => step.id === 'ci-isolation')?.run).toBe(`node scripts/ci-runner-preflight.mjs --lane ${job.lane}`)
      expect(job.steps.filter(step => step.id === 'supabase-start')).toHaveLength(1)
      expect(job.steps.filter(step => step.run === 'supabase stop --no-backup')).toHaveLength(1)
    }
    expect(sdk[0].steps.find(step => step.name === 'Upload sanitized Test proof timings')?.uses).toBe('actions/upload-artifact@v7')
    expect(sdk[0].steps.find(step => step.name === 'Summarize dependency setup evidence')?.run).not.toContain('${{')
  })

  it.each([
    ['database', ['database']], ['all', ['test-build', 'database', 'browser']],
    ['test-build', ['test-build']], ['browser', ['browser']],
  ])('supports the complete historical workflow for %s without omitting its original proofs', (lane, expected) => {
    const jobs = extractWorkflow(legacyWorkflow())
    expect(selectPlan(jobs, lane).map(job => job.lane)).toEqual(expected)
    expect(jobs['contextual-test-owner-sdk']).toBeUndefined()
    const database = selectPlan(jobs, 'database')[0]
    for (const profile of ['detail', 'list', 'draft-get', 'draft-save', 'create', 'pristine-discard', 'publication']) {
      expect(database.steps.filter(step => step.run?.includes(`scripts/check-contextual-test-owner-${profile}-lifecycle.ts`))).toHaveLength(1)
    }
  })

  it('clearly rejects an explicit SDK lane for a historical workflow', () => {
    expect(() => selectPlan(extractWorkflow(legacyWorkflow()), 'test-owner-sdk')).toThrow('no separate test-owner-sdk lane')
  })

  it('runs both browser partitions serially and selects the explicit dark lane once', () => {
    const jobs = extractWorkflow(workflow())
    expect(selectPlan(jobs, 'browser').map(job => job.lane)).toEqual(['browser', 'browser-dark'])
    expect(selectPlan(jobs, 'browser-dark').map(job => job.id)).toEqual(['browser-experience-dark'])
    const all = selectPlan(jobs, 'all')
    expect(new Set(all.map(job => job.id)).size).toBe(all.length)
  })

  it('keeps the complete combined browser plan on historical refs with or without the SDK split', () => {
    for (const source of [combinedBrowserWorkflow(), legacyWorkflow()]) {
      const jobs = extractWorkflow(source)
      expect(selectPlan(jobs, 'browser').map(job => job.lane)).toEqual(['browser'])
      expect(selectPlan(jobs, 'browser')[0].steps.find(step => step.name === 'Run combined browser contracts')?.run).toBe('pnpm e2e:ci')
      expect(selectPlan(jobs, 'all').filter(job => job.lane.startsWith('browser'))).toHaveLength(1)
      expect(() => selectPlan(jobs, 'browser-dark')).toThrow('no separate browser-dark lane')
    }
  })

  it.each([
    ['missing dark job', (text: string) => text.replace(/^  browser-experience-dark:\n[\s\S]*?(?=^  pr-gate:\n)/m, '')],
    ['renamed dark job', (text: string) => text.replace('  browser-experience-dark:\n', '  renamed-browser-dark:\n')],
    ['missing dark project', (text: string) => text.replace(' --project=chromium-mobile-dark', '')],
    ['duplicate light project in dark', (text: string) => text.replace('--project=chromium-desktop-dark --project=chromium-mobile-dark', '--project=chromium-desktop --project=chromium-mobile-dark')],
    ['dark preflight drift', (text: string) => text.replace('--lane browser-dark', '--lane browser')],
  ])('refuses %s rather than treating a damaged split as historical', (_, mutate) => {
    expect(() => extractWorkflow(mutate(workflow()))).toThrow()
  })

  it.each(['success', 'setup-failure', 'browser-failure'])('retains current synthetic diagnostics without stale previous-lane reports during %s', async mode => {
    const temp = mkdtempSync(join(tmpdir(), 'pika-ci-diagnostics-test-'))
    const checkout = join(temp, 'source')
    mkdirSync(checkout)
    let lane = ''
    const execute = vi.fn(async (script: string, _cwd: string, env: Record<string, string>, _onChild: unknown, log: string) => {
      writeFileSync(log, '')
      if (script.startsWith('node scripts/ci-runner-preflight.mjs')) lane = script.split(' ').at(-1)!
      if (lane === 'browser-dark' && mode === 'setup-failure' && script === 'pnpm install --frozen-lockfile') return 1
      if (script.startsWith('pnpm e2e:ci')) {
        for (const directory of ['playwright-report', 'test-results']) {
          rmSync(join(checkout, directory), { recursive: true, force: true })
          mkdirSync(join(checkout, directory))
          writeFileSync(join(checkout, directory, 'result.txt'), script)
        }
        mkdirSync(join(checkout, '.auth'), { recursive: true })
        writeFileSync(join(checkout, '.auth', 'teacher.json'), 'private fixture auth')
        symlinkSync(join(checkout, '.auth', 'teacher.json'), join(checkout, 'playwright-report', 'auth-link'))
        if (lane === 'browser-dark' && mode === 'browser-failure') return 1
      }
      if (env.GITHUB_ENV) writeFileSync(env.GITHUB_ENV, '')
      return 0
    })
    try {
      const jobs = selectPlan(extractWorkflow(workflow()), 'browser')
      for (const job of jobs) expect(await runLane(job, checkout, temp, {}, { execute })).toBe(job.lane === 'browser-dark' && mode !== 'success')
      for (const job of jobs) {
        const command = job.steps.find(step => step.run?.startsWith('pnpm e2e:ci'))!.run
        for (const directory of ['playwright-report', 'test-results']) {
          const report = join(temp, `${job.lane}-diagnostics`, directory, 'result.txt')
          if (job.lane === 'browser-dark' && mode === 'setup-failure') expect(existsSync(report)).toBe(false)
          else expect(readFileSync(report, 'utf8')).toBe(command)
        }
        expect(existsSync(join(temp, `${job.lane}-diagnostics`, 'playwright-report', 'auth-link'))).toBe(false)
      }
      expect(() => readFileSync(join(temp, 'browser-diagnostics', '.auth', 'teacher.json'))).toThrow()
    } finally { rmSync(temp, { recursive: true, force: true }) }
  })

  it.each([
    ['missing legacy proof', (text: string) => text.replaceAll('scripts/check-contextual-test-owner-publication-lifecycle.ts', 'scripts/omitted-proof.ts')],
    ['legacy forced-mode drift', (text: string) => text.replace('for test_owner_detail_mode in after-fixture before-capture; do', 'for test_owner_detail_mode in after-fixture; do')],
    ['duplicate legacy proof command', (text: string) => text.replace('pnpm exec tsx scripts/check-contextual-test-owner-detail-lifecycle.ts --reviewed-head', 'pnpm exec tsx scripts/check-contextual-test-owner-detail-lifecycle.ts --mode normal\n          pnpm exec tsx scripts/check-contextual-test-owner-detail-lifecycle.ts --reviewed-head')],
    ['legacy SDK gate dependency', (text: string) => text.replace('      - architecture-database-contracts\n', '      - architecture-database-contracts\n      - contextual-test-owner-sdk\n')],
    ['legacy SDK result variable', (text: string) => text.replace('          DATABASE_RESULT:', '          TEST_OWNER_SDK_RESULT: omitted\n          DATABASE_RESULT:')],
    ['incomplete original topology', (text: string) => text.replace('  browser-experience-matrix:\n', '  omitted-browser:\n')],
  ])('refuses %s rather than accepting arbitrary historical partial workflows', (_, mutate) => {
    expect(() => extractWorkflow(mutate(legacyWorkflow()))).toThrow()
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
    ['SDK cleanup guard drift', (text: string) => {
      const start = text.indexOf('  contextual-test-owner-sdk:\n')
      return text.slice(0, start) + text.slice(start).replace("if: always() && steps.ci-isolation.outcome == 'success' && steps.supabase-start.outcome != 'skipped'", 'if: always()')
    }],
    ['missing SDK job', (text: string) => text.replace('  contextual-test-owner-sdk:\n', '  omitted-sdk-job:\n')],
    ['deleted SDK job', (text: string) => text.replace(/^  contextual-test-owner-sdk:\n[\s\S]*?(?=^  test-and-build:\n)/m, '')],
    ['split proof inventory drift', (text: string) => text.replaceAll('scripts/check-contextual-test-owner-detail-lifecycle.ts', 'scripts/omitted-proof.ts')],
    ['SDK preflight drift', (text: string) => text.replace('--lane test-owner-sdk', '--lane database')],
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
    expect(parseArguments(['--lane', 'test-owner-sdk', '--dry-run']).lane).toBe('test-owner-sdk')
    expect(parseArguments(['--lane', 'browser-dark', '--dry-run']).lane).toBe('browser-dark')
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

  it.each(['database', 'test-owner-sdk', 'browser', 'browser-dark'].flatMap(lane =>
    ['refusal', 'partial-start', 'exception', 'interrupted', 'cleanup-failure', 'unconfirmed-group'].map(mode => [lane, mode])))(
    'contains %s cleanup during %s without executing Docker', async (lane, mode) => {
      const directory = mkdtempSync(join(tmpdir(), 'pika-ci-run-test-'))
      const calls: string[] = []
      let interrupted = false
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const job = { lane, env: {}, steps: [
        { name: 'Verify isolated CI runner', id: 'ci-isolation', run: `node scripts/ci-runner-preflight.mjs --lane ${lane}`, env: {} },
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
        if (mode === 'refusal') expect(calls).toEqual([`node scripts/ci-runner-preflight.mjs --lane ${lane}`])
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
