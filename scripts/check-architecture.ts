import baseline from './architecture-baseline.json'
import {
  createSourceGraph,
  evaluateArchitectureBaseline,
  findBrowserBoundaryViolations,
  findLayerBoundaryViolations,
} from './lib/architecture-boundaries'

const graph = createSourceGraph()
const violations = [
  ...findLayerBoundaryViolations(graph),
  ...findBrowserBoundaryViolations(graph),
]
const baselineIds = baseline.allowedViolations.map((entry) => entry.id)
const duplicateBaselineIds = baselineIds.filter((id, index) => baselineIds.indexOf(id) !== index)
const { unexpected, stale } = evaluateArchitectureBaseline(violations, baselineIds)

if (duplicateBaselineIds.length > 0) {
  console.error('Architecture baseline contains duplicate entries:')
  for (const id of duplicateBaselineIds) console.error(`  - ${id}`)
}

if (unexpected.length > 0) {
  console.error('New architecture boundary violations:')
  for (const violation of unexpected) console.error(`  - ${violation.id}\n    ${violation.message}`)
}

if (stale.length > 0) {
  console.error('Obsolete architecture baseline entries must be removed:')
  for (const id of stale) console.error(`  - ${id}`)
}

if (duplicateBaselineIds.length > 0 || unexpected.length > 0 || stale.length > 0) {
  process.exitCode = 1
} else {
  process.stdout.write(
    `Architecture boundaries pass (${graph.size} modules, ${baselineIds.length} deletion-only allowances).\n`,
  )
}
