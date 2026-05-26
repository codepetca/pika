import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const routeRoot = resolve(process.cwd(), 'src/app/api')
const exportedHandlerPattern = /export\s+(?:async\s+function|const)\s+(GET|POST|PATCH|PUT|DELETE)\b/g
const wrappedHandlerPattern = /export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*=\s*withErrorHandler\b/g
const aliasHandlerPattern = /export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*=\s*(GET|POST|PATCH|PUT|DELETE)\b/g

function collectRouteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(dir, entry.name)

    if (entry.isDirectory()) {
      return collectRouteFiles(entryPath)
    }

    return entry.name === 'route.ts' ? [entryPath] : []
  })
}

describe('API route standards', () => {
  it('wraps exported HTTP handlers with withErrorHandler', () => {
    const violations = collectRouteFiles(routeRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8')
      const exportedHandlers = Array.from(source.matchAll(exportedHandlerPattern), (match) => match[1])
      const wrappedHandlers = new Set(
        Array.from(source.matchAll(wrappedHandlerPattern), (match) => match[1])
      )
      const aliasedHandlers = new Map(
        Array.from(source.matchAll(aliasHandlerPattern), (match) => [match[1], match[2]])
      )

      return exportedHandlers
        .filter((method) => {
          const aliasedMethod = aliasedHandlers.get(method)

          return !wrappedHandlers.has(method) && !(aliasedMethod && wrappedHandlers.has(aliasedMethod))
        })
        .map((method) => `${relative(process.cwd(), filePath)} exports ${method} without withErrorHandler`)
    })

    expect(violations).toEqual([])
  })
})
