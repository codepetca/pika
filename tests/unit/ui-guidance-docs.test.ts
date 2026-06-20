import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))

function readRepoFile(relativePath: string) {
  return readFileSync(resolve(testDir, '../..', relativePath), 'utf8')
}

describe('ui guidance docs and prompts', () => {
  it('points UI work to the canon entrypoint and stable guidance', () => {
    const aiInstructions = readRepoFile('docs/ai-instructions.md')
    const coreDesign = readRepoFile('docs/core/design.md')
    const designSystem = readRepoFile('docs/design-system.md')
    const uiCanon = readRepoFile('docs/guidance/ui/README.md')

    expect(aiInstructions).toContain('docs/guidance/ui/README.md')
    expect(aiInstructions).toContain('docs/guidance/ui/stable.md')
    expect(coreDesign).toContain('UI canon')
    expect(coreDesign).toContain('composite-widget-accessibility.md')
    expect(uiCanon).toContain('composite-widget-accessibility.md')
    expect(designSystem).toContain('Historical reference only')
  })

  it('keeps historical design-system dark-mode examples aligned with semantic tokens', () => {
    const designSystem = readRepoFile('docs/design-system.md')
    const darkModeSection = designSystem.match(/### Dark Mode Implementation \(REQUIRED\)(?<body>[\s\S]*?)### Playful Accents/)?.groups?.body ?? ''

    expect(darkModeSection).toContain('semantic tokens')
    expect(darkModeSection).toMatch(/className="bg-surface"/)
    expect(darkModeSection).toMatch(/className="text-text-default"/)
    expect(darkModeSection).toMatch(/className="border-border"/)
    expect(darkModeSection).not.toContain('dark:')
  })

  it('requires the UI guidance declaration in issue and Codex workflows', () => {
    const files = [
      'docs/workflow/handle-issue.md',
      'docs/issue-worker.md',
      '.codex/prompts/session-start.md',
      '.codex/prompts/work-on-issue.md',
    ]

    for (const file of files) {
      const content = readRepoFile(file)
      expect(content).toContain('UI guidance declaration')
      expect(content).toContain('stable guidance followed')
      expect(content).toContain('experimental guidance introduced: yes/no')
      expect(content).toContain('human promotion needed: yes/no')
    }
  })

  it('keeps the audit prompt aligned with the composite-widget accessibility gate', () => {
    const auditPrompt = readRepoFile('.codex/prompts/audit.md')
    const auditSkill = readRepoFile('.codex/skills/pika-audit/SKILL.md')

    expect(auditPrompt).toContain('composite-widget-accessibility.md')
    expect(auditPrompt).toContain('semantic/keyboard regression coverage added: yes/no')
    expect(auditPrompt).toContain('full validation pass completed: yes/no')
    expect(auditPrompt).toContain('path-aware guardrail, not as proof')
    expect(auditSkill).toContain('missing-a11y-tests')
    expect(auditSkill).toContain('missing-risk-tests')
    expect(auditSkill).toContain('without a relevant changed test')
    expect(auditSkill).toContain('path-aware guardrail, not a proof system')
  })

  it('keeps teacher work-surface review prompts aligned with the assignments/tests canon', () => {
    const uiCanon = readRepoFile('docs/guidance/ui/teacher-work-surfaces.md')
    const auditDoc = readRepoFile('docs/guidance/ui/audit-teacher-work-surfaces.md')
    const reviewPrompt = readRepoFile('.codex/prompts/teacher-work-surface-promotion-review.md')

    for (const content of [uiCanon, auditDoc, reviewPrompt]) {
      expect(content).toContain('teacher assignments')
      expect(content).toContain('teacher tests')
    }

    expect(reviewPrompt).not.toContain('teacher quizzes')
    expect(reviewPrompt).toContain('current implementation of teacher assignments and teacher tests')
  })
})
