import { readFileSync } from 'node:fs'
import { createSourceGraph } from './lib/architecture-boundaries'
import { inventoryClassroomAccess } from './lib/classroom-access-inventory'

// stdout only; never reads environment files, database records or runtime users.
const signals = [...createSourceGraph().keys()].sort()
  .filter((file) => file !== 'src/types/database.generated.ts')
  .flatMap((file) => inventoryClassroomAccess(file, readFileSync(file, 'utf8')))
const counts: Record<string, number> = {}
for (const { signal } of signals) counts[signal] = (counts[signal] ?? 0) + 1
process.stdout.write(JSON.stringify({
  scope: 'src TS/TSX, excluding generated database types; includes development fixtures; syntactic signals only',
  files: new Set(signals.map(({ file }) => file)).size,
  counts,
  signals,
}, null, 2) + '\n')
