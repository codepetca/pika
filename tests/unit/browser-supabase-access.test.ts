import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

type SourceImport = {
  specifier: string
  runtime: boolean
}

type SourceModule = {
  filePath: string
  imports: SourceImport[]
  isClientEntry: boolean
}

const sourceRoot = resolve(process.cwd(), 'src')
const sourceFilePattern = /\.(ts|tsx)$/
const declarationFilePattern = /\.d\.ts$/
const supabaseRuntimeSpecifiers = new Set(['@/lib/supabase', '@supabase/supabase-js'])

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(dir, entry.name)

    if (entry.isDirectory()) {
      return collectSourceFiles(entryPath)
    }

    return sourceFilePattern.test(entry.name) && !declarationFilePattern.test(entry.name)
      ? [entryPath]
      : []
  })
}

function parseSourceFile(filePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    false,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

function hasUseClientDirective(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if (
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression)
    ) {
      if (statement.expression.text === 'use client') return true
      continue
    }

    return false
  }

  return false
}

function importDeclarationHasRuntimeBinding(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause
  if (!clause) return true
  if (clause.isTypeOnly) return false
  if (clause.name) return true
  if (!clause.namedBindings) return false
  if (ts.isNamespaceImport(clause.namedBindings)) return true

  return clause.namedBindings.elements.some((element) => !element.isTypeOnly)
}

function collectRuntimeAwareImports(sourceFile: ts.SourceFile): SourceImport[] {
  const imports = sourceFile.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement)) return []
    if (!ts.isStringLiteral(statement.moduleSpecifier)) return []

    return {
      specifier: statement.moduleSpecifier.text,
      runtime: importDeclarationHasRuntimeBinding(statement),
    }
  })

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')
      ) {
        imports.push({
          specifier: node.arguments[0].text,
          runtime: true,
        })
      }
    }

    ts.forEachChild(node, visit)
  }

  ts.forEachChild(sourceFile, visit)

  return imports
}

function createSourceModule(filePath: string, source: string): SourceModule {
  const sourceFile = parseSourceFile(filePath, source)

  return {
    filePath,
    imports: collectRuntimeAwareImports(sourceFile),
    isClientEntry: hasUseClientDirective(sourceFile),
  }
}

function createSourceModules(): Map<string, SourceModule> {
  return new Map(
    collectSourceFiles(sourceRoot).map((filePath) => [
      filePath,
      createSourceModule(filePath, readFileSync(filePath, 'utf8')),
    ]),
  )
}

function resolveInternalImport(
  modules: Map<string, SourceModule>,
  fromFilePath: string,
  specifier: string,
): string | null {
  const unresolvedPath = specifier.startsWith('@/')
    ? resolve(sourceRoot, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(fromFilePath), specifier)
      : null

  if (!unresolvedPath) return null

  const candidates = [
    unresolvedPath,
    `${unresolvedPath}.ts`,
    `${unresolvedPath}.tsx`,
    resolve(unresolvedPath, 'index.ts'),
    resolve(unresolvedPath, 'index.tsx'),
  ]

  return candidates.find((candidate) => modules.has(candidate)) ?? null
}

function findBrowserSupabaseAccessViolations(modules: Map<string, SourceModule>): string[] {
  const violations: string[] = []
  const queue = Array.from(modules.values())
    .filter((sourceModule) => sourceModule.isClientEntry)
    .map((sourceModule) => ({
      filePath: sourceModule.filePath,
      chain: [sourceModule.filePath],
    }))
  const visited = new Set(queue.map((item) => item.filePath))

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    const sourceModule = modules.get(current.filePath)
    if (!sourceModule) continue

    for (const sourceImport of sourceModule.imports) {
      if (!sourceImport.runtime) continue

      if (supabaseRuntimeSpecifiers.has(sourceImport.specifier)) {
        violations.push(
          `${current.chain.map((filePath) => relative(process.cwd(), filePath)).join(' -> ')} imports ${sourceImport.specifier}`,
        )
        continue
      }

      const resolvedImport = resolveInternalImport(modules, current.filePath, sourceImport.specifier)
      if (!resolvedImport || visited.has(resolvedImport)) continue

      visited.add(resolvedImport)
      queue.push({
        filePath: resolvedImport,
        chain: [...current.chain, resolvedImport],
      })
    }
  }

  return violations
}

function sourceHasSupabaseRuntimeImport(source: string): boolean {
  return createSourceModule('fixture.tsx', source).imports.some(
    (sourceImport) => sourceImport.runtime && supabaseRuntimeSpecifiers.has(sourceImport.specifier),
  )
}

describe('browser Supabase access guard', () => {
  it('keeps Supabase runtime clients out of browser-reachable modules', () => {
    expect(findBrowserSupabaseAccessViolations(createSourceModules())).toEqual([])
  })

  it('ignores type-only Supabase imports', () => {
    expect(sourceHasSupabaseRuntimeImport(`
      'use client'
      import { useMemo } from 'react'
      import type { SupabaseClient } from '@supabase/supabase-js'
      import { type SupabaseClient as InlineTypeClient } from '@supabase/supabase-js'
    `)).toBe(false)
  })

  it('detects runtime Supabase imports', () => {
    expect(sourceHasSupabaseRuntimeImport(`
      'use client'
      import {
        getServiceRoleClient,
      } from '@/lib/supabase'
    `)).toBe(true)
    expect(sourceHasSupabaseRuntimeImport("const supabase = require('@supabase/supabase-js')")).toBe(true)
    expect(sourceHasSupabaseRuntimeImport("const supabase = await import('@/lib/supabase')")).toBe(true)
  })
})
