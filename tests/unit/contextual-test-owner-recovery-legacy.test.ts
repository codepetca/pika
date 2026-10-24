import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
describe('attested legacy recovery routes with content-free diagnostics', () => {
  // October24 diagnostic adoption intentionally refreshes these exact seals:
  // one logger import per route and respectively three, two and two log calls.
  // Only the original dormant dispatcher is normalized; no logging is stripped.
  // See docs/guidance/application-log-privacy.md for scope and behavioral evidence.
  for (const [path, digest] of [
    ['src/app/api/teacher/tests/[id]/unsubmit/route.ts', 'b28c61d441c5578f2866ff8990496d4f6d809c301037ad1878419b4be93f4357'],
    ['src/app/api/teacher/tests/[id]/students/[studentId]/attempt/route.ts', '322f40656872ece7332e2374700126410049566f81ed58f5f0bd7fdfba59bec4'],
    ['src/app/api/teacher/tests/[id]/students/attempts/bulk-delete/route.ts', '494b1d11677bf03de28ba16ba2ed0530bbb7a9d54764b1de1b28c1f149b05202'],
  ]) it(path, () => {
    const legacy = readFileSync(path, 'utf8')
      .replace("import { handleContextualTestOwnerRecoveryRequest } from '@/lib/server/contextual-test-owner-recovery'\n", '')
      .replace(/  const contextual = await handleContextualTestOwnerRecoveryRequest\('(unsubmit|delete-single|delete-bulk)', (_request|request), context.params\)\n  if \(contextual\) return contextual\n/, '')
    expect(createHash('sha256').update(legacy).digest('hex')).toBe(digest)
  })
})
