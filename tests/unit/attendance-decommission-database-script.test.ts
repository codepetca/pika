import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const script = resolve(process.cwd(), 'scripts/check-attendance-decommission-database.sh')
const grep = execFileSync('/bin/sh', ['-c', 'command -v grep'], { encoding: 'utf8' }).trim()
let fixtureDirectory: string

beforeEach(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'pika-decommission-script-'))
  // Deliberately no rg or real Docker on PATH. No SQL reaches a database.
  symlinkSync(grep, join(fixtureDirectory, 'grep'))
  writeFileSync(join(fixtureDirectory, 'docker'), `#!/bin/bash
set -eu
case "$1" in
  inspect) printf '%s\\n' "$FIXTURE_PROJECT_LABEL" ;;
  port) printf '%s\\n' "$FIXTURE_DB_BINDING" ;;
  exec) printf '%s\\n' 'fixture-database-exec' ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 })
})

afterEach(() => {
  rmSync(fixtureDirectory, { recursive: true, force: true })
})

function runFixture(project: string, binding: string) {
  return spawnSync('/bin/bash', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: fixtureDirectory,
      BASH_ENV: '',
      FIXTURE_PROJECT_LABEL: project,
      FIXTURE_DB_BINDING: binding,
    },
  })
}

describe('attendance decommission database harness portability', () => {
  it.each(['0.0.0.0:54322', '[::]:54322', '0.0.0.0:54322\n[::]:54322'])(
    'reaches the fixture without rg for the expected local binding %s', (binding) => {
      const result = runFixture('pika', binding)
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain('fixture-database-exec')
      expect(result.stdout).toContain('Rollback-only attendance decommission contracts passed.')
    },
  )

  it.each([
    ['other-project', '0.0.0.0:54322'],
    ['pika', '0.0.0.0:54323'],
    ['pika', ''],
  ])('rejects project %s / binding %s before database execution', (project, binding) => {
    const result = runFixture(project, binding)
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Refusing unexpected database target.')
    expect(result.stdout).not.toContain('fixture-database-exec')
  })
})
