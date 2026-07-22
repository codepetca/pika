import ts from 'typescript'
import { z } from 'zod'

export const nativeControlKinds = [
  'button',
  'input:button',
  'input:checkbox',
  'input:color',
  'input:date',
  'input:datetime-local',
  'input:dynamic',
  'input:email',
  'input:file',
  'input:hidden',
  'input:image',
  'input:month',
  'input:number',
  'input:password',
  'input:radio',
  'input:range',
  'input:reset',
  'input:search',
  'input:submit',
  'input:tel',
  'input:text',
  'input:time',
  'input:url',
  'input:week',
  'select',
  'textarea',
] as const

export type NativeControlKind = (typeof nativeControlKinds)[number]

export const nativeControlReasons = [
  'composite-widget',
  'icon-or-inline-action',
  'native-input-capability',
  'native-textarea',
  'legacy-form-control',
] as const

export const nativeControlReviewOwners = [
  'phase-2-shared-foundation-debt',
  'phase-3-assignments',
  'phase-3-calendar-announcements',
  'phase-3-daily-attendance',
  'phase-3-dashboard-roster',
  'phase-3-surveys',
  'phase-3-tests',
  'phase-6-auth-verification',
] as const

const nativeControlExceptionSchema = z.object({
  kind: z.enum(nativeControlKinds),
  count: z.number().int().positive(),
  reason: z.enum(nativeControlReasons),
})

const nativeControlExceptionEntrySchema = z.object({
  file: z.string().regex(/^src\/(app|components)\/.*\.tsx$/),
  reviewBy: z.enum(nativeControlReviewOwners),
  controls: z.array(nativeControlExceptionSchema).min(1),
})

const uiControlExceptionRegistrySchema = z.object({
  version: z.literal(1),
  entries: z.array(nativeControlExceptionEntrySchema),
})

export type UiControlExceptionRegistry = z.infer<typeof uiControlExceptionRegistrySchema>

export type UiPolicyViolation = {
  file: string
  message: string
}

type SourceFiles = Record<string, string>

const bannedLegacyImports = new Map([
  ['@/components/Button', '@/ui'],
  ['@/components/Input', '@/ui'],
  ['@/components/AlertDialog', '@/ui'],
  ['@/components/ConfirmDialog', '@/ui'],
  ['@/components/Tooltip', '@/ui'],
])

const nativeInputCapabilityKinds = new Set<NativeControlKind>([
  'input:checkbox',
  'input:color',
  'input:date',
  'input:datetime-local',
  'input:file',
  'input:hidden',
  'input:image',
  'input:month',
  'input:radio',
  'input:range',
  'input:time',
  'input:week',
])

function isReasonValidForKind(
  kind: NativeControlKind,
  reason: UiControlExceptionRegistry['entries'][number]['controls'][number]['reason'],
) {
  if (kind === 'button') {
    return reason === 'composite-widget'
      || reason === 'icon-or-inline-action'
      || reason === 'legacy-form-control'
  }
  if (kind === 'textarea') return reason === 'native-textarea'
  if (nativeInputCapabilityKinds.has(kind)) return reason === 'native-input-capability'
  return reason === 'legacy-form-control'
}

function shouldInspectNativeControls(file: string) {
  if (!file.endsWith('.tsx')) return false
  if (!file.startsWith('src/app/') && !file.startsWith('src/components/')) return false
  const excludedTiptapRoots = [
    'src/components/tiptap-extension/',
    'src/components/tiptap-icons/',
    'src/components/tiptap-node/',
    'src/components/tiptap-templates/',
    'src/components/tiptap-ui/',
    'src/components/tiptap-ui-primitive/',
  ]
  return !excludedTiptapRoots.some((root) => file.startsWith(root))
}

function getStaticInputKind(value: string): NativeControlKind {
  const normalizedValue = value.toLowerCase()
  return nativeControlKinds.includes(`input:${normalizedValue}` as NativeControlKind)
    ? (`input:${normalizedValue}` as NativeControlKind)
    : 'input:dynamic'
}

function getStaticStringValue(expression: ts.Expression): string | null {
  return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)
    ? expression.text
    : null
}

