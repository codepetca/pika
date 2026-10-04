import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = resolve('scripts/run-focused-checks.mjs')
const fixtures: string[] = []
const workflowTests = ['tests/unit/workflow.test.ts', 'tests/unit/guidance.test.ts']

afterEach(() => fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pika-focused-checks-'))
  fixtures.push(root)
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    scripts: { 'check:workflow': `vitest run ${workflowTests.join(' ')}` },
  }))
  // Stand in for expensive external checks; exercise the real runner and Git discovery.
  writeFileSync(join(bin, 'pnpm'), `#!${process.execPath}\n
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FOCUSED_CALLS, JSON.stringify(args) + '\\n');
if (process.env.FOCUSED_REAL_VITEST === '1' && args[1] === 'vitest') {
  const result = require('node:child_process').spawnSync(process.execPath,
    [${JSON.stringify(resolve('node_modules/vitest/vitest.mjs'))}, ...args.slice(2)], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
console.log('DETAILED CHECK OUTPUT');
if (process.env.FOCUSED_FAIL === '1') {
  console.error('ACTIONABLE FAILURE DETAIL');
  process.exit(9);
}
console.log(' Tests  12 passed (12)');
`, { mode: 0o755 })
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init', '-q')
  git('add', 'package.json')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'baseline')
  const callsPath = join(root, 'calls.jsonl')
  function run(args: string[] = [], fail = false, realVitest = false) {
    const result = spawnSync(process.execPath, [script, '--base', 'HEAD', ...args], {
      cwd: root,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, FOCUSED_CALLS: callsPath, FOCUSED_FAIL: fail ? '1' : '0', FOCUSED_REAL_VITEST: realVitest ? '1' : '0' },
      encoding: 'utf8',
    })
    let calls: string[][] = []
    try { calls = readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) } catch { /* no checks launched */ }
    const output = result.stdout + result.stderr
    const logDir = output.match(/Full check logs: (.+)/)?.[1]
    if (logDir) fixtures.push(logDir)
    return { ...result, calls, output }
  }
  function write(path: string, content = '// changed\n') {
    mkdirSync(resolve(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return { root, git, run, write }
}

describe('focused local checks', () => {
  it('runs only the canonical workflow tests for a documentation-only diff', () => {
    const f = fixture()
    // Ignore the tool fixture so it does not intentionally trigger full classification.
    f.write('.git/info/exclude', 'bin/\ncalls.jsonl\n')
    f.write('docs/change.md')
    const result = f.run()
    expect(result.status).toBe(0)
    expect(result.calls).toEqual([['exec', 'vitest', 'run', ...workflowTests, '--reporter=dot']])
    expect(result.output).toContain('12 passed')
    expect(result.output).not.toContain('DETAILED CHECK OUTPUT')
    expect(result.output).toContain('Full check logs:')
  })

  it('unions workflow, changed tests, and related sources in one run, preserving path arguments', () => {
    const f = fixture()
    f.write('.git/info/exclude', 'bin/\ncalls.jsonl\n')
    f.write('src/components/A panel.tsx')
    f.write('tests/components/A panel.test.tsx')
    f.write(workflowTests[0])
    f.git('add', 'tests')
    const result = f.run()
    expect(result.status).toBe(0)
    const testCalls = result.calls.filter((args) => args.includes('vitest'))
    expect(testCalls).toHaveLength(1)
    expect(testCalls[0]).toEqual(['exec', 'vitest', 'related', '--run',
      ...workflowTests, 'tests/components/A panel.test.tsx', 'src/components/A panel.tsx', '--reporter=dot'])
    expect(result.calls).toContainEqual(['run', 'check:architecture'])
    expect(result.calls).toContainEqual(['run', 'check:ui-policy'])
    expect(result.calls).toContainEqual(['run', 'check:design-policy'])
    expect(result.calls).toContainEqual(['exec', 'tsc', '--noEmit'])
    expect(result.calls).toContainEqual(['run', 'lint'])
  })

  it.each(['workflow', 'related'])('limits only Vitest workers while preserving %s selection and later commands', mode => {
    const f = fixture()
    f.write('.git/info/exclude', 'bin/\ncalls.jsonl\n')
    f.write(mode === 'workflow' ? 'docs/change.md' : 'src/components/A panel.tsx')
    if (mode === 'related') {
      f.write('tests/components/A panel.test.tsx')
      f.write('scripts/policy.mjs', 'export const policy = 1')
      f.write('tests/unit/policy.test.ts', "import { policy } from '../../scripts/policy.mjs'")
    }
    const defaultResult = f.run()
    const limitedResult = f.run(['--max-workers', '2'])
    expect(defaultResult.status).toBe(0)
    expect(limitedResult.status).toBe(0)
    const limitedCalls = limitedResult.calls.slice(defaultResult.calls.length)
    expect(limitedCalls).toEqual([
      [...defaultResult.calls[0], '--maxWorkers', '2'],
      ...defaultResult.calls.slice(1),
    ])
    expect(defaultResult.calls.flat()).not.toContain('--maxWorkers')
    if (mode === 'related') expect(limitedCalls[0]).toContain('scripts/policy.mjs')
  })

  it.each([
    [], ['0'], ['-1'], ['1.5'], ['2%'], ['1e2'], ['Infinity'], ['NaN'], [''],
    ['9007199254740992'], ['--dry-run'], ['2', '--max-workers', '3'],
  ].map(values => ({ values })))('rejects invalid or ambiguous worker arguments $values before discovering or launching checks', ({ values }) => {
    const result = fixture().run(['--max-workers', ...values])
    expect(result.status).not.toBe(0)
    expect(result.calls).toEqual([])
    expect(result.output).toContain('--max-workers')
    expect(result.output).not.toContain('Focused checks:')
    expect(result.output).not.toContain('Full check logs:')
  })

  it('shows the worker limit only on Vitest in a non-executing dry run', () => {
    const f = fixture()
    f.write('src/lib/changed.ts')
    const result = f.run(['--dry-run', '--max-workers', '2'])
    expect(result.status).toBe(0)
    expect(result.calls).toEqual([])
    const commands = result.output.split('\n').filter(line => line.startsWith('$ '))
    expect(commands[0]).toContain('"--maxWorkers" "2"')
    expect(commands.slice(1).join('\n')).not.toContain('--maxWorkers')
  })

  it('includes a changed standalone test even without a source change or import', () => {
    const f = fixture()
    f.write('tests/unit/standalone.test.ts')
    const result = f.run()
    expect(result.status).toBe(0)
    expect(result.calls[0]).toEqual(['exec', 'vitest', 'run', ...workflowTests,
      'tests/unit/standalone.test.ts', '--reporter=dot'])
  })

  it('runs the real selected cases once in each project, retaining standalone tests', () => {
    const f = fixture()
    f.write('.git/info/exclude', 'bin/\ncalls.jsonl\nnode_modules/\n')
    symlinkSync(resolve('node_modules'), join(f.root, 'node_modules'), 'dir')
    f.write('vitest.config.mjs', `export default { test: { projects: ${JSON.stringify(
      ['first', 'second'].map((name) => ({ test: {
        name, globals: true, environment: 'node', include: ['tests/**/*.test.ts'],
      } })),
    )} } }`)
    for (const file of workflowTests) f.write(file, "it('workflow contract', () => expect(true).toBe(true))")
    f.write('tests/unit/unrelated.test.ts', "it('must stay unselected', () => { throw new Error('unrelated executed') })")
    f.git('add', '.')
    f.git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'test baseline')
    f.write('src/value.ts', 'export const value = 1')
    f.write('tests/unit/value.test.ts', "import { value } from '../../src/value'; it('related', () => expect(value).toBe(1))")
    f.write('tests/unit/standalone.test.ts', "it('standalone', () => expect(true).toBe(true))")
    const result = f.run(['--max-workers', '2'], false, true)
    expect(result.status, result.output).toBe(0)
    // Two workflow files + related + standalone, in both configured projects.
    expect(result.output).toMatch(/Tests\s+8 passed \(8\)/)
    expect(result.calls.filter((args) => args.includes('vitest'))).toHaveLength(1)
  }, 15_000)

  it('selects directly imported script policies and runtimes without running unrelated tests or launchers', () => {
    const f = fixture()
    f.write('.git/info/exclude', 'bin/\ncalls.jsonl\nnode_modules/\n')
    symlinkSync(resolve('node_modules'), join(f.root, 'node_modules'), 'dir')
    f.write('vitest.config.mjs', "export default { test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] } }")
    for (const file of workflowTests) f.write(file, "it('workflow', () => expect(true).toBe(true))")
    f.write('scripts/lib/design-policy.ts', 'export const policy = 1')
    f.write('scripts/migration-rollout-policy.mjs', 'export const policy = 1')
    f.write('scripts/migration-rollout.mjs', 'export const runtime = 1')
    f.write('tests/unit/design.test.ts', "import { policy } from '../../scripts/lib/design-policy'; it('design', () => expect(policy).toBe(2))")
    f.write('tests/unit/migration.test.ts', "import { policy } from '../../scripts/migration-rollout-policy.mjs'; import { runtime } from '../../scripts/migration-rollout.mjs'; it('migration', () => expect(policy + runtime).toBe(4))")
    f.write('tests/unit/unrelated.test.ts', "it('unrelated', () => { throw new Error('unrelated executed') })")
    f.git('add', '.')
    f.git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'baseline consumers')
    f.write('scripts/lib/design-policy.ts', 'export const policy = 2')
    f.write('scripts/migration-rollout-policy.mjs', 'export const policy = 2')
    f.write('scripts/migration-rollout.mjs', 'export const runtime = 2')
    f.write('scripts/run-focused-checks.mjs', "throw new Error('launcher invoked')")
    const result = f.run([], false, true)
    expect(result.status, result.output).toBe(0)
    expect(result.calls[0]).toEqual(['exec', 'vitest', 'related', '--run', ...workflowTests,
      'scripts/lib/design-policy.ts', 'scripts/migration-rollout-policy.mjs', 'scripts/migration-rollout.mjs', '--reporter=dot'])
    expect(result.output).toMatch(/Tests\s+4 passed \(4\)/)
  }, 15_000)

  it('prints failure details and stops instead of running later checks', () => {
    const f = fixture()
    f.write('src/lib/changed.ts')
    const result = f.run([], true)
    expect(result.status).not.toBe(0)
    expect(result.calls).toHaveLength(1)
    expect(result.output).toContain('ACTIONABLE FAILURE DETAIL')
    expect(result.output).toContain('DETAILED CHECK OUTPUT')
  })

  it('keeps dry runs non-executing and shows the selected commands', () => {
    const f = fixture()
    f.write('src/lib/changed.ts')
    const result = f.run(['--dry-run'])
    expect(result.status).toBe(0)
    expect(result.calls).toEqual([])
    expect(result.output).toContain('"related"')
    expect(result.output).not.toContain('Full check logs:')
  })

  it('fails closed if the canonical workflow command changes to an unsupported shape', () => {
    const f = fixture()
    f.write('package.json', JSON.stringify({ scripts: { 'check:workflow': 'vitest run tests/unit/a.test.ts && echo skipped' } }))
    const result = f.run()
    expect(result.status).not.toBe(0)
    expect(result.calls).toEqual([])
  })

  it('fails without launching checks when the requested Git base is invalid', () => {
    const result = fixture().run(['--base', 'missing-base'])
    expect(result.status).not.toBe(0)
    expect(result.calls).toEqual([])
  })
})
