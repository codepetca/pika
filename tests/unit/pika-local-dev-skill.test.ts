import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')
const launcherPath = join(repoRoot, '.codex/skills/pika-local-dev/scripts/start.sh')
const fixturePaths: string[] = []

type FixtureOptions = {
  apiUrl?: string
  keyMode?: 'current' | 'legacy' | 'missing-publishable'
  opensslExit?: number
  opensslOutput?: string
  supabaseExit?: number
  trustedGit?: boolean
}

function makeFixture(options: FixtureOptions = {}) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'pika-local-dev-'))
  const fakeBin = join(fixtureRoot, 'bin')
  const worktree = join(fixtureRoot, 'worktree')
  const pnpmMarker = join(fixtureRoot, 'pnpm-called')
  const supabaseMarker = join(fixtureRoot, 'supabase-called')

  fixturePaths.push(fixtureRoot)
  mkdirSync(fakeBin)
  mkdirSync(join(worktree, 'supabase'), { recursive: true })
  writeFileSync(join(worktree, 'package.json'), '{"name":"pika-fixture"}\n')
  const canonicalWorktree = realpathSync(worktree)

  const status: Record<string, string> = {
    API_URL: options.apiUrl ?? 'http://127.0.0.1:54321',
  }
  if (options.keyMode === 'legacy') {
    status.ANON_KEY = 'fixture-publishable-key'
    status.SERVICE_ROLE_KEY = 'fixture-secret-key'
  } else {
    if (options.keyMode !== 'missing-publishable') {
      status.PUBLISHABLE_KEY = 'fixture-publishable-key'
    }
    status.SECRET_KEY = 'fixture-secret-key'
  }

  writeExecutable(
    join(fakeBin, 'git'),
    [
      '#!/usr/bin/env bash',
      '[[ "$1" == "-C" ]] || exit 2',
      'target="$2"',
      'shift 2',
      'case "$*" in',
      '  "rev-parse --show-toplevel")',
      `    [[ "$target" == '${canonicalWorktree}' ]] && printf '%s\\n' '${canonicalWorktree}' || printf '%s\\n' '${repoRoot}'`,
      '    ;;',
      '  "rev-parse --path-format=absolute --git-common-dir")',
      options.trustedGit === false
        ? `    [[ "$target" == '${canonicalWorktree}' ]] && printf '%s\\n' '/untrusted/git-common' || printf '%s\\n' '/trusted/git-common'`
        : "    printf '%s\\n' '/trusted/git-common'",
      '    ;;',
      '  *) exit 2 ;;',
      'esac',
      '',
    ].join('\n'),
  )
  writeExecutable(join(fakeBin, 'node'), `#!/usr/bin/env bash\nexec '${process.execPath}' "$@"\n`)
  writeExecutable(
    join(fakeBin, 'supabase'),
    options.supabaseExit
      ? `#!/usr/bin/env bash\ntouch '${supabaseMarker}'\nexit ${options.supabaseExit}\n`
      : `#!/usr/bin/env bash\ntouch '${supabaseMarker}'\nprintf '%s\\n' '${JSON.stringify(status)}'\n`,
  )
  writeExecutable(
    join(fakeBin, 'openssl'),
    options.opensslExit
      ? `#!/usr/bin/env bash\nexit ${options.opensslExit}\n`
      : `#!/usr/bin/env bash\nprintf '%s\\n' '${options.opensslOutput ?? '0'.repeat(64)}'\n`,
  )
  writeExecutable(
    join(fakeBin, 'pnpm'),
    [
      '#!/usr/bin/env bash',
      `touch '${pnpmMarker}'`,
      'printf "command=%s\\n" "$*"',
      'printf "url=%s\\n" "$NEXT_PUBLIC_SUPABASE_URL"',
      'printf "publishable=%s\\n" "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"',
      'printf "secret=%s\\n" "$SUPABASE_SECRET_KEY"',
      'printf "session_length=%s\\n" "${#SESSION_SECRET}"',
      '',
    ].join('\n'),
  )
  writeExecutable(join(fakeBin, 'jq'), "#!/usr/bin/env bash\necho 'jq must not be used' >&2\nexit 99\n")

  return { fakeBin, pnpmMarker, supabaseMarker, worktree: canonicalWorktree }
}

