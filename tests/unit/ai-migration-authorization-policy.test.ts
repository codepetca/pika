import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readRepoFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8')

const policy = readRepoFile('docs/guidance/schema-rollout-checklist.md')

describe('AI migration application authorization policy', () => {
  it('requires current, one-time authorization for an exact target and migration', () => {
    expect(policy).toContain('human-controlled by default')
    expect(policy).toContain('direct, one-time instruction in the current task')
    expect(policy).toContain('target environment')
    expect(policy).toContain('exact migration number(s) or filename(s)')
    expect(policy).toContain(
      'Permission expires after one attempted non-dry-run application command',
    )
    expect(policy).toContain('"apply migrations", "continue"')
    expect(policy).toContain('approval from an earlier task')
    expect(policy).toContain('supabase migration list')
    expect(policy).toContain('supabase db push --dry-run')
  })

  it('does not let migration approval authorize destructive maintenance', () => {
    expect(policy).toContain('supabase db reset')
    expect(policy).toContain('migration history repair')
    expect(policy).toContain('rollback/down')
    expect(policy).toContain('seeding')
    expect(policy).toContain('data cleanup')
    expect(policy).toContain('Storage deletion')
    expect(policy).toContain('requires separate explicit approval')
    expect(policy).toContain('Do not add `--include-all`')
    expect(policy).toContain('`--include-seed`')
    expect(policy).toContain('alternate `--db-url`')
    expect(policy).toMatch(/Do not\s+paste migration SQL into the Dashboard SQL editor/)
  })

  it('removes the blanket prohibition from active agent guidance', () => {
    const activeGuidance = [
      'AGENTS.md',
      '.ai/CURRENT.md',
      'docs/ai-instructions.md',
      'docs/core/agents.md',
      'docs/core/project-context.md',
      'docs/guidance/legacy-quiz-contract-cleanup.md',
      'docs/guidance/schema-rollout-checklist.md',
    ]
      .map(readRepoFile)
      .join('\n')

    expect(activeGuidance).not.toMatch(/humans apply migrations manually/i)
    expect(activeGuidance).not.toMatch(/AI does not apply migrations/i)
    expect(activeGuidance).not.toMatch(/Do not apply migrations as an AI agent/i)
    expect(activeGuidance).not.toMatch(/Run or apply migrations \(human does this\)/i)
  })
})
