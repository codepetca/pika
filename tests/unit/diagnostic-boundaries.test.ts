import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Explicit adoption list, not a claim about all application logging.
const coveredFiles = [
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
