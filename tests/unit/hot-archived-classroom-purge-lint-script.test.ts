import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function runWithLintOutput(
  output: string,
  diagnosticOutput = 'Connecting to local database...\nLinting schema: public',
) {
  const commandDirectory = mkdtempSync(join(tmpdir(), 'pika-purge-lint-'))
  temporaryDirectories.push(commandDirectory)

  const pnpmPath = join(commandDirectory, 'pnpm')
  writeFileSync(
    pnpmPath,
    `#!/bin/sh\nprintf '%b\\n' ${JSON.stringify(output)}\nprintf '%b\\n' ${JSON.stringify(diagnosticOutput)} >&2\n`,
  )
  chmodSync(pnpmPath, 0o755)

  return spawnSync(
    process.execPath,
    ['scripts/check-hot-archived-classroom-purge-lint.mjs'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${commandDirectory}:${process.env.PATH ?? ''}`,
      },
    },
  )
}

describe('hot archived classroom purge lint script', () => {
  it('accepts the Supabase CLI clean-text response when no findings remain', () => {
    const result = runWithLintOutput(
      'No schema errors found',
      'Connecting to local database...\nLinting schema: public',
    )

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      'Managed purge PostgreSQL function lint passed',
    )
  })

  it('accepts the Supabase CLI clean-text response with its update notice', () => {
    const result = runWithLintOutput(
      'No schema errors found',
      [
        'Connecting to local database...',
        'Linting schema: public',
        'A new version of Supabase CLI is available: v2.116.0 (currently installed v2.103.0)',
        'We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli',
      ].join('\n'),
    )

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      'Managed purge PostgreSQL function lint passed',
    )
  })

  it('accepts the Supabase CLI clean transcript entirely on stderr', () => {
    const result = runWithLintOutput(
      '',
      [
        'Connecting to local database...',
        'Linting schema: public',
        'No schema errors found',
        'A new version of Supabase CLI is available: v2.116.0 (currently installed v2.103.0)',
        'We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli',
      ].join('\n'),
    )

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      'Managed purge PostgreSQL function lint passed',
    )
  })

  it('still fails closed for an unrecognized non-JSON response', () => {
    const result = runWithLintOutput('unexpected lint output')

    expect(result.status).toBe(2)
    expect(result.stderr).toContain(
      'Supabase database lint did not return valid JSON.',
    )
  })

  it('reports warning findings for managed purge functions', () => {
    const result = runWithLintOutput(JSON.stringify({
      results: [{
        function: 'public.classroom_purge_try_lock',
        issues: [{
          level: 'warning',
          message: 'fixture warning',
          statement: { lineNumber: '7' },
        }],
      }],
    }))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'public.classroom_purge_try_lock line 7: warning: fixture warning',
    )
  })

  it('rejects a clean sentinel mixed with contradictory output', () => {
    const result = runWithLintOutput(
      'No schema errors found\nunexpected lint output',
      'Connecting to local database...\nLinting schema: public',
    )

    expect(result.status).toBe(2)
    expect(result.stderr).toContain(
      'Supabase database lint did not return valid JSON.',
    )
  })

  it('rejects a clean sentinel with unrecognized diagnostic output', () => {
    const result = runWithLintOutput(
      'No schema errors found',
      'Connecting to local database...\nLinting schema: public\nunexpected lint output',
    )

    expect(result.status).toBe(2)
    expect(result.stderr).toContain(
      'Supabase database lint did not return valid JSON.',
    )
  })

  it('rejects valid JSON with unrecognized diagnostic output', () => {
    const result = runWithLintOutput(
      '{"results":[]}',
      'Connecting to local database...\nLinting schema: public\nunexpected lint output',
    )

    expect(result.status).toBe(2)
    expect(result.stderr).toContain(
      'Supabase database lint did not return valid JSON.',
    )
  })

  it('rejects a diagnostic-stream clean sentinel mixed with contradictory output', () => {
    const result = runWithLintOutput(
      '',
      [
        'Connecting to local database...',
        'Linting schema: public',
        'No schema errors found',
        'unexpected lint output',
      ].join('\n'),
    )

    expect(result.status).toBe(2)
    expect(result.stderr).toContain(
      'Supabase database lint did not return valid JSON.',
    )
  })

  it.each([
    '{}',
    '[]',
    '{"results":null}',
    '{"results":[{}]}',
    '{"results":[{"function":"public.unrelated","issues":null}]}',
    '{"results":[{"function":"public.classroom_purge_try_lock","issues":[{}]}]}',
    '{"results":[{"function":"public.classroom_purge_try_lock","issues":[{"level":"warning","message":"fixture","statement":{"lineNumber":"seven"}}]}]}',
  ])('rejects structurally invalid JSON reports: %s', (output) => {
    const result = runWithLintOutput(output)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain(
      'Supabase database lint did not return valid JSON.',
    )
  })
})
