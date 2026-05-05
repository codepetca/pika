import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

    expect(totalChars).toBeLessThanOrEqual(15_000)
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
      expect(content).not.toMatch(/tail -\d+ "\$PIKA_WORKTREE\/\.ai\/JOURNAL/)
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

  it('renders the required startup docs in order in the automated session-start path', () => {
    const repoRoot = makeFixtureWorktree()
    const scriptPath = resolve(testDir, '../../.codex/skills/pika-session-start/scripts/session_start.sh')

    try {
      const output = execFileSync('bash', [scriptPath], {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: repoRoot,
          PIKA_WORKTREE: repoRoot,
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
})
