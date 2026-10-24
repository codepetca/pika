import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Explicit adoption list, not a claim about all application logging.
const coveredFiles = [
  'src/app/api/student/tests/route.ts',
  'src/app/api/student/tests/[id]/route.ts',
  'src/app/api/student/tests/[id]/results/route.ts',
  'src/app/api/student/tests/[id]/focus-events/route.ts',
  'src/app/api/teacher/tests/route.ts',
  'src/app/api/teacher/tests/reorder/route.ts',
  'src/app/api/teacher/tests/[id]/route.ts',
  'src/app/api/teacher/tests/[id]/results/route.ts',
  'src/app/api/teacher/tests/[id]/unsubmit/route.ts',
  'src/app/api/teacher/tests/[id]/student-access/route.ts',
  'src/app/api/teacher/tests/[id]/students/[studentId]/attempt/route.ts',
  'src/app/api/teacher/tests/[id]/students/attempts/bulk-delete/route.ts',
  'src/app/api/teacher/tests/[id]/documents/[docId]/sync/route.ts',
  'src/app/api/student/assignments/route.ts',
  'src/app/api/assignment-docs/[id]/route.ts',
  'src/app/api/assignment-docs/[id]/submit/route.ts',
  'src/app/api/assignment-docs/[id]/unsubmit/route.ts',
  'src/app/api/assignment-docs/[id]/restore/route.ts',
  'src/app/api/assignment-docs/[id]/history/route.ts',
  'src/app/api/teacher/assignments/route.ts',
  'src/app/api/teacher/assignments/[id]/route.ts',
  'src/app/api/teacher/assignments/reorder/route.ts',
  'src/app/api/teacher/assignments/[id]/release/route.ts',
  'src/app/api/teacher/assignments/bulk/route.ts',
  'src/lib/server/assessment-drafts.ts',
  'src/lib/server/test-document-authoring.ts',
  'src/lib/server/test-document-snapshot-storage-cleanup.ts',
  'src/lib/server/assignment-doc-submissions.ts',
  'src/lib/server/assignment-submission-artifacts.ts',
  'src/lib/server/assignment-artifact-storage-cleanup.ts',
  'src/lib/assignment-doc-history.ts',
  'src/lib/server/daily-log-pal.ts',
  'src/lib/api-handler.ts',
  'src/lib/auth.ts',
  'src/lib/server/auth-response.ts',
  'src/lib/server/auth-rate-limit.ts',
  'src/app/api/auth/create-password/route.ts',
  'src/app/api/auth/forgot-password/route.ts',
  'src/app/api/auth/signup/route.ts',
  'src/app/api/auth/verify-signup/route.ts',
  'src/app/api/auth/reset-password/verify/route.ts',
  'src/app/api/auth/reset-password/confirm/route.ts',
  'src/app/api/cron/nightly-log-summaries/route.ts',
  'src/app/api/teacher/log-summary/route.ts',
  'src/lib/server/test-submissions.ts',
  'src/lib/server/finalize-test-attempts.ts',
  'src/lib/server/gradebook.ts',
  'src/lib/server/test-ai-grading-runs.ts',
  'src/app/api/student/tests/[id]/history/route.ts',
  'src/app/api/teacher/tests/[id]/auto-grade/route.ts',
  'src/app/api/teacher/tests/[id]/responses/[responseId]/ai-suggest/route.ts',
  'src/app/api/teacher/assignments/[id]/auto-grade/route.ts',
]

describe('adopted diagnostic boundaries', () => {
  it.each(coveredFiles)('%s cannot emit raw console data or dynamic diagnostic labels', (path) => {
    const source = ts.createSourceFile(path, readFileSync(resolve(path), 'utf8'), ts.ScriptTarget.Latest, true)
    const violations: string[] = []
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        if (ts.isPropertyAccessExpression(callee) && callee.expression.getText(source) === 'console') {
          // A fixed, content-free warning (e.g. missing optional table) may remain.
          if (callee.name.text !== 'warn' || node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) {
            violations.push(node.getText(source))
          }
        }
        if (ts.isIdentifier(callee) && callee.text === 'logServerError' && !ts.isStringLiteral(node.arguments[0])) {
          violations.push(node.getText(source))
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(violations).toEqual([])
  })
})
