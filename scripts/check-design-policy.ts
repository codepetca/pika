import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  auditDesignPolicy,
  DESIGN_POLICY_EXCLUDED_FILES,
  DESIGN_POLICY_SOURCE_EXTENSIONS,
  inventoryDesignValues,
  parseDesignValueExceptionRegistry,
  type DesignValueKind,
  type DesignValueReason,
} from './lib/design-policy'

const repoRoot = process.cwd()
const registryPath = join(repoRoot, 'scripts/design-value-exceptions.json')

function readSourceFiles(directory: string, files: Record<string, string> = {}) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name)
    if (entry.isDirectory()) {
      readSourceFiles(absolutePath, files)
      continue
    }
    if (!DESIGN_POLICY_SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      continue
    }

    const repoPath = relative(repoRoot, absolutePath)
    if (DESIGN_POLICY_EXCLUDED_FILES.has(repoPath)) continue
    files[repoPath] = readFileSync(absolutePath, 'utf8')
  }
  return files
}

function defaultReason(kind: DesignValueKind, file: string): DesignValueReason {
  if (file.includes('/tiptap-') || file.startsWith('src/styles/_')) {
    return 'third-party-editor'
  }
  if (kind === 'arbitrary-spacing') return 'layout-geometry'
  if (kind === 'raw-z-index') return 'special-layer'
  return 'legacy-visual-value'
}

const sourceFiles = readSourceFiles(join(repoRoot, 'src'))

if (process.argv.includes('--print-inventory')) {
  const previousRegistry = parseDesignValueExceptionRegistry(
    JSON.parse(readFileSync(registryPath, 'utf8')),
  )
  const previousEntries = new Map(
    previousRegistry.entries.map((entry) => [
      entry.file,
      {
        reviewBy: entry.reviewBy,
        values: new Map(entry.values.map((value) => [value.kind, value])),
      },
    ]),
  )
  const entries = [...inventoryDesignValues(sourceFiles)]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, inventory]) => ({
      file,
      reviewBy:
        previousEntries.get(file)?.reviewBy ?? 'phase-2-design-foundation-debt',
      values: [...inventory]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([kind, evidence]) => {
          const previous = previousEntries.get(file)?.values.get(kind)
          return {
            kind,
            ...evidence,
            reason: previous?.reason ?? defaultReason(kind, file),
          }
        }),
    }))

  process.stdout.write(`${JSON.stringify({ version: 1, entries }, null, 2)}\n`)
  process.exit(0)
}

const registry = parseDesignValueExceptionRegistry(
  JSON.parse(readFileSync(registryPath, 'utf8')),
)
const violations = auditDesignPolicy(sourceFiles, registry)

if (violations.length > 0) {
  console.error(`Design policy failed with ${violations.length} violation(s):`)
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.message}`)
  }
  process.exit(1)
}

const valueCount = [...inventoryDesignValues(sourceFiles).values()]
  .flatMap((values) => [...values.values()])
  .reduce((total, evidence) => total + evidence.count, 0)

process.stdout.write(
  `Design policy passes (${valueCount} governed raw values across ${registry.entries.length} files).\n`,
)
