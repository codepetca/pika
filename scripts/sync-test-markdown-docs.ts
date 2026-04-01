import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { syncTeacherTestsMarkdownSchemaDoc } from '../src/lib/test-markdown-schema-docs'

const docsPath = resolve(process.cwd(), 'docs/guidance/teacher-tests-markdown-schema.md')
const current = readFileSync(docsPath, 'utf8')
const next = syncTeacherTestsMarkdownSchemaDoc(current)

if (next !== current) {
  writeFileSync(docsPath, next)
  console.log('Synced teacher test markdown schema docs')
} else {
  console.log('Teacher test markdown schema docs already in sync')
}
