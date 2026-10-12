import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
describe('literal retained unpublish legacy branch', () => {
  it('removing only contextual import and dispatch restores the original route', () => {
    const source = readFileSync('src/app/api/teacher/tests/[id]/unpublish/route.ts', 'utf8')
    expect(source).toContain('handleContextualTestOwnerUnpublicationRequest(request, context.params)')
    const retained = source.replace("import { handleContextualTestOwnerUnpublicationRequest } from '@/lib/server/contextual-test-owner-unpublication'\n", '').replace('  const contextual = await handleContextualTestOwnerUnpublicationRequest(request, context.params)\n  if (contextual) return contextual\n', '')
    expect(createHash('sha256').update(retained).digest('hex')).toBe('045f76adebcad1e769eed76eff528ebeb949647a4c0d58c1dc89035d9cf745ce')
  })
})
