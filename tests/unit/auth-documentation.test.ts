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
      expect(document).toContain('WORKOS_MAGIC_AUTH_EMAIL_DELIVERY=workos')
      expect(document).not.toContain('Email sending is mocked')
      expect(document).not.toContain('wire a real email provider in `email.ts`')
      expect(document).not.toContain('set `ENABLE_MOCK_EMAIL=false`')
    }
  })

  it('labels every password-backed browser workflow as an explicit fixture', () => {
    const readme = read('README.md')
    const testsGuide = read('docs/core/tests.md')
    const playwrightConfig = read('playwright.config.ts')
    const authSetup = read('e2e/auth.setup.ts')
    const remoteWorkflow = readme.slice(
      readme.indexOf('**Remote password-fixture workflow'),
      readme.indexOf('### Build'),
    )
    const quickStart = testsGuide.slice(
      testsGuide.indexOf('**Quick Start:**'),
      testsGuide.indexOf('**Verification Scripts:**'),
    )

    expect(remoteWorkflow).toContain('PIKA_LEGACY_PASSWORD_AUTH=true')
    expect(remoteWorkflow.replace(/\s+/g, ' ')).toContain(
      'Do not use this fixture workflow against the default WorkOS preview or Production',
    )
    expect(remoteWorkflow).toContain('E2E_PASSWORD=')
    expect(quickStart).toContain('PIKA_LEGACY_PASSWORD_AUTH=true pnpm dev')
    expect(quickStart).not.toMatch(/\n\s*pnpm dev\s*\n/)
    expect(playwrightConfig).toContain('PIKA_LEGACY_PASSWORD_AUTH=true')
    expect(authSetup).toMatch(/getByLabel\(['"]Password['"]\)/)
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
