import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('assignment AI grading worker workflow', () => {
  it('sends the dedicated worker secret only to the fixed Pika production origin', () => {
    const workflow = readFileSync(
      '.github/workflows/assignment-ai-grading-worker.yml',
      'utf8',
    )

    expect(workflow).toContain('WORKER_URL: https://pika.codepet.ca')
    expect(workflow).toContain("if: ${{ vars.PIKA_ASSIGNMENT_AI_GRADING_WORKER_ENABLED == 'true' }}")
    expect(workflow).toContain('PIKA_ASSIGNMENT_AI_GRADING_WORKER_SECRET')
    expect(workflow).not.toContain('PIKA_ASSIGNMENT_AI_GRADING_WORKER_URL')
    expect(workflow).not.toContain('CRON_SECRET')
  })
})
