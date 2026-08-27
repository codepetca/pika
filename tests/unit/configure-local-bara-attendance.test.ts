import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('local Pika and Bara attendance configuration', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('does not modify either environment when Pika WorkOS configuration is incomplete', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pika-attendance-config-'))
    temporaryDirectories.push(directory)
    const pikaEnvPath = join(directory, 'pika.env')
    const baraEnvPath = join(directory, 'bara.env')
    const brevoEnvPath = join(directory, 'brevo.env')
    const pikaContents = 'SESSION_SECRET=session-secret-at-least-32-characters\n'
    const baraContents = 'NEXT_PUBLIC_CONVEX_SITE_URL=https://example.convex.site\n'
    const brevoContents = 'BREVO_API_KEY=placeholder\n'
    writeFileSync(pikaEnvPath, pikaContents)
    writeFileSync(baraEnvPath, baraContents)
    writeFileSync(brevoEnvPath, brevoContents)

    const result = spawnSync(
      'pnpm',
      [
        'exec',
        'tsx',
        'scripts/configure-local-bara-attendance.ts',
        '--pika-env',
        pikaEnvPath,
        '--bara-env',
        baraEnvPath,
        '--brevo-env',
        brevoEnvPath,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    )

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      'Pika requires WORKOS_CLIENT_ID, WORKOS_API_KEY, WORKOS_COOKIE_PASSWORD, and SESSION_SECRET',
    )
    expect(readFileSync(pikaEnvPath, 'utf8')).toBe(pikaContents)
    expect(readFileSync(baraEnvPath, 'utf8')).toBe(baraContents)
  })
})
