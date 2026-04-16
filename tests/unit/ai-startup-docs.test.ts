import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))

function readRepoFile(relativePath: string) {
  return readFileSync(resolve(testDir, '../..', relativePath), 'utf8')
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
      '.codex/prompts/session-start.md',
      '.codex/skills/pika-session-start/scripts/session_start.sh',
    ]

    for (const file of files) {
      const content = readRepoFile(file)
      expect(content).not.toContain('tail -40 "$PIKA_WORKTREE/.ai/JOURNAL.md"')
      expect(content).not.toContain('tail -60 "$PIKA_WORKTREE/.ai/JOURNAL.md"')
    }
  })

  it('keeps the preferred startup paths aligned with the required startup set', () => {
    const prompt = readRepoFile('.codex/prompts/session-start.md')
    const script = readRepoFile('.codex/skills/pika-session-start/scripts/session_start.sh')

    for (const file of requiredStartupFiles) {
      expect(prompt).toContain(file)
      expect(script).toContain(file)
    }

    expect(script.indexOf('.ai/START-HERE.md')).toBeLessThan(script.indexOf('.ai/CURRENT.md'))
    expect(script.indexOf('.ai/CURRENT.md')).toBeLessThan(script.indexOf('.ai/features.json'))
    expect(script.indexOf('.ai/features.json')).toBeLessThan(script.indexOf('docs/ai-instructions.md'))
  })
})
