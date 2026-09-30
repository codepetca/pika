import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createRuntime, executeRollout } from '../../scripts/migration-rollout.mjs'
import { IMPACT_ACK, RUNTIME_CONFIG } from '../../scripts/migration-rollout-policy.mjs'

const sha = 'a'.repeat(40)
const checked = 'b'.repeat(40)
const tree = 'c'.repeat(40)
const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); roots.forEach(root => rmSync(root, { recursive: true, force: true })); roots.length = 0 })

function fixture(options: { unmerged?: boolean, binding?: string, failedApply?: boolean, treeMismatch?: boolean, activeVault?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pika-rollout-test-'))
  roots.push(root)
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const calls = join(root, 'calls.jsonl')
  const applied = join(root, 'applied')
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
  const record = `const fs=require('node:fs'); const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({bin:BIN,args,auth:process.env.GIT_CONFIG_VALUE_0,token:process.env.SUPABASE_ACCESS_TOKEN,password:process.env.SUPABASE_DB_PASSWORD,home:process.env.HOME})+'\\n');`
  writeFileSync(join(bin, 'git'), `#!/usr/bin/env node\nconst BIN='git';${record}
if(args[0]==='remote') console.log('https://github.com/codepetca/pika.git');
else if(args[0]==='fetch') { if(!process.env.GIT_CONFIG_VALUE_0) process.exit(3); }
else if(args[0]==='merge-base') { if(${options.unmerged ? 'true' : 'false'} || args.at(-1)==='origin/production') process.exit(1); }
else if(args[0]==='rev-parse') console.log(args[1]==='HEAD'?${JSON.stringify(sha)}:${JSON.stringify(tree)});
else if(args[0]==='ls-tree') console.log(args.length===3?'100644 blob ${checked}\\tsupabase/config.toml':'100644 blob ${checked}\\t001_first.sql\\n100644 blob ${checked}\\t002_next.sql');
else if(args[0]==='show') { if(args[1].endsWith('ci.yml')) process.stdout.write(${JSON.stringify(ci)}); else if(args[1].endsWith('config.toml')) process.stdout.write(${JSON.stringify(options.activeVault ? '[db.vault]\nsecret_key = "candidate vault secret"\n[db.seed]\nenabled = true\n' : 'safe source config')}); else process.stdout.write('safe source bytes'); }
`, { mode: 0o755 })
  writeFileSync(join(bin, 'supabase'), `#!/usr/bin/env node\nconst BIN='supabase';${record}
const wd=args.includes('--workdir')?args[args.indexOf('--workdir')+1]:process.cwd();
if(args[0]==='--version') console.log('2.103.0');
else if(args[0]==='link') {fs.mkdirSync(wd+'/supabase/.temp',{recursive:true});fs.writeFileSync(wd+'/supabase/.temp/project-ref',${JSON.stringify(options.binding ?? 'abcdefghijklmnopqrst')});console.error('PRIVATE CLI TOKEN AND SQL DATA');}
else if(args[0]==='migration') console.log(' Local | Remote | Time (UTC)\\n-------|--------|-----------\\n 001 | 001 | 001\\n 002 | '+(fs.existsSync(${JSON.stringify(applied)})?'002':'')+' | 002');
else if(args.includes('--dry-run')) console.error('DRY RUN: migrations will *not* be pushed to the database.\\nWould push these migrations:\\n • 002_next.sql\\nFinished supabase db push.');
else {fs.writeFileSync(${JSON.stringify(applied)},'yes'); console.error('PRIVATE FAILURE SQL DATA');${options.failedApply ? 'process.exit(1)' : ''}}
`, { mode: 0o755 })
  const env = { PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`, GH_TOKEN: 'private-git-token', SUPABASE_ACCESS_TOKEN: 'private-cli-token', SUPABASE_DB_PASSWORD: 'private-db-password', GITHUB_REPOSITORY: 'codepetca/pika', ROLLOUT_SOURCE_DIR: root, ROLLOUT_CI_RUN_ID: '123', GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: 'codepetca/pika/.github/workflows/migrations.yml@refs/heads/main' }
  const jobs = [
    { id: 1, name: 'Architecture Database Contracts', conclusion: 'success', steps: [{ name: 'Start ephemeral Supabase and replay migrations', conclusion: 'success' }, { name: 'Check generated database types', conclusion: 'success' }] },
    { id: 2, name: 'Test & Build', conclusion: 'success', steps: [{ name: 'Run tests with coverage', conclusion: 'success' }, { name: 'Build production bundle', conclusion: 'success' }] },
    { id: 3, name: 'PR Gate', conclusion: 'success', steps: [] },
  ]
  vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
    const path = String(url)
    const data = path.endsWith('/logs') ? `2026-09-30T16:38:45.1236242Z [command]/usr/bin/git log -1 --format=%H\n2026-09-30T16:38:45.1261933Z ${checked}\n` : path.includes('/jobs?') ? { jobs } : { id: 123, name: 'CI', path: '.github/workflows/ci.yml', repository: { full_name: 'codepetca/pika' }, head_repository: { full_name: 'codepetca/pika' }, event: 'pull_request', status: 'completed', conclusion: 'success', run_attempt: 1 }
    return new Response(typeof data === 'string' ? data : JSON.stringify(data), { status: 200 })
  })
  if (options.treeMismatch) {
    const script = readFileSync(join(bin, 'git'), 'utf8').replace(`:${JSON.stringify(tree)}`, `:(args[1].startsWith('${checked}')?'${'d'.repeat(40)}':'${tree}')`)
    writeFileSync(join(bin, 'git'), script, { mode: 0o755 })
  }
  const input = { mode: 'preview', target: 'production', boundTarget: 'production', projectRef: 'abcdefghijklmnopqrst', sourceSha: sha, ciRunId: '123', runAttempt: '1', approvedDigest: '', approvedMigrations: '', confirmation: '', impact: '' }
  const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
  const runtime = createRuntime(env)
  return { runtime, input, root, calls: () => readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)), logs }
}

describe('portable CLI adapter using offline executables and fake GitHub API', { timeout: 20_000 }, () => {
  it('allows merged main SQL for production, isolates workspace, and scopes private fetch credentials', async () => {
    const f = fixture()
    try {
      await executeRollout(f.input, f.runtime)
      const calls = f.calls()
      const cliCalls = calls.filter(c => c.bin === 'supabase')
      expect(calls.filter(c => c.bin === 'git' && c.args[0] === 'fetch').every(c => c.auth?.startsWith('AUTHORIZATION: basic '))).toBe(true)
      expect(calls.filter(c => c.bin === 'git').every(c => !c.token && !c.password)).toBe(true)
      expect(cliCalls.every(c => !c.auth && c.token === 'private-cli-token')).toBe(true)
      expect(cliCalls.some(c => c.args.includes('--linked') && c.args.includes('--dry-run'))).toBe(true)
      expect(cliCalls.every(c => !c.args.some((arg: string) => ['--db-url', '--include-all', '--include-seed', '--include-roles', '--local', '--password'].includes(arg)))).toBe(true)
      expect(cliCalls[0].home).not.toBe(f.root)
      expect(existsSync(join(cliCalls[0].home, 'supabase/migrations/001_first.sql'))).toBe(true)
      expect(f.logs.mock.calls.flat().join(' ')).not.toMatch(/PRIVATE|private-git-token|private-cli-token|private-db-password/)
      expect(f.logs.mock.calls.flat().join(' ')).toContain('approved_digest')
    } finally { f.runtime.cleanup() }
    expect(existsSync(f.calls().find(c => c.bin === 'supabase').home)).toBe(false)
  })
  it('uses a trusted migration-only config even when the candidate contains active Vault settings', async () => {
    const f = fixture({ activeVault: true })
    try {
      const plan = await executeRollout(f.input, f.runtime)
      const workdir = f.calls().find(c => c.bin === 'supabase').home
      const config = readFileSync(join(workdir, 'supabase/config.toml'), 'utf8')
      expect(config).toBe(RUNTIME_CONFIG)
      expect(config).toContain('major_version = 17')
      expect(config).toContain('[db.seed]\nenabled = false')
      expect(config).not.toMatch(/vault|candidate vault secret/)
      expect(existsSync(join(workdir, 'supabase/roles.sql'))).toBe(false)
      expect(existsSync(join(workdir, 'supabase/seed.sql'))).toBe(false)
      expect(f.calls().some(c => c.bin === 'git' && c.args[0] === 'show' && c.args[1].endsWith('config.toml'))).toBe(false)
      expect(plan.runtimeConfigHash).toMatch(/^[a-f0-9]{64}$/)
    } finally { f.runtime.cleanup() }
  })
  it.each([{ unmerged: true }, { binding: 'z'.repeat(20) }, { treeMismatch: true }])('refuses untrusted source, incorrect linked binding, and wrong CI schema tree: %s', async options => {
    const f = fixture(options)
    try {
      await expect(executeRollout(f.input, f.runtime)).rejects.toThrow()
      expect(f.calls().some(c => c.bin === 'supabase' && c.args.includes('--yes'))).toBe(false)
    } finally { f.runtime.cleanup() }
  })
  it('pushes exactly once with restricted confirmation and verifies history without exposing private failures', async () => {
    const f = fixture({ failedApply: true })
    try {
      const preview = await executeRollout(f.input, f.runtime)
      await expect(executeRollout({ ...f.input, mode: 'apply', approvedDigest: preview.digest, approvedMigrations: '002_next.sql', confirmation: `APPLY production ${sha}`, impact: IMPACT_ACK }, f.runtime)).rejects.toThrow('Application failed; durable history recorded.')
      const pushes = f.calls().filter(c => c.bin === 'supabase' && c.args.includes('--yes'))
      expect(pushes).toHaveLength(1)
      expect(pushes[0].args.slice(0, 4)).toEqual(['db', 'push', '--linked', '--yes'])
      expect(f.logs.mock.calls.flat().join(' ')).toContain('apply-failed')
      expect(f.logs.mock.calls.flat().join(' ')).not.toMatch(/PRIVATE|private-db-password/)
    } finally { f.runtime.cleanup() }
  })
  it('rejects branch workflow execution before preparing a CLI workspace', () => {
    expect(() => createRuntime({ GITHUB_REPOSITORY: 'codepetca/pika', GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/evil' })).toThrow('main only')
  })
})
