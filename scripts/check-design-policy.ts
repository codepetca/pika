import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  auditDesignPolicy,
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
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue

    files[relative(repoRoot, absolutePath)] = readFileSync(absolutePath, 'utf8')
  }
  return files
}

function defaultReason(kind: DesignValueKind): DesignValueReason {
  if (kind === 'arbitrary-spacing') return 'layout-geometry'
  if (kind === 'raw-z-index') return 'special-layer'
  return 'legacy-visual-value'
}

const sourceFiles = readSourceFiles(join(repoRoot, 'src'))

if (process.argv.includes('--print-inventory')) {
  const entries = [...inventoryDesignValues(sourceFiles)]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, inventory]) => ({
      file,
      reviewBy: 'phase-2-design-foundation-debt',
      values: [...inventory]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([kind, evidence]) => ({
          kind,
          ...evidence,
          reason: defaultReason(kind),
        })),
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
