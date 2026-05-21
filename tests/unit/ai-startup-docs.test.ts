import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
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

const requiredStartupFiles = [
  '.ai/START-HERE.md',
  '.ai/CURRENT.md',
  '.ai/features.json',
  'docs/ai-instructions.md',
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

  it('keeps the rolling session log small', () => {
    const sessionLog = readRepoFile('.ai/SESSION-LOG.md')
    const entryCount = sessionLog.match(/^## /gm)?.length ?? 0

    expect(sessionLog).toContain('Rolling recent session log')
    expect(entryCount).toBeGreaterThan(0)
    expect(entryCount).toBeLessThanOrEqual(20)
    expect(readRepoFile('.ai/JOURNAL-ARCHIVE.md')).toContain('# Pika Project Journal')
  })

  it('keeps the manual startup prompt aligned with the required startup set', () => {
    const prompt = readRepoFile('.codex/prompts/session-start.md')

    for (const file of requiredStartupFiles) {
      expect(prompt).toContain(file)
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

  it('documents the shared env symlink requirement', () => {
    const files = [
      '.ai/START-HERE.md',
      '.ai/CURRENT.md',
      'AGENTS.md',
      'docs/dev-workflow.md',
      '.codex/prompts/session-start.md',
      '.claude/commands/session-start.md',
    ]

    for (const file of files) {
      expect(readRepoFile(file)).toContain('$HOME/Repos/.env/pika/.env.local')
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
})
