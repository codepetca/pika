import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))

function readRepoFile(relativePath: string) {
  return readFileSync(resolve(testDir, '../..', relativePath), 'utf8')
}

function makeFixtureWorktree() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'pika-session-start-'))

  mkdirSync(join(repoRoot, '.ai'), { recursive: true })
  mkdirSync(join(repoRoot, 'docs'), { recursive: true })
  mkdirSync(join(repoRoot, 'scripts'), { recursive: true })

  writeFileSync(join(repoRoot, '.ai/START-HERE.md'), '# Fixture Start Here\nSTART HERE MARKER\n')
  writeFileSync(join(repoRoot, '.ai/CURRENT.md'), '# Fixture Current\nCURRENT MARKER\n')
  writeFileSync(
    join(repoRoot, '.ai/features.json'),
    '{\n  "marker": "FEATURES MARKER",\n  "features": []\n}\n',
  )
  writeFileSync(join(repoRoot, 'docs/ai-instructions.md'), '# Fixture AI Instructions\nAI INSTRUCTIONS MARKER\n')
  writeFileSync(join(repoRoot, 'scripts/verify-env.sh'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 })
  writeFileSync(
    join(repoRoot, 'scripts/features.mjs'),
    [
      '#!/usr/bin/env node',
      "if (process.argv[2] === 'summary') console.log('FEATURE SUMMARY MARKER')",
      "if (process.argv[2] === 'next') console.log('FEATURE NEXT MARKER')",
      '',
    ].join('\n'),
    { mode: 0o755 },
  )
  writeFileSync(join(repoRoot, 'README.md'), 'fixture\n')

  execFileSync('git', ['init'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.name', 'Codex Test'], { cwd: repoRoot })
  execFileSync('git', ['config', 'user.email', 'codex@example.com'], { cwd: repoRoot })
  execFileSync('git', ['checkout', '-b', 'fixture/session-start'], { cwd: repoRoot })
  execFileSync('git', ['add', '.'], { cwd: repoRoot })
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repoRoot })

  return repoRoot
}

function commitAll(repoRoot: string, message: string) {
  execFileSync('git', ['add', '.'], { cwd: repoRoot })
  execFileSync('git', ['commit', '-m', message], { cwd: repoRoot })
}

function makeVerifyEnvFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'pika-verify-env-'))

  mkdirSync(join(repoRoot, '.ai'), { recursive: true })
  mkdirSync(join(repoRoot, 'node_modules'), { recursive: true })

  writeFileSync(
    join(repoRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'verify-env-fixture',
        private: true,
        packageManager: 'npm@10.0.0',
      },
      null,
      2,
    ),
  )
  writeFileSync(join(repoRoot, '.ai/features.json'), '{\n  "features": []\n}\n')

  return repoRoot
}

const requiredStartupFiles = [
  '.ai/START-HERE.md',
  '.ai/CURRENT.md',
  '.ai/features.json',
  'docs/ai-instructions.md',
]
const requiredStartupGuidanceFiles = [...requiredStartupFiles, 'docs/dev-workflow.md']
const requiredWorkflowRecoveryFiles = [
  '.ai/START-HERE.md',
  '.ai/CURRENT.md',
  'docs/ai-instructions.md',
  'docs/dev-workflow.md',
]

