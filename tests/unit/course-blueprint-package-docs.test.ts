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
    const lifecycleDocs = readRepoFile('docs/guidance/classroom-lifecycle-archives.md')

    expect(docs).toContain('Course Blueprint')
    expect(docs).toContain('.course-package.tar')
    expect(docs).toContain('manifest.json')
    expect(docs).toContain('course-overview.md')
    expect(docs).toContain('assignments.md')
    expect(docs).toContain('tests.md')
    expect(docs).toContain('lesson-plans.md')
    expect(docs).toContain('students, submissions, grades, attendance')
    expect(docs).toContain('Edit the Markdown files in a repo, Codex, or Claude')
    expect(docs).toContain('canonical export manifest version is `3`')
    expect(docs).toContain('imports versions `2` and `3`')
    expect(docs).toContain('ignores that legacy quiz content')
    expect(lifecycleDocs).toContain('export manifest is version 3')
    expect(lifecycleDocs).toContain('Import accepts versions 2 and 3')
    expect(lifecycleDocs).not.toContain('manifest remains version 2')
  })
})
