import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))

function readRepoFile(relativePath: string) {
  return readFileSync(resolve(testDir, '../..', relativePath), 'utf8')
}

describe('course blueprint package docs', () => {
  it('documents the official portable package contract and round trip', () => {
    const docs = readRepoFile('docs/guidance/course-blueprint-packages.md')

    expect(docs).toContain('Course Blueprint')
    expect(docs).toContain('.course-package.tar')
    expect(docs).toContain('manifest.json')
    expect(docs).toContain('course-overview.md')
    expect(docs).toContain('assignments.md')
    expect(docs).toContain('quizzes.md')
    expect(docs).toContain('tests.md')
    expect(docs).toContain('lesson-plans.md')
    expect(docs).toContain('students, submissions, grades, attendance')
    expect(docs).toContain('Edit the Markdown files in a repo, Codex, or Claude')
  })
})
