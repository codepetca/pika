import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')
const launcherPath = join(repoRoot, '.codex/skills/pika-local-dev/scripts/start.sh')
const fixturePaths: string[] = []

function makeFixture(options: { apiUrl?: string; supabaseExit?: number } = {}) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'pika-local-dev-'))
  const fakeBin = join(fixtureRoot, 'bin')
  const worktree = join(fixtureRoot, 'worktree')

  fixturePaths.push(fixtureRoot)
  mkdirSync(fakeBin)
  mkdirSync(join(worktree, 'supabase'), { recursive: true })
  writeFileSync(join(worktree, 'package.json'), '{"name":"pika-fixture"}\n')

  const supabaseExit = options.supabaseExit ?? 0
  const apiUrl = options.apiUrl ?? 'http://127.0.0.1:54321'
  writeExecutable(
    join(fakeBin, 'supabase'),
    supabaseExit === 0
      ? `#!/usr/bin/env bash\nprintf '%s\\n' '${JSON.stringify({
          API_URL: apiUrl,
          PUBLISHABLE_KEY: 'fixture-publishable-key',
          SECRET_KEY: 'fixture-secret-key',
        })}'\n`
      : `#!/usr/bin/env bash\nexit ${supabaseExit}\n`,
  )
  writeExecutable(join(fakeBin, 'openssl'), "#!/usr/bin/env bash\nprintf '%064d\\n' 0\n")
  writeExecutable(
    join(fakeBin, 'pnpm'),
    [
      '#!/usr/bin/env bash',
      'printf "command=%s\\n" "$*"',
      'printf "url=%s\\n" "$NEXT_PUBLIC_SUPABASE_URL"',
      'printf "publishable=%s\\n" "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"',
      'printf "secret=%s\\n" "$SUPABASE_SECRET_KEY"',
      'printf "session_length=%s\\n" "${#SESSION_SECRET}"',
      '',
    ].join('\n'),
  )

  return { fakeBin, worktree }
}

function writeExecutable(path: string, content: string) {
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

function runLauncher(fakeBin: string, worktree: string, ...args: string[]) {
  return spawnSync('bash', [launcherPath, ...args, worktree], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
    },
  })
}

afterEach(() => {
  for (const fixturePath of fixturePaths.splice(0)) {
    rmSync(fixturePath, { recursive: true, force: true })
  }
})

describe('Pika local dev skill', () => {
  it('documents automatic local-only secret and Supabase setup', () => {
    const skill = readFileSync(join(repoRoot, '.codex/skills/pika-local-dev/SKILL.md'), 'utf8')

    expect(skill).toContain('generated session secret')
    expect(skill).toContain('running local Supabase stack')
    expect(skill).toContain('never prints, persists, or commits')
  })

  it('injects local credentials and a 64-character session secret into pnpm dev', () => {
    const { fakeBin, worktree } = makeFixture()
    const result = runLauncher(fakeBin, worktree)

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('command=dev')
    expect(result.stdout).toContain('url=http://127.0.0.1:54321')
    expect(result.stdout).toContain('publishable=fixture-publishable-key')
    expect(result.stdout).toContain('secret=fixture-secret-key')
    expect(result.stdout).toContain('session_length=64')
  })

  it('rejects Supabase credentials unless the API URL is loopback', () => {
    const { fakeBin, worktree } = makeFixture({ apiUrl: 'https://project.supabase.co' })
    const result = runLauncher(fakeBin, worktree)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Refusing non-loopback Supabase API URL')
    expect(result.stdout).not.toContain('command=dev')
  })

  it('fails clearly when the local Supabase stack is unavailable', () => {
    const { fakeBin, worktree } = makeFixture({ supabaseExit: 1 })
    const result = runLauncher(fakeBin, worktree)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Local Supabase is not running')
    expect(result.stdout).not.toContain('command=dev')
  })

  it('supports a non-mutating prerequisite check', () => {
    const { fakeBin, worktree } = makeFixture()
    const result = runLauncher(fakeBin, worktree, '--check')

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('Pika local-dev prerequisites are ready.\n')
    expect(result.stdout).not.toContain('command=dev')
  })
})
