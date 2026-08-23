import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../..')

describe('attendance entitlement operator command', () => {
  it('launches through the documented package script before validating input', () => {
    const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm'
    const commandArguments = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'pnpm attendance:entitlement:set -- --operation-id invalid']
      : ['attendance:entitlement:set', '--', '--operation-id', 'invalid']
    const result = spawnSync(
      command,
      commandArguments,
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        },
        timeout: 15_000,
      },
    )

    const output = `${result.stdout}\n${result.stderr}`

    expect(result.error).toBeUndefined()
    expect(result.status).not.toBe(0)
    expect(output).toContain('ZodError')
    expect(output).not.toContain('Top-level await is currently not supported')
  })
})
