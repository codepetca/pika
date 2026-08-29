import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('production promotion workflow', () => {
  it('reuses one open draft promotion PR and refuses ambiguous batches', () => {
    const script = read('.codex/skills/pika-main-to-production-merge/scripts/merge_main_into_production.sh')

    expect(script).toContain('PROMOTION_COUNT')
    expect(script).toContain('Multiple open main-to-production PRs exist')
    expect(script).toContain('worktree add --detach "$PROMOTION_WT" origin/production')
    expect(script).toContain('trap cleanup EXIT')
    expect(script).toContain('no persistent production checkout is advanced')
    expect(script).toContain('BRANCH_NAME="$EXISTING_PR_HEAD"')
    expect(script).toContain('gh pr ready "$EXISTING_PR_URL" --repo "$GITHUB_REPO" --undo')
    expect(script).toContain('Promotion PR updated and kept draft for cumulative review')
    expect(script).toContain('PR_URL="$(gh pr create')
    expect(script).toContain('  --draft \\')
  })

  it('requires agents to batch and review production promotions', () => {
    for (const path of [
      '.codex/skills/pika-main-to-production-merge/SKILL.md',
      '.codex/prompts/merge-main-into-production.md',
      '.claude/commands/merge-main-into-production.md',
      'docs/dev-workflow.md',
    ]) {
      const content = read(path)
      expect(content).toMatch(/draft/i)
      expect(content).toMatch(/batch|cumulative/i)
      expect(content).toContain('PR Gate')
    }
  })
})