function getJsxInputKind(node: ts.JsxOpeningLikeElement): NativeControlKind {
  let kind: NativeControlKind = 'input:text'

  for (const attribute of node.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      kind = 'input:dynamic'
      continue
    }
    if (attribute.name.text !== 'type') continue
    if (!attribute.initializer) {
      kind = 'input:dynamic'
      continue
    }
    if (ts.isStringLiteral(attribute.initializer)) {
      kind = getStaticInputKind(attribute.initializer.text)
      continue
    }
    if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
      const value = getStaticStringValue(attribute.initializer.expression)
      kind = value === null ? 'input:dynamic' : getStaticInputKind(value)
      continue
    }
    kind = 'input:dynamic'
  }

  return kind
}

function getNativeControlKind(node: ts.JsxOpeningLikeElement): NativeControlKind | null {
  if (!ts.isIdentifier(node.tagName)) return null

  switch (node.tagName.text) {
    case 'button':
      return 'button'
    case 'input':
      return getJsxInputKind(node)
    case 'select':
      return 'select'
    case 'textarea':
      return 'textarea'
    default:
      return null
  }
}

type ReactCreateElementBindings = {
  factories: Set<string>
  namespaces: Set<string>
}

function getReactCreateElementBindings(sourceFile: ts.SourceFile): ReactCreateElementBindings {
  const bindings: ReactCreateElementBindings = {
    factories: new Set(),
    namespaces: new Set(),
  }

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text === 'react'
    ) {
      const importClause = statement.importClause
      if (importClause?.name) bindings.namespaces.add(importClause.name.text)
      if (importClause?.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
        bindings.namespaces.add(importClause.namedBindings.name.text)
      }
      if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          if ((element.propertyName ?? element.name).text === 'createElement') {
            bindings.factories.add(element.name.text)
          }
        }
      }
    }
  }

  return bindings
}

function getCreateElementInputKind(properties: ts.Expression | undefined): NativeControlKind {
  if (!properties || properties.kind === ts.SyntaxKind.NullKeyword) return 'input:text'
  if (!ts.isObjectLiteralExpression(properties)) return 'input:dynamic'

  let kind: NativeControlKind = 'input:text'
  for (const property of properties.properties) {
    if (ts.isSpreadAssignment(property)) {
      kind = 'input:dynamic'
      continue
    }
    if (!ts.isPropertyAssignment(property)) continue
    const name = property.name
    const propertyName = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null
    if (propertyName !== 'type') continue
    const value = getStaticStringValue(property.initializer)
    kind = value === null ? 'input:dynamic' : getStaticInputKind(value)
  }

  return kind
}

function getCreateElementControlKind(
  node: ts.CallExpression,
  bindings: ReactCreateElementBindings,
): NativeControlKind | null {
  const isFactory =
    (ts.isIdentifier(node.expression) && bindings.factories.has(node.expression.text))
    || (
      ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'createElement'
      && ts.isIdentifier(node.expression.expression)
      && bindings.namespaces.has(node.expression.expression.text)
    )
  if (!isFactory) return null

  const tag = node.arguments[0]
  if (!tag || !ts.isStringLiteral(tag)) return null
  if (tag.text === 'input') return getCreateElementInputKind(node.arguments[1])
  if (tag.text === 'button' || tag.text === 'select' || tag.text === 'textarea') {
    return tag.text
  }
  return null
}

export function inventoryNativeControls(sourceFiles: SourceFiles) {
  const inventory = new Map<string, Map<NativeControlKind, number>>()

  for (const [file, source] of Object.entries(sourceFiles)) {
    if (!shouldInspectNativeControls(file)) continue

    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const createElementBindings = getReactCreateElementBindings(sourceFile)
    const counts = new Map<NativeControlKind, number>()

    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const kind = getNativeControlKind(node)
        if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1)
      }
      if (ts.isCallExpression(node)) {
        const kind = getCreateElementControlKind(node, createElementBindings)
        if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1)
      }
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
    if (counts.size > 0) inventory.set(file, counts)
  }

  return inventory
}

