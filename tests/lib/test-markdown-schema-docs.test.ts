import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { syncTeacherTestsMarkdownSchemaDoc } from '@/lib/test-markdown-schema-docs'

describe('teacher test markdown schema docs', () => {
  it('stay synced with the canonical markdown schema source', () => {
    const testDir = dirname(fileURLToPath(import.meta.url))
    const docsPath = resolve(testDir, '../../docs/guidance/teacher-tests-markdown-schema.md')
    const docsContent = readFileSync(docsPath, 'utf8')

    expect(docsContent).toBe(syncTeacherTestsMarkdownSchemaDoc(docsContent))
  })
})
