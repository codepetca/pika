import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))

function readRepoFile(relativePath: string) {
  return readFileSync(resolve(testDir, '../..', relativePath), 'utf8')
}

describe('AI startup docs', () => {
  it('keeps the default startup set under the budget', () => {
    const files = [
      '.ai/START-HERE.md',
      '.ai/CURRENT.md',
      '.ai/features.json',
      'docs/ai-instructions.md',
    ]

    const totalChars = files.reduce((sum, file) => sum + readRepoFile(file).length, 0)

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

    expect(readRepoFile('.ai/START-HERE.md')).toContain('.ai/CURRENT.md')
    expect(readRepoFile('.codex/prompts/session-start.md')).toContain('.ai/CURRENT.md')
    expect(readRepoFile('.codex/skills/pika-session-start/scripts/session_start.sh')).toContain('.ai/CURRENT.md')
  })
})
