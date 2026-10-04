import { readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const routeRoot = resolve(process.cwd(), 'src/app/api')
const zodBoundaryBaselinePath = resolve(
  process.cwd(),
  'tests/architecture/api-zod-boundary-baseline.json'
)
const exportedHandlerPattern = /export\s+(?:async\s+function|const)\s+(GET|POST|PATCH|PUT|DELETE)\b/g
const wrappedHandlerPattern = /export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*=\s*withErrorHandler\b/g
const aliasHandlerPattern = /export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*=\s*(GET|POST|PATCH|PUT|DELETE)\b/g
const requestBodyReaderPattern = /\b(?:request|req)\s*\.\s*(?:json|formData)\s*\(/
function hasBodyZodBoundary(source: string): boolean {
  // This remains a debt heuristic, not proof that every mutation path is validated.
  // Trace the parse input, rather than allowing unrelated query/response schemas
  // (or schema naming conventions) to pay down request-body debt.
  type Binding = { inputs: ts.Node[] }
  type Scope = { parent?: Scope; bindings: Map<string, Binding> }
  const file = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true)
  const scopes = new Map<ts.Node, Scope>()
  const root: Scope = { bindings: new Map() }
  const calls: ts.CallExpression[] = []
  const assignments: ts.BinaryExpression[] = []
  function lookup(node: ts.Identifier): Binding | undefined {
    let scope = scopes.get(node)
    while (scope) {
      const binding = scope.bindings.get(node.text)
      if (binding) return binding
      scope = scope.parent
    }
  }
  function register(node: ts.Node, inherited: Scope) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      inherited.bindings.set(node.name.text, { inputs: [node] })
    }
    const scope = ts.isBlock(node) || ts.isFunctionLike(node)
      ? { parent: inherited, bindings: new Map<string, Binding>() } : inherited
    scopes.set(node, scope)
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) {
      scope.bindings.set(node.name.text, { inputs: node.initializer ? [node.initializer] : [] })
    }
    if (ts.isCallExpression(node)) calls.push(node)
    if (ts.isBinaryExpression(node)) assignments.push(node)
    ts.forEachChild(node, child => register(child, scope))
  }
  register(file, root)
  for (const assignment of assignments) {
    if (ts.isIdentifier(assignment.left)
      && assignment.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && assignment.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      lookup(assignment.left)?.inputs.push(assignment.right)
    }
  }
  function derivesFromBody(node: ts.Node, ancestors = new Set<ts.Node>()): boolean {
    if (ancestors.has(node)) return false
    const seen = new Set(ancestors).add(node)
    if (ts.isIdentifier(node)) return lookup(node)?.inputs.some(input => derivesFromBody(input, seen)) ?? false
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
        && /^(?:request|req)$/.test(callee.expression.text)
        && /^(?:json|formData)$/.test(callee.name.text)) return true
      if (ts.isIdentifier(callee) && lookup(callee)?.inputs.some(input => derivesFromBody(input, seen))) return true
      if (ts.isPropertyAccessExpression(callee) && derivesFromBody(callee.expression, seen)) return true
      return node.arguments.some(argument => derivesFromBody(argument, seen))
    }
    if (ts.isFunctionLike(node)) {
      // Local body-reader helpers qualify only through their returned expression;
      // unused reads or nested callbacks do not establish a boundary.
      let result = false
      const visitReturns = (child: ts.Node) => {
        if (ts.isFunctionLike(child)) return
        if (ts.isReturnStatement(child) && child.expression) result ||= derivesFromBody(child.expression, seen)
        else ts.forEachChild(child, visitReturns)
      }
      if ('body' in node && node.body) {
        if (ts.isBlock(node.body)) ts.forEachChild(node.body, visitReturns)
        else result = derivesFromBody(node.body, seen)
      }
      return result
    }
    let result = false
    ts.forEachChild(node, child => { result ||= derivesFromBody(child, seen) })
    return result
  }
  return calls.some(call => ts.isPropertyAccessExpression(call.expression)
    && ts.isIdentifier(call.expression.expression) && /Schema$/.test(call.expression.expression.text)
    && /^(?:parse|safeParse)$/.test(call.expression.name.text)
    && call.arguments.length > 0 && derivesFromBody(call.arguments[0]))
}

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
  it('does not let query or params validation retire request-body debt', () => {
    expect(hasBodyZodBoundary('testQuerySchema.parse({ testId: id })')).toBe(false)
    expect(hasBodyZodBoundary('testParamsSchema.safeParse(params)')).toBe(false)
    expect(hasBodyZodBoundary('const body = await request.json(); testIdentitySchema.parse(params)')).toBe(false)
    expect(hasBodyZodBoundary('const body = await request.json(); responseSchema.parse(result)')).toBe(false)
    expect(hasBodyZodBoundary('const body = await request.json(); querySchema.parse(query)')).toBe(false)
    expect(hasBodyZodBoundary('const body = await request.json(); testQuerySchema.parse(query); testBodySchema.parse(body)')).toBe(true)
  })
  it('tracks body aliases, local readers and multipart metadata without crossing scopes', () => {
    expect(hasBodyZodBoundary('inputSchema.parse(await req.json().catch(() => null))')).toBe(true)
    expect(hasBodyZodBoundary('let pending; pending ??= request.json(); const raw = await pending; inputSchema.safeParse(raw)')).toBe(true)
    expect(hasBodyZodBoundary('async function readJson(request) { return await request.json() }; inputSchema.parse(await readJson(request))')).toBe(true)
    expect(hasBodyZodBoundary('const readBody = async () => { const body = await request.json(); return body }; inputSchema.parse(await readBody())')).toBe(true)
    expect(hasBodyZodBoundary('const form = await request.formData(); const source = form.get("source"); metadataSchema.parse({ source })')).toBe(true)
    expect(hasBodyZodBoundary('const body = await request.json(); function other(body) { return outputSchema.parse(body) }')).toBe(false)
    expect(hasBodyZodBoundary('async function readJson(request) { await request.json(); return params }; inputSchema.parse(await readJson(request))')).toBe(false)
    expect(hasBodyZodBoundary('const body = await request.json(); inputSchema.parse("body")')).toBe(false)
  })
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

  it('does not add body-reading API routes without a Zod boundary schema', () => {
    // This baseline is deletion-only migration debt, not a permanent exemption list.
    const baseline = JSON.parse(readFileSync(zodBoundaryBaselinePath, 'utf8')) as string[]
    const sortedBaseline = [...new Set(baseline)].sort()
    const currentDebt = collectRouteFiles(routeRoot)
      .filter((filePath) => {
        const source = readFileSync(filePath, 'utf8')
        return requestBodyReaderPattern.test(source) && !hasBodyZodBoundary(source)
      })
      .map((filePath) => relative(process.cwd(), filePath))
      .sort()

    expect(baseline).toEqual(sortedBaseline)
    expect(currentDebt).toEqual(sortedBaseline)
  })
})
