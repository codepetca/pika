import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  auditUiPolicy,
  inventoryNativeControls,
  parseUiControlExceptionRegistry,
  type NativeControlKind,
} from './lib/ui-policy'

const repoRoot = process.cwd()
const registryPath = join(repoRoot, 'scripts/ui-control-exceptions.json')

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

const sourceFiles = readSourceFiles(join(repoRoot, 'src'))

if (process.argv.includes('--print-inventory')) {
  const nativeCapabilityKinds = new Set<NativeControlKind>([
    'input:checkbox',
    'input:color',
    'input:date',
    'input:datetime-local',
    'input:file',
    'input:hidden',
    'input:month',
    'input:radio',
    'input:range',
    'input:time',
    'input:week',
  ])
  const entries = [...inventoryNativeControls(sourceFiles)]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, controls]) => ({
      file,
      reviewBy: 'phase-2-shared-foundation-debt',
      controls: [...controls]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([kind, count]) => ({
          kind: kind as NativeControlKind,
          count,
          reason: kind === 'textarea'
              ? 'native-textarea'
              : nativeCapabilityKinds.has(kind)
                ? 'native-input-capability'
                : 'legacy-form-control',
        })),
    }))

  process.stdout.write(`${JSON.stringify({ version: 1, entries }, null, 2)}\n`)
  process.exit(0)
}

const registry = parseUiControlExceptionRegistry(JSON.parse(readFileSync(registryPath, 'utf8')))
const violations = auditUiPolicy(sourceFiles, registry)

if (violations.length > 0) {
  console.error(`UI policy failed with ${violations.length} violation(s):`)
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.message}`)
  }
  process.exit(1)
}

const nativeControlCount = [...inventoryNativeControls(sourceFiles).values()]
  .flatMap((counts) => [...counts.values()])
  .reduce((total, count) => total + count, 0)

process.stdout.write(
  `UI policy passes (${nativeControlCount} registered native controls across ${registry.entries.length} files).\n`,
)
