import { describe, expect, it, vi } from 'vitest'
import { createContextualTestAuthoringProgress } from '../../e2e/helpers/contextual-test-authoring-progress'
import { consumeCreatedTestAcknowledgement } from '../../e2e/helpers/contextual-test-workflow'

describe('fixed private authoring diagnostics (not acceptance evidence)', () => {
  it.each([[201, 'created'], [401, 'unauthorized'], [403, 'forbidden'], [404, 'not-found'], [409, 'conflict'], [503, 'unavailable'], [500, 'other-http']] as const)(
    'records status %i without changing the acknowledgement requirement', async (status, label) => {
      const progress = createContextualTestAuthoringProgress(), step = progress.begin('ownerTeacher', 'main')
      const response = { status: () => status, json: vi.fn(() => { throw Error('No second reader') }) }
      const row = { id: '50000000-0000-4000-8000-000000000099', classroom_id: 'private-sentinel' }
      const runtime = { response: vi.fn(async () => ({ test: row })) }
      const operation = consumeCreatedTestAcknowledgement(runtime as never, {} as never, response as never, 'private-sentinel', step)
      if (status === 201) await expect(operation).resolves.toBe(row)
      else await expect(operation).rejects.toThrow('Contextual Tests workflow assertion failed')
      expect(runtime.response).toHaveBeenCalledTimes(status === 201 ? 1 : 0)
      expect(response.json).not.toHaveBeenCalled()
      expect(progress.snapshot()).toEqual({ owner: 'ownerTeacher', kind: 'main', stage: status === 201 ? 'create-identity' : 'create-status', createStatus: label })
      expect(JSON.stringify(progress.snapshot())).not.toContain('private-sentinel')
    })
  it.each(['body', 'identity'])('identifies %s failure without retaining the rejected value or exception', async mode => {
    const progress = createContextualTestAuthoringProgress(), step = progress.begin('ownerStudent', 'single')
    const response = { status: () => 201 }
    const runtime = { response: vi.fn(async () => { if (mode === 'body') throw Error('private-sentinel'); return { test: { id: 'private-sentinel' } } }) }
    await expect(consumeCreatedTestAcknowledgement(runtime as never, {} as never, response as never, 'class', step)).rejects.toThrow()
    expect(progress.snapshot()).toMatchObject({ stage: `create-${mode}`, createStatus: 'created' })
    expect(JSON.stringify(progress.snapshot())).not.toContain('private-sentinel')
  })
  it('retains fixed progress only, rejects unknown input and stale handles, and bounds authoring to the six declared pairs', () => {
    const progress = createContextualTestAuthoringProgress()
    expect(progress.snapshot()).toBeNull()
    expect(() => progress.begin('private-sentinel' as never, 'main')).toThrow()
    const step = progress.begin('ownerTeacher', 'main')
    step.mark('create-status', 201)
    const first = progress.snapshot()
    expect(Object.isFrozen(first)).toBe(true)
    for (const invalid of [NaN, 0, 600, 'private-sentinel']) expect(() => step.mark('create-status', invalid as number)).toThrow()
    expect(() => step.mark('private-sentinel' as never)).toThrow()
    step.mark('save-confirmation')
    expect(first?.stage).toBe('create-status')
    expect(progress.snapshot()).toMatchObject({ stage: 'save-confirmation', createStatus: 'created' })
    expect(() => progress.begin('ownerTeacher', 'main')).toThrow()
    for (const owner of ['ownerTeacher', 'ownerStudent'] as const) for (const kind of ['main', 'single', 'bulk'] as const) {
      if (owner === 'ownerTeacher' && kind === 'main') continue
      progress.begin(owner, kind).mark('complete')
    }
    expect(() => step.mark('complete')).toThrow()
    expect(() => progress.begin('ownerStudent', 'bulk')).toThrow()
    expect(JSON.stringify(progress.snapshot())).not.toContain('private-sentinel')
  })
})