describe('AI startup docs', () => {
  it('keeps the default startup set under the budget', () => {
    const totalChars = requiredStartupFiles.reduce((sum, file) => sum + readRepoFile(file).length, 0)

    expect(totalChars).toBeLessThanOrEqual(16_000)
  })

  it('keeps journal reads out of the default startup flow', () => {
    const files = [
      '.ai/START-HERE.md',
      '.claude/commands/session-start.md',
      '.codex/prompts/session-start.md',
      '.codex/skills/pika-session-start/scripts/session_start.sh',
      'docs/issue-worker.md',
    ]

    for (const file of files) {
      const content = readRepoFile(file)
      expect(content).not.toMatch(/tail -\d+ ".*\.ai\/JOURNAL/)
      expect(content).not.toContain('Append to `.ai/JOURNAL.md`')
    }
  })

  it('keeps the rolling session log bounded while preserving weekly evidence', () => {
    const startHere = readRepoFile('.ai/START-HERE.md')
    const sessionLog = readRepoFile('.ai/SESSION-LOG.md')
    const entryCount = sessionLog.match(/^## /gm)?.length ?? 0

    expect(sessionLog).toContain('Rolling recent session log')
    expect(sessionLog).toContain('CI allows at most 60 entries')
    expect(sessionLog).toContain('compacts to the latest 40 entries')
    expect(sessionLog).toContain('immediately run `node scripts/trim-session-log.mjs`')
    expect(sessionLog).toContain('valid ISO date (`## YYYY-MM-DD ...`)')
    expect(sessionLog).toContain('node scripts/trim-session-log.mjs --check')
    expect(startHere).toContain('valid ISO-date heading (`## YYYY-MM-DD ...`)')
    expect(startHere).toContain('verify heading dates, chronological order, and the cap')
    expect(entryCount).toBeGreaterThan(0)
    if (entryCount > 60) {
      throw new Error(
        `.ai/SESSION-LOG.md has ${entryCount} entries; run node scripts/trim-session-log.mjs after appending session-log entries to compact it below the cap.`,
      )
    }
    expect(readRepoFile('.ai/JOURNAL-ARCHIVE.md')).toContain('# Pika Project Journal')
  })

  it('keeps startup prompts aligned with the canonical guidance set', () => {
    const prompts = ['.claude/commands/session-start.md', '.codex/prompts/session-start.md']

    for (const promptPath of prompts) {
      const prompt = readRepoFile(promptPath)

      for (const file of requiredStartupGuidanceFiles) {
        expect(prompt).toContain(file)
      }
      expect(prompt).toContain('--orient-only')
    }
  })

  it('keeps workflow reset prompts aligned with the canonical recovery set', () => {
    const prompts = ['.claude/commands/follow-workflow.md', '.codex/prompts/follow-workflow.md']

    for (const promptPath of prompts) {
      const prompt = readRepoFile(promptPath)

      for (const file of requiredWorkflowRecoveryFiles) {
        expect(prompt).toContain(file)
      }
      expect(prompt).toContain('git rev-parse --show-toplevel')
      expect(prompt).toContain('detached HEAD')
    }
  })

  it('keeps issue prompts on the canonical worktree workflow', () => {
    const prompts = ['.claude/commands/work-on-issue.md', '.codex/prompts/work-on-issue.md']

    for (const promptPath of prompts) {
      const prompt = readRepoFile(promptPath)

      expect(prompt).toContain('docs/workflow/handle-issue.md')
      expect(prompt).toContain('docs/dev-workflow.md')
      expect(prompt).not.toContain('$HOME/.codex/worktrees/pika/issue-')
      expect(prompt).not.toContain('git -C "$HUB" worktree add')
    }
  })

  it('documents both named and app-managed Codex worktree locations', () => {
    const workflow = readRepoFile('docs/dev-workflow.md')
    const current = readRepoFile('.ai/CURRENT.md')

    for (const content of [workflow, current]) {
      expect(content).toContain('$HOME/.codex/worktrees/pika/')
      expect(content).toContain('$HOME/.codex/worktrees/<id>/pika')
    }
    expect(workflow).toContain('git rev-parse --show-toplevel')
  })

  it('documents both maintainer shared-env and collaborator-local env setups', () => {
    const sharedEnvFiles = [
      '.ai/START-HERE.md',
      '.ai/CURRENT.md',
      'AGENTS.md',
      'docs/dev-workflow.md',
      '.codex/prompts/session-start.md',
      '.claude/commands/session-start.md',
      'docs/core/project-context.md',
    ]
    const collaboratorFiles = [
      '.ai/START-HERE.md',
      '.ai/CURRENT.md',
      'AGENTS.md',
      'docs/dev-workflow.md',
      '.codex/prompts/session-start.md',
      '.claude/commands/session-start.md',
      'docs/core/project-context.md',
    ]

    for (const file of sharedEnvFiles) {
      expect(readRepoFile(file)).toContain('$HOME/Repos/.env/pika/.env.local')
    }

    for (const file of collaboratorFiles) {
      const content = readRepoFile(file)
      expect(content).toMatch(/\.env\.example|collaborator/i)
    }
  })

  it('documents detached HEAD handling in workflow prompts', () => {
    const files = [
      '.claude/commands/session-start.md',
      '.claude/commands/follow-workflow.md',
      '.claude/commands/commit-and-pr.md',
      '.codex/prompts/follow-workflow.md',
      '.codex/prompts/commit-and-pr.md',
    ]

    for (const file of files) {
      expect(readRepoFile(file)).toContain('detached HEAD')
    }
  })

  it('documents orient-only startup for read-only work', () => {
    const files = ['.ai/START-HERE.md', '.claude/commands/session-start.md', '.codex/prompts/session-start.md']

    for (const file of files) {
      expect(readRepoFile(file)).toContain('--orient-only')
    }
  })

  it('documents cleanup by resolving the registered worktree path', () => {
    const files = ['.ai/START-HERE.md', 'docs/dev-workflow.md']

    for (const file of files) {
      const content = readRepoFile(file)

      expect(content).toContain('worktree list --porcelain')
      expect(content).toContain('awk -v branch="$BRANCH"')
      expect(content).not.toContain('worktree remove "$HOME/.codex/worktrees/pika/<branch-name>"')
      expect(content).not.toContain('worktree remove "$WT_ROOT/<branch-name>"')
    }
  })

  it('keeps production merge prompts on the production-worktree helper flow', () => {
    const files = [
      '.claude/commands/merge-main-into-production.md',
      '.codex/prompts/merge-main-into-production.md',
    ]

    for (const file of files) {
      const content = readRepoFile(file)

      expect(content).toContain('merge_main_into_production.sh')
      expect(content).not.toContain('hub-level operation')
      expect(content).not.toContain('git -C "$HOME/Repos/pika" switch main')
      expect(content).not.toContain('git -C "$HOME/Repos/pika" switch production')
    }
  })

  it('renders the required startup docs in order from the current git root', () => {
    const repoRoot = makeFixtureWorktree()
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-session-start/scripts/session_start.sh')

    try {
      const output = execFileSync('bash', [scriptPath], {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: repoRoot,
        },
        encoding: 'utf8',
      })

      const startHereIndex = output.indexOf('START HERE MARKER')
      const currentIndex = output.indexOf('CURRENT MARKER')
      const featuresIndex = output.indexOf('FEATURES MARKER')
      const instructionsIndex = output.indexOf('AI INSTRUCTIONS MARKER')

      expect(startHereIndex).toBeGreaterThanOrEqual(0)
      expect(currentIndex).toBeGreaterThan(startHereIndex)
      expect(featuresIndex).toBeGreaterThan(currentIndex)
      expect(instructionsIndex).toBeGreaterThan(featuresIndex)

      expect(output).toContain('FEATURE SUMMARY MARKER')
      expect(output).toContain('FEATURE NEXT MARKER')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('creates a missing worktree env symlink before verification', () => {
    const repoRoot = makeFixtureWorktree()
    const canonicalEnv = join(repoRoot, 'Repos/.env/pika/.env.local')
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-session-start/scripts/session_start.sh')

    mkdirSync(dirname(canonicalEnv), { recursive: true })
    writeFileSync(canonicalEnv, 'SESSION_SECRET=fixture-secret-with-at-least-32-characters\n')

    try {
      const output = execFileSync('bash', [scriptPath], {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: repoRoot,
        },
        encoding: 'utf8',
      })

      expect(output).toContain('Created .env.local')
      expect(readlinkSync(join(repoRoot, '.env.local'))).toBe(canonicalEnv)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('keeps orient-only session-start non-mutating', () => {
    const repoRoot = makeFixtureWorktree()
    const canonicalEnv = join(repoRoot, 'Repos/.env/pika/.env.local')
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-session-start/scripts/session_start.sh')

    mkdirSync(dirname(canonicalEnv), { recursive: true })
    writeFileSync(canonicalEnv, 'SESSION_SECRET=fixture-secret-with-at-least-32-characters\n')
    writeFileSync(
      join(repoRoot, 'scripts/verify-env.sh'),
      '#!/usr/bin/env bash\ntouch verify-env-ran\nexit 1\n',
      { mode: 0o755 },
    )

    try {
      const output = execFileSync('bash', [scriptPath, '--orient-only'], {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: repoRoot,
        },
        encoding: 'utf8',
      })

      expect(output).toContain('Orient-only mode: skipping .env.local repair and verify-env.sh.')
      expect(output).toContain('Context loaded for read-only work.')
      expect(existsSync(join(repoRoot, '.env.local'))).toBe(false)
      expect(existsSync(join(repoRoot, 'verify-env-ran'))).toBe(false)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('reports detached HEAD state during automated session-start', () => {
    const repoRoot = makeFixtureWorktree()
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-session-start/scripts/session_start.sh')

    execFileSync('git', ['checkout', '--detach'], { cwd: repoRoot })

    try {
      const output = execFileSync('bash', [scriptPath], {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: repoRoot,
        },
        encoding: 'utf8',
      })

      expect(output).toContain('Checkout: detached HEAD at')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('rejects the hub checkout for automated session-start', () => {
    const homeRoot = mkdtempSync(join(tmpdir(), 'pika-session-hub-'))
    const hubRoot = join(homeRoot, 'Repos/pika')
    mkdirSync(hubRoot, { recursive: true })

    execFileSync('git', ['init'], { cwd: hubRoot })
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-session-start/scripts/session_start.sh')

    try {
      const result = spawnSync('bash', [scriptPath], {
        cwd: hubRoot,
        env: {
          ...process.env,
          HOME: homeRoot,
        },
        encoding: 'utf8',
      })

      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toContain('Current repo is the hub')
    } finally {
      rmSync(homeRoot, { recursive: true, force: true })
    }
  })

  it('keeps verify-env fast by default', () => {
    const repoRoot = makeVerifyEnvFixture()
    const scriptPath = resolve(testDir, '../../scripts/verify-env.sh')

    try {
      const output = execFileSync('bash', [scriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(output).toContain('✅ Dependencies installed')
      expect(output).not.toContain('Running tests...')
      expect(output).toContain('Environment verified. Ready for development.')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('makes the audit script fail outside a git checkout', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'pika-audit-nongit-'))
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-audit/scripts/audit.sh')

    try {
      const result = spawnSync('bash', [scriptPath], {
        cwd: tempRoot,
        encoding: 'utf8',
      })

      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'Pika Audit must be run from inside a git checkout.',
      )
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('allows the canonical parseContentField definition to change', () => {
    const repoRoot = makeFixtureWorktree()
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-audit/scripts/audit.sh')
    const canonicalPath = join(repoRoot, 'src/lib/tiptap-content.ts')
    const canonicalFunction = 'parseContent' + 'Field'

    mkdirSync(join(repoRoot, 'src/lib'), { recursive: true })
    writeFileSync(
      canonicalPath,
      `export function ${canonicalFunction}(content: unknown) { return content }\n`,
    )
    commitAll(repoRoot, 'add canonical content parser')
    writeFileSync(
      canonicalPath,
      `export function ${canonicalFunction}(content: unknown) { return content ?? null }\n`,
    )

    try {
      const result = spawnSync('bash', [scriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).not.toContain('duplicate-parseContentField')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('makes the audit script reject risky changes with only unrelated changed tests', () => {
    const repoRoot = makeFixtureWorktree()
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-audit/scripts/audit.sh')

    mkdirSync(join(repoRoot, 'src/app/api/teacher/tests/[id]/auto-grade'), { recursive: true })
    mkdirSync(join(repoRoot, 'tests/unit'), { recursive: true })
    writeFileSync(
      join(repoRoot, 'src/app/api/teacher/tests/[id]/auto-grade/route.ts'),
      [
        "import { withErrorHandler } from '@/lib/api-handler'",
        '',
        "export const POST = withErrorHandler('PostTeacherTestAutoGrade', async () => {",
        "  return Response.json({ ok: true })",
        '})',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/unit/unrelated-docs.test.ts'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('unrelated docs', () => {",
        "  it('stays true', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )
    commitAll(repoRoot, 'add risky route and unrelated unit test')

    writeFileSync(
      join(repoRoot, 'src/app/api/teacher/tests/[id]/auto-grade/route.ts'),
      [
        "import { withErrorHandler } from '@/lib/api-handler'",
        '',
        "export const POST = withErrorHandler('PostTeacherTestAutoGrade', async () => {",
        "  return Response.json({ status: 'changed' })",
        '})',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/unit/unrelated-docs.test.ts'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('unrelated docs', () => {",
        "  it('still stays true', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )

    try {
      const result = spawnSync('bash', [scriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toContain('missing-risk-tests')
      expect(`${result.stdout}\n${result.stderr}`).toContain('without a relevant changed test')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('allows risky changes when a relevant api test also changes', () => {
    const repoRoot = makeFixtureWorktree()
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-audit/scripts/audit.sh')

    mkdirSync(join(repoRoot, 'src/app/api/teacher/tests/[id]/auto-grade'), { recursive: true })
    mkdirSync(join(repoRoot, 'tests/api/teacher'), { recursive: true })
    writeFileSync(
      join(repoRoot, 'src/app/api/teacher/tests/[id]/auto-grade/route.ts'),
      [
        "import { withErrorHandler } from '@/lib/api-handler'",
        '',
        "export const POST = withErrorHandler('PostTeacherTestAutoGrade', async () => {",
        "  return Response.json({ ok: true })",
        '})',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/api/teacher/tests-auto-grade.test.ts'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('teacher test auto-grade route', () => {",
        "  it('stays true', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )
    commitAll(repoRoot, 'add risky route and relevant api test')

    writeFileSync(
      join(repoRoot, 'src/app/api/teacher/tests/[id]/auto-grade/route.ts'),
      [
        "import { withErrorHandler } from '@/lib/api-handler'",
        '',
        "export const POST = withErrorHandler('PostTeacherTestAutoGrade', async () => {",
        "  return Response.json({ status: 'changed' })",
        '})',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/api/teacher/tests-auto-grade.test.ts'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('teacher test auto-grade route', () => {",
        "  it('still stays true', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )

    try {
      const result = spawnSync('bash', [scriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).not.toContain('missing-risk-tests')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('makes the audit script reject composite widget changes with only unrelated changed component tests', () => {
    const repoRoot = makeFixtureWorktree()
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-audit/scripts/audit.sh')

    mkdirSync(join(repoRoot, 'src/ui'), { recursive: true })
    mkdirSync(join(repoRoot, 'tests/components'), { recursive: true })
    writeFileSync(
      join(repoRoot, 'src/ui/SplitButton.tsx'),
      [
        "export function SplitButton() {",
        "  return <button type=\"button\" aria-expanded=\"false\">Open</button>",
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/components/UnrelatedMenu.test.tsx'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('unrelated menu', () => {",
        "  it('stays true', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )
    commitAll(repoRoot, 'add split button and unrelated component test')

    writeFileSync(
      join(repoRoot, 'src/ui/SplitButton.tsx'),
      [
        "export function SplitButton() {",
        "  return <button type=\"button\" aria-expanded=\"true\">Open</button>",
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/components/UnrelatedMenu.test.tsx'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('unrelated menu', () => {",
        "  it('still stays true', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )

    try {
      const result = spawnSync('bash', [scriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toContain('missing-a11y-tests')
      expect(`${result.stdout}\n${result.stderr}`).toContain('matching or referencing the changed component')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('makes the audit script reject composite widget changes with no changed tests', () => {
    const repoRoot = makeFixtureWorktree()
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-audit/scripts/audit.sh')

    mkdirSync(join(repoRoot, 'src/ui'), { recursive: true })
    writeFileSync(
      join(repoRoot, 'src/ui/SplitButton.tsx'),
      [
        "export function SplitButton() {",
        "  return <button type=\"button\" aria-expanded=\"false\">Open</button>",
        '}',
        '',
      ].join('\n'),
    )
    commitAll(repoRoot, 'add split button')

    writeFileSync(
      join(repoRoot, 'src/ui/SplitButton.tsx'),
      [
        "export function SplitButton() {",
        "  return <button type=\"button\" aria-expanded=\"true\">Open</button>",
        '}',
        '',
      ].join('\n'),
    )

    try {
      const result = spawnSync('bash', [scriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toContain('missing-a11y-tests')
      expect(`${result.stdout}\n${result.stderr}`).not.toContain('unbound variable')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('does not allow generic component stems to match unrelated test prose', () => {
    const repoRoot = makeFixtureWorktree()
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-audit/scripts/audit.sh')

    mkdirSync(join(repoRoot, 'src/components/tiptap-ui-primitive/button'), { recursive: true })
    mkdirSync(join(repoRoot, 'tests/ui'), { recursive: true })
    writeFileSync(
      join(repoRoot, 'src/components/tiptap-ui-primitive/button/button.tsx'),
      [
        "export function ButtonPrimitive() {",
        "  return <button type=\"button\" aria-expanded=\"false\">Open</button>",
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/ui/SplitButton.test.tsx'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('SplitButton', () => {",
        "  it('mentions a button but is unrelated', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )
    commitAll(repoRoot, 'add generic button primitive and unrelated split button test')

    writeFileSync(
      join(repoRoot, 'src/components/tiptap-ui-primitive/button/button.tsx'),
      [
        "export function ButtonPrimitive() {",
        "  return <button type=\"button\" aria-expanded=\"true\">Open</button>",
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/ui/SplitButton.test.tsx'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('SplitButton', () => {",
        "  it('still mentions a button but is unrelated', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )

    try {
      const result = spawnSync('bash', [scriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toContain('missing-a11y-tests')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('allows generic component stems when the changed test filename matches case-insensitively', () => {
    const repoRoot = makeFixtureWorktree()
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-audit/scripts/audit.sh')

    mkdirSync(join(repoRoot, 'src/components/tiptap-ui-primitive/button'), { recursive: true })
    mkdirSync(join(repoRoot, 'tests/ui'), { recursive: true })
    writeFileSync(
      join(repoRoot, 'src/components/tiptap-ui-primitive/button/button.tsx'),
      [
        "export function Button() {",
        "  return <button type=\"button\" aria-expanded=\"false\">Open</button>",
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/ui/Button.test.tsx'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('Button', () => {",
        "  it('covers semantic state', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )
    commitAll(repoRoot, 'add generic button primitive and matching button test')

    writeFileSync(
      join(repoRoot, 'src/components/tiptap-ui-primitive/button/button.tsx'),
      [
        "export function Button() {",
        "  return <button type=\"button\" aria-expanded=\"true\">Open</button>",
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/ui/Button.test.tsx'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('Button', () => {",
        "  it('still covers semantic state', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )

    try {
      const result = spawnSync('bash', [scriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).not.toContain('missing-a11y-tests')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('does not allow generic component stems to match longer unrelated PascalCase test filenames', () => {
    const repoRoot = makeFixtureWorktree()
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-audit/scripts/audit.sh')

    mkdirSync(join(repoRoot, 'src/app/classrooms'), { recursive: true })
    mkdirSync(join(repoRoot, 'tests/ui'), { recursive: true })
    writeFileSync(
      join(repoRoot, 'src/app/classrooms/page.tsx'),
      [
        "export function ClassroomPage() {",
        "  return <button type=\"button\" aria-expanded=\"false\">Open</button>",
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/ui/PageActionBar.test.tsx'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('PageActionBar', () => {",
        "  it('covers unrelated actions', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )
    commitAll(repoRoot, 'add classroom page and unrelated page action bar test')

    writeFileSync(
      join(repoRoot, 'src/app/classrooms/page.tsx'),
      [
        "export function ClassroomPage() {",
        "  return <button type=\"button\" aria-expanded=\"true\">Open</button>",
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/ui/PageActionBar.test.tsx'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('PageActionBar', () => {",
        "  it('still covers unrelated actions', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )

    try {
      const result = spawnSync('bash', [scriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toContain('missing-a11y-tests')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('allows generic page changes when a route-specific semantic test imports the exact page', () => {
    const repoRoot = makeFixtureWorktree()
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-audit/scripts/audit.sh')

    mkdirSync(join(repoRoot, 'src/app/teacher/dashboard'), { recursive: true })
    mkdirSync(join(repoRoot, 'tests/components'), { recursive: true })
    writeFileSync(
      join(repoRoot, 'src/app/teacher/dashboard/page.tsx'),
      [
        'export default function TeacherDashboardPage() {',
        '  return <button type="button" aria-expanded="false">Open</button>',
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/components/TeacherDashboardPage.test.tsx'),
      [
        "import TeacherDashboardPage from '@/app/teacher/dashboard/page'",
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('TeacherDashboardPage', () => {",
        "  it('covers semantic state', () => {",
        '    expect(TeacherDashboardPage).toBeTypeOf(\'function\')',
        '  })',
        '})',
        '',
      ].join('\n'),
    )
    commitAll(repoRoot, 'add dashboard page and route-specific test')

    writeFileSync(
      join(repoRoot, 'src/app/teacher/dashboard/page.tsx'),
      [
        'export default function TeacherDashboardPage() {',
        '  return <button type="button" aria-expanded="true">Open</button>',
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/components/TeacherDashboardPage.test.tsx'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('TeacherDashboardPage', () => {",
        "  it('still covers semantic state', async () => {",
        "    const page = await import('@/app/teacher/dashboard/page')",
        '    expect(page.default).toBeTypeOf(\'function\')',
        '  })',
        '})',
        '',
      ].join('\n'),
    )

    try {
      const result = spawnSync('bash', [scriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).not.toContain('missing-a11y-tests')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('rejects prefix-colliding imports for generic page changes', () => {
    const repoRoot = makeFixtureWorktree()
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-audit/scripts/audit.sh')

    mkdirSync(join(repoRoot, 'src/app/teacher/dashboard'), { recursive: true })
    mkdirSync(join(repoRoot, 'tests/components'), { recursive: true })
    writeFileSync(
      join(repoRoot, 'src/app/teacher/dashboard/page.tsx'),
      [
        'export default function TeacherDashboardPage() {',
        '  return <button type="button" aria-expanded="false">Open</button>',
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/components/TeacherDashboardHelpers.test.tsx'),
      [
        "// '@/app/teacher/dashboard/page' is intentionally not imported here",
        '/*',
        "import TeacherDashboardPage from '@/app/teacher/dashboard/page'",
        '*/',
        "import { dashboardHelper } from '@/app/teacher/dashboard/page-helpers' // exported from '@/app/teacher/dashboard/page'",
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('dashboard helpers', () => {",
        "  it('covers only the helper module', () => {",
        '    expect(dashboardHelper).toBeDefined()',
        '  })',
        '})',
        '',
      ].join('\n'),
    )
    commitAll(repoRoot, 'add dashboard page and unrelated helper test')

    writeFileSync(
      join(repoRoot, 'src/app/teacher/dashboard/page.tsx'),
      [
        'export default function TeacherDashboardPage() {',
        '  return <button type="button" aria-expanded="true">Open</button>',
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/components/TeacherDashboardHelpers.test.tsx'),
      [
        "// '@/app/teacher/dashboard/page' is intentionally not imported here",
        '/*',
        "import TeacherDashboardPage from '@/app/teacher/dashboard/page'",
        '*/',
        "import { dashboardHelper } from '@/app/teacher/dashboard/page-helpers' // exported from '@/app/teacher/dashboard/page'",
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('dashboard helpers', () => {",
        "  it('still covers only the helper module', () => {",
        '    expect(dashboardHelper).toBeDefined()',
        '  })',
        '})',
        '',
      ].join('\n'),
    )

    try {
      const result = spawnSync('bash', [scriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toContain('missing-a11y-tests')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('allows composite widget changes when a matching semantic test also changes', () => {
    const repoRoot = makeFixtureWorktree()
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-audit/scripts/audit.sh')

    mkdirSync(join(repoRoot, 'src/ui'), { recursive: true })
    mkdirSync(join(repoRoot, 'tests/ui'), { recursive: true })
    writeFileSync(
      join(repoRoot, 'src/ui/SplitButton.tsx'),
      [
        "export function SplitButton() {",
        "  return <button type=\"button\" aria-expanded=\"false\">Open</button>",
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/ui/SplitButton.test.tsx'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('SplitButton', () => {",
        "  it('covers semantic state', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )
    commitAll(repoRoot, 'add split button and matching ui test')

    writeFileSync(
      join(repoRoot, 'src/ui/SplitButton.tsx'),
      [
        "export function SplitButton() {",
        "  return <button type=\"button\" aria-expanded=\"true\">Open</button>",
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/ui/SplitButton.test.tsx'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('SplitButton', () => {",
        "  it('still covers semantic state', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )

    try {
      const result = spawnSync('bash', [scriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).not.toContain('missing-a11y-tests')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('allows composite widget changes when a semantic test references the changed component', () => {
    const repoRoot = makeFixtureWorktree()
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-audit/scripts/audit.sh')

    mkdirSync(join(repoRoot, 'src/ui'), { recursive: true })
    mkdirSync(join(repoRoot, 'tests/ui'), { recursive: true })
    writeFileSync(
      join(repoRoot, 'src/ui/SplitButton.tsx'),
      [
        "export function SplitButton() {",
        "  return <button type=\"button\" aria-expanded=\"false\">Open</button>",
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/ui/MenuAccessibility.test.tsx'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('menu accessibility', () => {",
        "  it('covers SplitButton semantic state', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )
    commitAll(repoRoot, 'add split button and referencing ui test')

    writeFileSync(
      join(repoRoot, 'src/ui/SplitButton.tsx'),
      [
        "export function SplitButton() {",
        "  return <button type=\"button\" aria-expanded=\"true\">Open</button>",
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(repoRoot, 'tests/ui/MenuAccessibility.test.tsx'),
      [
        "import { describe, expect, it } from 'vitest'",
        '',
        "describe('menu accessibility', () => {",
        "  it('still covers SplitButton semantic state', () => {",
        '    expect(true).toBe(true)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )

    try {
      const result = spawnSync('bash', [scriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).not.toContain('missing-a11y-tests')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })
})