function writeExecutable(path: string, content: string) {
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

function runLauncher(fakeBin: string, worktree: string, args: string[] = [], bashArgs: string[] = []) {
  return spawnSync('/bin/bash', [...bashArgs, launcherPath, ...args, worktree], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:/usr/bin:/bin`,
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
    expect(skill).toContain('registered worktree')
    expect(skill).toContain('never prints, persists, or commits')
  })

  it('injects local credentials and a 64-character session secret into pnpm dev without jq', () => {
    const { fakeBin, pnpmMarker, worktree } = makeFixture()
    const result = runLauncher(fakeBin, worktree)

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('command=dev')
    expect(result.stdout).toContain('url=http://127.0.0.1:54321')
    expect(result.stdout).toContain('publishable=fixture-publishable-key')
    expect(result.stdout).toContain('secret=fixture-secret-key')
    expect(result.stdout).toContain('session_length=64')
    expect(existsSync(pnpmMarker)).toBe(true)
  })

  it('accepts legacy anon and service-role keys from Supabase status', () => {
    const { fakeBin, worktree } = makeFixture({ keyMode: 'legacy' })
    const result = runLauncher(fakeBin, worktree)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('publishable=fixture-publishable-key')
    expect(result.stdout).toContain('secret=fixture-secret-key')
  })

  it('reports a missing publishable key without exposing status JSON', () => {
    const { fakeBin, worktree } = makeFixture({ keyMode: 'missing-publishable' })
    const result = runLauncher(fakeBin, worktree)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('did not provide a publishable or anon key')
    expect(`${result.stdout}${result.stderr}`).not.toContain('fixture-secret-key')
  })

  it('rejects Supabase credentials unless the API URL is loopback', () => {
    const { fakeBin, pnpmMarker, worktree } = makeFixture({ apiUrl: 'https://project.supabase.co' })
    const result = runLauncher(fakeBin, worktree)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Refusing non-loopback Supabase API URL')
    expect(existsSync(pnpmMarker)).toBe(false)
  })

  it('rejects an untrusted lookalike before reading Supabase credentials', () => {
    const { fakeBin, pnpmMarker, supabaseMarker, worktree } = makeFixture({ trustedGit: false })
    const result = runLauncher(fakeBin, worktree)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('untrusted Pika worktree')
    expect(existsSync(supabaseMarker)).toBe(false)
    expect(existsSync(pnpmMarker)).toBe(false)
  })

  it('disables shell tracing before reading sensitive values', () => {
    const { fakeBin, worktree } = makeFixture()
    const result = runLauncher(fakeBin, worktree, ['--check'], ['-x'])
    const output = `${result.stdout}${result.stderr}`

    expect(result.status).toBe(0)
    expect(output).not.toContain('fixture-publishable-key')
    expect(output).not.toContain('fixture-secret-key')
  })

  it('fails clearly when the local Supabase stack is unavailable', () => {
    const { fakeBin, pnpmMarker, worktree } = makeFixture({ supabaseExit: 1 })
    const result = runLauncher(fakeBin, worktree)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Local Supabase is not running')
    expect(existsSync(pnpmMarker)).toBe(false)
  })

  it('fails closed when OpenSSL cannot generate a secret', () => {
    const { fakeBin, pnpmMarker, worktree } = makeFixture({ opensslExit: 1 })
    const result = runLauncher(fakeBin, worktree)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unable to generate a local session secret')
    expect(existsSync(pnpmMarker)).toBe(false)
  })

  it('fails closed when OpenSSL returns a malformed secret', () => {
    const { fakeBin, pnpmMarker, worktree } = makeFixture({ opensslOutput: 'too-short' })
    const result = runLauncher(fakeBin, worktree)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('did not meet the required format')
    expect(existsSync(pnpmMarker)).toBe(false)
  })

  it('supports a non-mutating prerequisite check', () => {
    const { fakeBin, pnpmMarker, worktree } = makeFixture()
    const result = runLauncher(fakeBin, worktree, ['--check'])

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('Pika local-dev prerequisites are ready.\n')
    expect(existsSync(pnpmMarker)).toBe(false)
  })
})
