import { describe, expect, it } from 'vitest'
import { classifyChangedPaths } from '../../scripts/classify-ci-changes.mjs'

describe('CI change classifier', () => {
  it('keeps documentation and AI guidance on the fast policy lane', () => {
    const result = classifyChangedPaths([
      'docs/dev-workflow.md',
      '.ai/CURRENT.md',
      '.codex/prompts/commit-and-pr.md',
    ])

    expect(result).toMatchObject({
      mode: 'docs-only',
      docsOnly: true,
      runTestBuild: false,
      runDatabase: false,
      runBrowser: false,
    })
  })

  it('selects browser and test/build checks for rendered application changes', () => {
    for (const path of ['src/components/TeacherRosterTab.tsx', 'src/middleware.ts']) {
      expect(classifyChangedPaths([path])).toMatchObject({
        mode: 'application-browser',
        runTestBuild: true,
        runDatabase: false,
        runBrowser: true,
      })
    }
  })

  it('selects database checks for migrations and server contracts', () => {
    expect(classifyChangedPaths([
      'supabase/migrations/139_example.sql',
      'src/lib/server/classrooms.ts',
    ])).toMatchObject({
      mode: 'application-database',
      runTestBuild: true,
      runDatabase: true,
      runBrowser: false,
    })
  })

  it('selects both integration lanes for API routes that affect browser flows', () => {
    expect(classifyChangedPaths(['src/app/api/auth/login/route.ts'])).toMatchObject({
      mode: 'application-database-browser',
      runTestBuild: true,
      runDatabase: true,
      runBrowser: true,
    })
  })

  it('selects both integration lanes when shared browser seed state changes', () => {
    for (const path of ['scripts/seed.ts', 'scripts/seed-tests.ts', 'scripts/clear-and-seed.ts']) {
      expect(classifyChangedPaths([path])).toMatchObject({
        mode: 'application-database-browser',
        runTestBuild: true,
        runDatabase: true,
        runBrowser: true,
      })
    }
  })

  it('keeps pure library work on Test & Build', () => {
    expect(classifyChangedPaths(['src/lib/timezone.ts'])).toMatchObject({
      mode: 'application-test-build',
      runTestBuild: true,
      runDatabase: false,
      runBrowser: false,
    })
  })

  it('fails closed for CI configuration and unknown paths', () => {
    for (const path of ['.github/workflows/ci.yml', '.nvmrc', 'unclassified/tool.bin']) {
      expect(classifyChangedPaths([path])).toMatchObject({
        mode: 'full',
        runTestBuild: true,
        runDatabase: true,
        runBrowser: true,
      })
    }
  })

  it('runs only merge-result Test & Build for production promotions', () => {
    expect(classifyChangedPaths(['src/app/page.tsx'], {
      targetBranch: 'production',
      headBranch: 'codex/merge-main-into-production-20260828',
    })).toMatchObject({
      mode: 'production-promotion',
      runTestBuild: true,
      runDatabase: false,
      runBrowser: false,
    })
    expect(classifyChangedPaths(['src/app/page.tsx'], {
      targetBranch: 'production',
      headBranch: 'feature/direct-to-production',
    })).toMatchObject({
      mode: 'full',
      runDatabase: true,
      runBrowser: true,
    })
  })

  it('runs the full suite for manual requests and missing change evidence', () => {
    expect(classifyChangedPaths([], { forceFull: true })).toMatchObject({
      mode: 'full',
      runDatabase: true,
      runBrowser: true,
    })
    expect(classifyChangedPaths([])).toMatchObject({
      mode: 'full',
      runDatabase: true,
      runBrowser: true,
    })
    expect(classifyChangedPaths([], { targetBranch: 'production' })).toMatchObject({
      mode: 'full',
      runDatabase: true,
      runBrowser: true,
    })
  })
})
