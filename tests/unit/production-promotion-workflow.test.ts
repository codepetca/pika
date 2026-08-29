import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { selectProductionPromotion } from '../../.codex/skills/pika-main-to-production-merge/scripts/select_production_promotion.mjs'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('production promotion workflow', () => {
  it('reuses one open draft promotion PR and refuses ambiguous batches', () => {
    const script = read('.codex/skills/pika-main-to-production-merge/scripts/merge_main_into_production.sh')

    expect(script).toContain('select_production_promotion.mjs')
    expect(script).toContain('worktree add --detach "$PROMOTION_WT" origin/main')
    expect(script).toContain('trap cleanup EXIT')
    expect(script).toContain('no persistent production checkout is advanced')
    expect(script).toContain('BRANCH_NAME="$EXISTING_PR_HEAD"')
    expect(script).toContain('gh pr ready "$EXISTING_PR_URL" --repo "$GITHUB_REPO" --undo')
    expect(script).toContain('Promotion PR updated and kept draft for cumulative review')
    expect(script).toContain('PR_URL="$(gh pr create')
    expect(script).toContain('  --draft \\')
  })

  it('ignores fork spoofs and refuses multiple same-repository promotion PRs', () => {
    const fork = {
      headRefName: 'codex/merge-main-into-production-spoof',
      isCrossRepository: true,
      isDraft: true,
      url: 'https://example.test/fork',
    }
    const legitimate = {
      headRefName: 'codex/merge-main-into-production-20260828',
      isCrossRepository: false,
      isDraft: true,
      url: 'https://example.test/legitimate',
    }

    expect(selectProductionPromotion([fork])).toBeNull()
    expect(selectProductionPromotion([fork, legitimate])).toEqual(legitimate)
    expect(() => selectProductionPromotion([
      legitimate,
      { ...legitimate, headRefName: `${legitimate.headRefName}-second` },
    ])).toThrow('Multiple open same-repository')
  })

  it('prepares the exact main SHA regardless of prior production merge strategy', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'pika-production-strategy-'))
    const worktreeRoot = mkdtempSync(join(tmpdir(), 'pika-production-worktrees-'))
    const git = (...args: string[]) => execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim()

    try {
      git('init', '-q')
      git('config', 'user.email', 'test@example.com')
      git('config', 'user.name', 'Test')
      writeFileSync(join(repoRoot, 'state.txt'), 'base\n')
      git('add', '.')
      git('commit', '-qm', 'base')
      const productionBase = git('rev-parse', 'HEAD')
      git('branch', 'production')
      writeFileSync(join(repoRoot, 'state.txt'), 'main one\n')
      git('commit', '-qam', 'main one')
      const mainSha = git('rev-parse', 'HEAD')
      const mainTree = git('rev-parse', `${mainSha}^{tree}`)
      const outcomes = [
        git('commit-tree', mainTree, '-p', productionBase, '-p', mainSha, '-m', 'merge outcome'),
        git('commit-tree', mainTree, '-p', productionBase, '-m', 'squash outcome'),
        mainSha,
      ]

      for (const outcome of outcomes) {
        git('update-ref', 'refs/heads/production', outcome)
        const worktree = join(worktreeRoot, `promotion-${outcomes.indexOf(outcome)}`)
        git('worktree', 'add', '--detach', worktree, mainSha)
        const prepared = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: worktree,
          encoding: 'utf8',
        }).trim()
        expect(prepared).toBe(mainSha)
        git('worktree', 'remove', worktree)
      }

      writeFileSync(join(repoRoot, 'state.txt'), 'main two\n')
      git('commit', '-qam', 'main two')
      const nextMainSha = git('rev-parse', 'HEAD')
      const nextWorktree = join(worktreeRoot, 'promotion-next')
      git('worktree', 'add', '--detach', nextWorktree, nextMainSha)
      expect(execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: nextWorktree,
        encoding: 'utf8',
      }).trim()).toBe(nextMainSha)
      git('worktree', 'remove', nextWorktree)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
      rmSync(worktreeRoot, { recursive: true, force: true })
    }
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
