import { describe, expect, it, vi } from 'vitest'
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(),
  execFile: vi.fn(() => { throw new Error('CPU fixture forbids native command dispatch') }),
}))
import { createAssignmentListNativeAdapters } from '../../scripts/contextual-assignment-list-proof-platform'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { assignmentListProofWorkdir } from '../../scripts/contextual-assignment-list-proof-path'

describe('existing disposable platform pinned command seam', () => {
  it('uses the supplied pinned transport for status without starting any native command', async () => {
    const fixture = newAssignmentListProofFixture(), run = vi.fn(async () => '{"synthetic":true}')
    const project = 'pika_assignment_list_' + fixture.manifest.syntheticTag.slice(-12)
    const adapters = createAssignmentListNativeAdapters(fixture, { nativeCommand: run })
    expect(await adapters.command({ args: ['status', '--workdir', assignmentListProofWorkdir(project), '-o', 'json'], workdir: assignmentListProofWorkdir(project), timeoutMs: 100 })).toEqual({ synthetic: true })
    expect(run).toHaveBeenCalledExactlyOnceWith('supabase', ['status', '--workdir', assignmentListProofWorkdir(project), '-o', 'json'], { timeout: 100 })
  })
  it('does not allow a generic native override to replace a separately governed provider transport', () => {
    const fixture = newAssignmentListProofFixture()
    const options = { nativeCommand: async () => '', survey263Endpoint: { kind: 'survey263', host: 'unix:///private/tmp/cpu.sock', identity: [1,2,3,4] } } as unknown as NonNullable<Parameters<typeof createAssignmentListNativeAdapters>[1]>
    expect(() => createAssignmentListNativeAdapters(fixture, options)).toThrow()
  })
})
