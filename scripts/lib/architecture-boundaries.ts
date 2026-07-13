import { readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import ts from 'typescript'

export type SourceImport = {
  specifier: string
  runtime: boolean
  target: string | null
}

export type SourceModule = {
  filePath: string
  imports: SourceImport[]
  isClientEntry: boolean
}

export type SourceGraph = Map<string, SourceModule>

export type ArchitectureViolation = {
  id: string
  rule: string
  message: string
  chain?: string[]
}

type UnresolvedSourceImport = Omit<SourceImport, 'target'>

const sourceFilePattern = /\.(ts|tsx)$/
const declarationFilePattern = /\.d\.ts$/
const forbiddenBrowserSpecifiers = new Set([
  '@/lib/supabase',
  '@supabase/supabase-js',
  'next/headers',
  'next/server',
  'server-only',
])
const nodeBuiltinSpecifiers = new Set(
  builtinModules.flatMap((specifier) => [specifier, `node:${specifier}`]),
)

function normalizeFilePath(filePath: string): string {
  return filePath.split(path.sep).join('/')
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
    if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) {
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

function exportDeclarationHasRuntimeBinding(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false
  if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) return true

  return node.exportClause.elements.some((element) => !element.isTypeOnly)
}

function collectRuntimeAwareImports(sourceFile: ts.SourceFile): UnresolvedSourceImport[] {
  const imports: UnresolvedSourceImport[] = []

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push({
        specifier: statement.moduleSpecifier.text,
        runtime: importDeclarationHasRuntimeBinding(statement),
      })
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      imports.push({
        specifier: statement.moduleSpecifier.text,
        runtime: exportDeclarationHasRuntimeBinding(statement),
      })
    }
  }

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      imports.push({ specifier: node.arguments[0].text, runtime: true })
    }

    ts.forEachChild(node, visit)
  }

  ts.forEachChild(sourceFile, visit)
  return imports
}

function resolveInternalImport(
  filePaths: Set<string>,
  fromFilePath: string,
  specifier: string,
): string | null {
  const unresolvedPath = specifier.startsWith('@/')
    ? `src/${specifier.slice(2)}`
    : specifier.startsWith('.')
      ? path.posix.normalize(path.posix.join(path.posix.dirname(fromFilePath), specifier))
      : null

  if (!unresolvedPath) return null

  const candidates = [
    unresolvedPath,
    `${unresolvedPath}.ts`,
    `${unresolvedPath}.tsx`,
    `${unresolvedPath}/index.ts`,
    `${unresolvedPath}/index.tsx`,
  ]

  return candidates.find((candidate) => filePaths.has(candidate)) ?? null
}

export function createSourceGraphFromSources(sources: Record<string, string>): SourceGraph {
  const normalizedSources = new Map(
    Object.entries(sources).map(([filePath, source]) => [normalizeFilePath(filePath), source]),
  )
  const filePaths = new Set(normalizedSources.keys())

  return new Map(
    Array.from(normalizedSources, ([filePath, source]) => {
      const sourceFile = parseSourceFile(filePath, source)
      const imports = collectRuntimeAwareImports(sourceFile).map((sourceImport) => ({
        ...sourceImport,
        target: resolveInternalImport(filePaths, filePath, sourceImport.specifier),
      }))

      return [
        filePath,
        {
          filePath,
          imports,
          isClientEntry: hasUseClientDirective(sourceFile),
        },
      ]
    }),
  )
}

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.resolve(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(entryPath)

    return sourceFilePattern.test(entry.name) && !declarationFilePattern.test(entry.name)
      ? [entryPath]
      : []
  })
}

export function createSourceGraph(projectRoot = process.cwd()): SourceGraph {
  const sourceRoot = path.resolve(projectRoot, 'src')
  const sources = Object.fromEntries(
    collectSourceFiles(sourceRoot).map((filePath) => [
      normalizeFilePath(path.relative(projectRoot, filePath)),
      readFileSync(filePath, 'utf8'),
    ]),
  )

  return createSourceGraphFromSources(sources)
}

type LayerRule = {
  name: string
  from: (filePath: string) => boolean
  forbids: (filePath: string) => boolean
  runtimeOnly?: boolean
}

