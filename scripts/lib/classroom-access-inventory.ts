import ts from 'typescript'

const guardedCalls = new Set([
  'requireRole', 'requireAuth', 'isTeacherEmail',
  'assertTeacherOwnsClassroom', 'assertTeacherCanMutateClassroom', 'assertStudentCanAccessClassroom',
  'authorizeClassroomCoreRequest',
])
export type AccessSignal = { file: string; line: number; signal: string }

/**
 * Review aid, not a proof of authorization coverage. Finds direct named imports,
 * their call aliases, and syntactic role reads/writes/bindings. Role signals can
 * be unrelated (e.g. ARIA/message roles); wrappers, dynamic flows and SQL need review.
 */
export function inventoryClassroomAccess(file: string, source: string): AccessSignal[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const aliases = new Map<string, string>()
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const binding of bindings.elements) {
      const original = (binding.propertyName ?? binding.name).text
      if (guardedCalls.has(original)) aliases.set(binding.name.text, original)
    }
  }
  const signals: AccessSignal[] = []
  const add = (node: ts.Node, signal: string) => signals.push({
    file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, signal,
  })
  const namedRole = (node: ts.Node | undefined) => node &&
    (ts.isIdentifier(node) || ts.isStringLiteral(node)) && node.text === 'role'
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const call = aliases.get(node.expression.text)
      if (call) add(node, call)
    }
    if ((ts.isPropertyAccessExpression(node) && node.name.text === 'role') ||
        (ts.isElementAccessExpression(node) && namedRole(node.argumentExpression))) add(node, 'role-access')
    if (ts.isBindingElement(node) && namedRole(node.propertyName ?? node.name)) add(node, 'role-binding')
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && namedRole(node.name)) add(node, 'role-write')
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return signals
}
