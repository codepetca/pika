import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
describe('literal unchanged legacy recovery routes', () => {
  for (const [path, digest] of [
    ['src/app/api/teacher/tests/[id]/unsubmit/route.ts', 'a02eedeb576a3faad00566868ffb3434b87f42d19076fc306eaf3c14ac8f9435'],
    ['src/app/api/teacher/tests/[id]/students/[studentId]/attempt/route.ts', '05070144ebca1c83aac5c66ab388578527b1c59d19f27f43e8b4a7d556546398'],
    ['src/app/api/teacher/tests/[id]/students/attempts/bulk-delete/route.ts', '4fbd7ed3619f3baff58032a3266012f983b10c7acc1ee19633abf3d3c9f62c7e'],
  ]) it(path, () => {
    const legacy = readFileSync(path, 'utf8')
      .replace("import { handleContextualTestOwnerRecoveryRequest } from '@/lib/server/contextual-test-owner-recovery'\n", '')
      .replace(/  const contextual = await handleContextualTestOwnerRecoveryRequest\('(unsubmit|delete-single|delete-bulk)', (_request|request), context.params\)\n  if \(contextual\) return contextual\n/, '')
    expect(createHash('sha256').update(legacy).digest('hex')).toBe(digest)
  })
})