const layerRules: LayerRule[] = [
  {
    name: 'lib-no-presentation',
    from: (filePath) => filePath.startsWith('src/lib/'),
    forbids: (filePath) => /^src\/(app|components|hooks|ui)(\/|$)/.test(filePath),
  },
  {
    name: 'ui-is-leaf',
    from: (filePath) => filePath.startsWith('src/ui/'),
    forbids: (filePath) => /^src\/(app|components|hooks)(\/|$)/.test(filePath) || filePath.startsWith('src/lib/server/'),
  },
  {
    name: 'api-no-presentation',
    from: (filePath) => filePath.startsWith('src/app/api/'),
    forbids: (filePath) =>
      /^src\/(components|hooks|ui)(\/|$)/.test(filePath) ||
      (filePath.startsWith('src/app/') && !filePath.startsWith('src/app/api/')),
  },
  {
    name: 'presentation-no-server',
    from: (filePath) => /^src\/(components|hooks)(\/|$)/.test(filePath),
    forbids: (filePath) =>
      filePath.startsWith('src/lib/server/') || filePath.startsWith('src/app/api/'),
  },
  {
    name: 'types-runtime-is-leaf',
    from: (filePath) => filePath.startsWith('src/types/'),
    forbids: (filePath) => !filePath.startsWith('src/types/'),
    runtimeOnly: true,
  },
]

export function findLayerBoundaryViolations(graph: SourceGraph): ArchitectureViolation[] {
  const violations = new Map<string, ArchitectureViolation>()

  for (const sourceModule of graph.values()) {
    for (const sourceImport of sourceModule.imports) {
      if (!sourceImport.target) continue

      for (const rule of layerRules) {
        if (rule.runtimeOnly && !sourceImport.runtime) continue
        if (!rule.from(sourceModule.filePath) || !rule.forbids(sourceImport.target)) continue

        const id = `layer:${rule.name}:${sourceModule.filePath}->${sourceImport.target}`
        violations.set(id, {
          id,
          rule: rule.name,
          message: `${sourceModule.filePath} imports forbidden layer ${sourceImport.target}`,
        })
      }
    }
  }

  return Array.from(violations.values()).sort((left, right) => left.id.localeCompare(right.id))
}

function isForbiddenBrowserSpecifier(specifier: string): boolean {
  return forbiddenBrowserSpecifiers.has(specifier) || nodeBuiltinSpecifiers.has(specifier)
}

function isServerOnlyModule(filePath: string): boolean {
  return (
    filePath === 'src/lib/supabase.ts' ||
    filePath.startsWith('src/lib/server/') ||
    filePath.startsWith('src/app/api/')
  )
}

export function findBrowserBoundaryViolations(graph: SourceGraph): ArchitectureViolation[] {
  const violations = new Map<string, ArchitectureViolation>()
  const clientEntries = Array.from(graph.values()).filter((sourceModule) => sourceModule.isClientEntry)

  for (const clientEntry of clientEntries) {
    const queue = [{ filePath: clientEntry.filePath, chain: [clientEntry.filePath] }]
    const visited = new Set([clientEntry.filePath])

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]
      const sourceModule = graph.get(current.filePath)
      if (!sourceModule) continue

      for (const sourceImport of sourceModule.imports) {
        if (!sourceImport.runtime) continue

        if (isForbiddenBrowserSpecifier(sourceImport.specifier)) {
          const id = `browser-runtime:${clientEntry.filePath}->${sourceImport.specifier}`
          violations.set(id, {
            id,
            rule: 'browser-runtime',
            message: `${current.chain.join(' -> ')} imports server runtime ${sourceImport.specifier}`,
            chain: current.chain,
          })
          continue
        }

        if (!sourceImport.target) continue

        const nextChain = [...current.chain, sourceImport.target]
        if (isServerOnlyModule(sourceImport.target)) {
          const id = `browser-server:${clientEntry.filePath}->${sourceImport.target}`
          violations.set(id, {
            id,
            rule: 'browser-server',
            message: `${nextChain.join(' -> ')} crosses into a server-only module`,
            chain: nextChain,
          })
          continue
        }

        if (!visited.has(sourceImport.target)) {
          visited.add(sourceImport.target)
          queue.push({ filePath: sourceImport.target, chain: nextChain })
        }
      }
    }
  }

  return Array.from(violations.values()).sort((left, right) => left.id.localeCompare(right.id))
}

export function evaluateArchitectureBaseline(
  violations: ArchitectureViolation[],
  baseline: string[],
): { unexpected: ArchitectureViolation[]; stale: string[] } {
  const baselineIds = new Set(baseline)
  const violationIds = new Set(violations.map((violation) => violation.id))

  return {
    unexpected: violations.filter((violation) => !baselineIds.has(violation.id)),
    stale: Array.from(baselineIds).filter((id) => !violationIds.has(id)).sort(),
  }
}
