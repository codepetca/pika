/** Explicit disposable diagnostic CLI. Its receipt never accepts the product. */
import { fileURLToPath } from 'node:url'
import { testOwnerReorderDiagnosticLifecycleMain } from './check-contextual-test-owner-reorder-lifecycle'

if (process.argv[1] === fileURLToPath(import.meta.url)) testOwnerReorderDiagnosticLifecycleMain().catch(() => {
  process.stderr.write('FAIL isolated test-owner-reorder diagnostic lifecycle; private details withheld.\n')
  process.exitCode = 1
})
