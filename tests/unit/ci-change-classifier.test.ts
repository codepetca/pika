import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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
    for (const path of [
      'scripts/seed.ts',
      'scripts/seed-tests.ts',
      'scripts/clear-and-seed.ts',
      'scripts/seed-planned-course.ts',
      'scripts/seed-planned-course-fixtures.ts',
      'scripts/seed-assignment-review-fixtures.ts',
      'scripts/lib/assignment-history-seed.ts',
    ]) {
      expect(classifyChangedPaths([path])).toMatchObject({
        mode: 'application-database-browser',
        runTestBuild: true,
        runDatabase: true,
        runBrowser: true,
      })
    }
  })

  it('fails closed when an unmatched library path has no explicit safe classification', () => {
    expect(classifyChangedPaths(['src/lib/timezone.ts'])).toMatchObject({
      mode: 'full',
      runTestBuild: true,
      runDatabase: true,
      runBrowser: true,
    })
  })

  it('fails closed for unmatched runtime and deployment scripts', () => {
    for (const path of ['src/lib/supabase.ts', 'scripts/run-deployed-bara-attendance-smoke.ts']) {
      expect(classifyChangedPaths([path])).toMatchObject({
        mode: 'full',
        runTestBuild: true,
        runDatabase: true,
        runBrowser: true,
      })
    }
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
      headSha: 'main-sha',
      mainSha: 'main-sha',
      headRepository: 'codepetca/pika',
      baseRepository: 'codepetca/pika',
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

    for (const options of [
      {
        targetBranch: 'production',
        headBranch: 'codex/merge-main-into-production-spoof',
        headSha: 'extra-commit',
        mainSha: 'main-sha',
        headRepository: 'codepetca/pika',
        baseRepository: 'codepetca/pika',
      },
      {
        targetBranch: 'production',
        headBranch: 'codex/merge-main-into-production-fork',
        headSha: 'main-sha',
        mainSha: 'main-sha',
        headRepository: 'attacker/pika',
        baseRepository: 'codepetca/pika',
      },
    ]) {
      expect(classifyChangedPaths(['.github/workflows/ci.yml'], options)).toMatchObject({
        mode: 'full',
        runDatabase: true,
        runBrowser: true,
      })
    }
  })

  it('includes deleted API, migration, and browser files in CLI change evidence', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'pika-ci-deletions-'))
    const classifier = resolve(process.cwd(), 'scripts/classify-ci-changes.mjs')
    const files = [
      'src/app/api/example/route.ts',
      'supabase/migrations/999_example.sql',
      'e2e/example.spec.ts',
    ]

    try {
      execFileSync('git', ['init', '-q'], { cwd: repoRoot })
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot })
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot })
      for (const file of files) {
        const fullPath = join(repoRoot, file)
        mkdirSync(dirname(fullPath), { recursive: true })
        writeFileSync(fullPath, 'fixture\n')
      }
      writeFileSync(join(repoRoot, 'README.md'), 'before\n')
      execFileSync('git', ['add', '.'], { cwd: repoRoot })
      execFileSync('git', ['commit', '-qm', 'fixtures'], { cwd: repoRoot })
      for (const file of files) rmSync(join(repoRoot, file))
      writeFileSync(join(repoRoot, 'README.md'), 'after\n')
      execFileSync('git', ['add', '-A'], { cwd: repoRoot })
      execFileSync('git', ['commit', '-qm', 'delete fixtures'], { cwd: repoRoot })

      const result = JSON.parse(execFileSync('node', [
        classifier,
        '--base',
        'HEAD^',
        '--head',
        'HEAD',
      ], { cwd: repoRoot, encoding: 'utf8' }))

      expect(result.paths).toEqual(expect.arrayContaining(files))
      expect(result).toMatchObject({ runDatabase: true, runBrowser: true })
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
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