export function parseUiControlExceptionRegistry(value: unknown): UiControlExceptionRegistry {
  const registry = uiControlExceptionRegistrySchema.parse(value)
  const files = new Set<string>()

  for (const entry of registry.entries) {
    if (files.has(entry.file)) {
      throw new Error(`Duplicate native-control registry file: ${entry.file}`)
    }
    files.add(entry.file)

    const kinds = new Set<NativeControlKind>()
    for (const control of entry.controls) {
      if (kinds.has(control.kind)) {
        throw new Error(`Duplicate native-control kind ${control.kind} for ${entry.file}`)
      }
      kinds.add(control.kind)

      if (!isReasonValidForKind(control.kind, control.reason)) {
        throw new Error(
          `Invalid native-control reason ${control.reason} for ${control.kind} in ${entry.file}`,
        )
      }
    }
  }

  return registry
}

function auditImports(sourceFiles: SourceFiles): UiPolicyViolation[] {
  const violations: UiPolicyViolation[] = []

  for (const [file, source] of Object.entries(sourceFiles)) {
    if (!file.startsWith('src/') || (!file.endsWith('.ts') && !file.endsWith('.tsx'))) continue

    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )

    const auditModulePath = (modulePath: string) => {
      if (modulePath.startsWith('@/ui/')) {
        violations.push({
          file,
          message: `Import ${modulePath} through the canonical @/ui barrel.`,
        })
      }

      const replacement = bannedLegacyImports.get(modulePath)
      if (replacement) {
        violations.push({
          file,
          message: `Legacy import ${modulePath} is forbidden; import from ${replacement}.`,
        })
      }
    }

    const visit = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier
        && ts.isStringLiteral(node.moduleSpecifier)
      ) {
        auditModulePath(node.moduleSpecifier.text)
      } else if (
        ts.isImportEqualsDeclaration(node)
        && ts.isExternalModuleReference(node.moduleReference)
        && node.moduleReference.expression
        && ts.isStringLiteral(node.moduleReference.expression)
      ) {
        auditModulePath(node.moduleReference.expression.text)
      } else if (
        ts.isImportTypeNode(node)
        && ts.isLiteralTypeNode(node.argument)
        && ts.isStringLiteral(node.argument.literal)
      ) {
        auditModulePath(node.argument.literal.text)
      } else if (
        ts.isCallExpression(node)
        && node.arguments.length >= 1
        && ts.isStringLiteral(node.arguments[0])
        && (
          node.expression.kind === ts.SyntaxKind.ImportKeyword
          || (ts.isIdentifier(node.expression) && node.expression.text === 'require')
        )
      ) {
        auditModulePath(node.arguments[0].text)
      }

      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return violations
}

export function auditUiPolicy(
  sourceFiles: SourceFiles,
  registry: UiControlExceptionRegistry,
): UiPolicyViolation[] {
  const violations = auditImports(sourceFiles)
  const inventory = inventoryNativeControls(sourceFiles)
  const registryByFile = new Map(registry.entries.map((entry) => [entry.file, entry]))

  for (const [file, counts] of inventory) {
    const entry = registryByFile.get(file)
    if (!entry) {
      violations.push({
        file,
        message: 'Native controls require an entry in scripts/ui-control-exceptions.json.',
      })
      continue
    }

    const expectedByKind = new Map(entry.controls.map((control) => [control.kind, control.count]))
    for (const [kind, actualCount] of counts) {
      const expectedCount = expectedByKind.get(kind)
      if (expectedCount !== actualCount) {
        violations.push({
          file,
          message: `Native control ${kind} count is ${actualCount}; registry expects ${expectedCount ?? 0}.`,
        })
      }
    }
  }

  for (const entry of registry.entries) {
    const counts = inventory.get(entry.file)
    if (!counts) {
      violations.push({
        file: entry.file,
        message: 'Native-control registry entry is stale; the file has no governed native controls.',
      })
      continue
    }

    for (const control of entry.controls) {
      const actualCount = counts.get(control.kind) ?? 0
      if (actualCount !== control.count && actualCount === 0) {
        violations.push({
          file: entry.file,
          message: `Native-control registry entry ${control.kind} is stale; no matching control remains.`,
        })
      }
    }
  }

  return violations.sort((left, right) =>
    left.file.localeCompare(right.file) || left.message.localeCompare(right.message),
  )
}
