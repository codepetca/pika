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
    for (const path of [
      '.github/workflows/ci.yml',
      '.github/actions/setup/action.yml',
      '.github/CODEOWNERS',
      '.nvmrc',
      'unclassified/tool.bin',
    ]) {
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

  it('requires matching parents, the tested tree, and a clean continuity-only production sync', () => {
    const root = mkdtempSync(join(tmpdir(), 'pika-ci-promotion-'))
    const classifier = resolve('scripts/classify-ci-changes.mjs')
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
    const write = (path: string, content: string) => writeFileSync(join(root, path), content)
    const treeOf = (sha: string) => git('rev-parse', `${sha}^{tree}`)
    const commit = (tree: string, ...parents: string[]) =>
      git('commit-tree', tree, ...parents.flatMap(parent => ['-p', parent]), '-m', 'fixture commit')
    const checkout = (sha: string) => git('checkout', '--detach', '--force', sha)
    const snapshot = (parent: string) => {
      git('add', '.')
      return commit(git('write-tree'), parent)
    }

    try {
      git('init', '-q')
      git('config', 'user.email', 'test@example.test')
      git('config', 'user.name', 'Test')
      mkdirSync(join(root, '.ai'))
      write('.ai/SESSION-LOG.md', 'common log\n')
      write('.ai/JOURNAL-ARCHIVE.md', 'common archive\n')
      write('page.js', 'common app\n')
      write('other-source.js', 'other app\n')
      git('add', '.')
      git('commit', '-qm', 'common ancestor')
      const ancestor = git('rev-parse', 'HEAD')

      write('page.js', 'reviewed main app\n')
      const main = snapshot(ancestor)
      checkout(ancestor)
      write('.ai/SESSION-LOG.md', 'production log\n')
      const base = snapshot(ancestor)
      const syncedTree = git('merge-tree', '--write-tree', main, base)
      const head = commit(syncedTree, main, base)
      const tested = commit(syncedTree, base, head)
      const testedWithOtherTree = commit(treeOf(main), base, head)

      function classify(overrides: { head?: string; base?: string; main?: string; tested?: string; checkout?: string; repo?: string } = {}) {
        checkout(overrides.checkout ?? tested)
        return JSON.parse(execFileSync(process.execPath, [
          classifier,
          '--target', 'production',
          '--head-branch', 'codex/merge-main-into-production-20261124',
          '--head-repository', overrides.repo ?? 'codepetca/pika',
          '--base-repository', 'codepetca/pika',
          '--base', overrides.base ?? base,
          '--head', overrides.head ?? head,
          '--main-sha', overrides.main ?? main,
          '--tested-sha', overrides.tested ?? tested,
        ], { cwd: root, encoding: 'utf8' }))
      }

      expect(classify()).toMatchObject({
        mode: 'production-promotion', runTestBuild: true, runBrowser: false, runDatabase: false,
      })
      for (const [name, overrides] of [
        ['missing tested SHA', { tested: '' }],
        ['unexpected checkout', { checkout: head }],
        ['stale production base', { base: ancestor }],
        ['stale main parent', { main: ancestor }],
        ['different repository', { repo: 'fork/pika' }],
        ['different tested tree', { tested: testedWithOtherTree, checkout: testedWithOtherTree }],
      ] as const) {
        expect(classify(overrides), name).toMatchObject({ mode: 'full', runBrowser: true, runDatabase: true })
      }

      function classifySync(candidateBase: string, candidateTree: string) {
        const candidateHead = commit(candidateTree, main, candidateBase)
        const candidateTestMerge = commit(candidateTree, candidateBase, candidateHead)
        return classify({ base: candidateBase, head: candidateHead, tested: candidateTestMerge, checkout: candidateTestMerge })
      }

      // A hand-edited sync with eligible parents and only continuity changes still needs full CI.
      expect(classifySync(base, treeOf(main)), 'does not preserve the production log').toMatchObject({ mode: 'full' })

      checkout(base)
      const existingBlob = git('rev-parse', 'HEAD:other-source.js')
      git('update-index', '--cacheinfo', `100755,${existingBlob},other-source.js`)
      const baseWithSourceMode = commit(git('write-tree'), base)
      expect(classifySync(baseWithSourceMode, git('merge-tree', '--write-tree', main, baseWithSourceMode)),
        'changes an application entry mode').toMatchObject({ mode: 'full' })

      checkout(base)
      const journalBlob = git('rev-parse', 'HEAD:.ai/JOURNAL-ARCHIVE.md')
      git('update-index', '--cacheinfo', `120000,${journalBlob},.ai/JOURNAL-ARCHIVE.md`)
      const baseWithSymlink = commit(git('write-tree'), base)
      expect(classifySync(baseWithSymlink, git('merge-tree', '--write-tree', main, baseWithSymlink)),
        'makes a continuity file a symlink').toMatchObject({ mode: 'full' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)

  it('retains risky source paths when files are renamed into documentation', () => {
    const root = mkdtempSync(join(tmpdir(), 'pika-ci-renames-'))
    const classifier = resolve('scripts/classify-ci-changes.mjs')
    const sources = ['supabase/migrations/270_current.sql', 'src/app/api/example/route.ts', 'e2e/example.spec.ts']
    const destinations = sources.map((_, index) => `docs/retired-${index}.md`)
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
    try {
      git('init', '-q')
      git('config', 'user.email', 'test@example.test')
      git('config', 'user.name', 'Test')
      sources.forEach((file, index) => {
        mkdirSync(dirname(join(root, file)), { recursive: true })
        writeFileSync(join(root, file), `fixture-${index}\n`)
      })
      mkdirSync(join(root, 'docs'))
      git('add', '.')
      git('commit', '-qm', 'source baseline')
      sources.forEach((file, index) => git('mv', file, destinations[index]))
      git('commit', '-qm', 'move sources into documentation')
      const result = JSON.parse(execFileSync(process.execPath, [classifier, '--base', 'HEAD^', '--head', 'HEAD'],
        { cwd: root, encoding: 'utf8' }))
      expect(result.paths).toEqual(expect.arrayContaining([...sources, ...destinations]))
      expect(result).toMatchObject({ docsOnly: false, runTestBuild: true, runDatabase: true, runBrowser: true })
    } finally { rmSync(root, { recursive: true, force: true }) }
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
