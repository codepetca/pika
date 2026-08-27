import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8')
}

describe('authentication documentation', () => {
  it('keeps onboarding and deployment on the WorkOS email-code contract', () => {
    const readme = read('README.md')
    const projectContext = read('docs/core/project-context.md')

    for (const document of [readme, projectContext]) {
      expect(document).toContain('WORKOS_CLIENT_ID')
      expect(document).toContain('WORKOS_API_KEY')
      expect(document).toContain('WORKOS_COOKIE_PASSWORD')
      expect(document).toContain('PIKA_LEGACY_PASSWORD_AUTH')
      expect(document).not.toContain('Email sending is mocked')
      expect(document).not.toContain('wire a real email provider in `email.ts`')
      expect(document).not.toContain('set `ENABLE_MOCK_EMAIL=false`')
    }
  })

  it('keeps the primary test plan on WorkOS routes and labels passwords legacy-only', () => {
    const testsGuide = read('docs/core/tests.md')
    const authRoutes = testsGuide.slice(
      testsGuide.indexOf('### 4.1 Authentication Routes (primary)'),
      testsGuide.indexOf('### 4.2 Student Routes'),
    )

    expect(authRoutes).toContain('/api/auth/workos/magic/start')
    expect(authRoutes).toContain('/api/auth/workos/magic/verify')
    expect(authRoutes).toContain('PIKA_LEGACY_PASSWORD_AUTH=true')
    expect(authRoutes).not.toContain('/api/auth/signup` → stores verification code')
  })
})
