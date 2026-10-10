import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { selectCiRunner } from '../../scripts/ci-runner-policy.mjs'

const sameRepositoryPr = { event: 'pull_request', privateRepository: 'true', headRepository: 'codepetca/pika', repository: 'codepetca/pika' }

describe('CI compute routing', () => {
  it('keeps hosted compute until explicitly enabled', () => {
    expect(selectCiRunner(sameRepositoryPr)).toEqual(['ubuntu-latest'])
    expect(selectCiRunner({ ...sameRepositoryPr, enabled: 'true' })).toEqual(['self-hosted', 'Linux', 'pika-ci'])
  })
  it.each(['true', 'false'])('routes enabled same-repository PRs regardless of visibility (%s)', privateRepository => {
    expect(selectCiRunner({ ...sameRepositoryPr, enabled: 'true', privateRepository })).toEqual(['self-hosted', 'Linux', 'pika-ci'])
  })
  it('keeps fork and missing-source PRs hosted', () => {
    expect(selectCiRunner({ ...sameRepositoryPr, enabled: 'true', headRepository: 'someone/pika' })).toEqual(['ubuntu-latest'])
    expect(selectCiRunner({ ...sameRepositoryPr, enabled: 'true', headRepository: '' })).toEqual(['ubuntu-latest'])
  })
  it('supports an explicit hosted diagnostic despite the enabled default', () => {
    expect(selectCiRunner({ ...sameRepositoryPr, event: 'workflow_dispatch', enabled: 'true', requested: 'hosted' })).toEqual(['ubuntu-latest'])
  })
  it('allows explicit dispatch and rejects unsafe or malformed routing', () => {
    expect(selectCiRunner({ ...sameRepositoryPr, event: 'workflow_dispatch', requested: 'self-hosted' })).toEqual(['self-hosted', 'Linux', 'pika-ci'])
    expect(selectCiRunner({ ...sameRepositoryPr, event: 'workflow_dispatch', requested: 'self-hosted', privateRepository: 'false', headRepository: '' })).toEqual(['self-hosted', 'Linux', 'pika-ci'])
    expect(() => selectCiRunner({ ...sameRepositoryPr, requested: 'self-hosted', headRepository: 'someone/pika' })).toThrow(/same-repository/)
    expect(() => selectCiRunner({ ...sameRepositoryPr, requested: 'self-hosted', repository: '' })).toThrow(/repository/)
    expect(() => selectCiRunner({ ...sameRepositoryPr, requested: 'anything' })).toThrow(/runner/)
    expect(() => selectCiRunner({ ...sameRepositoryPr, enabled: 'TRUE' })).toThrow(/PIKA_SELF_HOSTED_CI/)
    expect(() => selectCiRunner({ ...sameRepositoryPr, event: 'push' })).toThrow(/event/)
  })

  it('changes only heavy-job compute and keeps refusal from triggering database cleanup', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    for (const job of ['classify-changes', 'pr-gate', 'architecture-database-contracts-lifecycle', 'contextual-test-owner-sdk', 'contextual-test-owner-sdk-lifecycle', 'browser-experience-dark']) {
      const body = workflow.split(`  ${job}:\n`)[1]?.split(/\n  [a-z][a-z-]+:\n/)[0]
      expect(body).toContain('runs-on: ubuntu-latest')
    }
    const shard = workflow.split('  contextual-test-owner-sdk:\n')[1]?.split(/\n  [a-z][a-z-]+:\n/)[0]
    expect(shard).not.toContain('fromJSON(needs.classify-changes.outputs.heavy_runner)')
    expect(shard).toContain('node scripts/ci-runner-preflight.mjs --lane test-owner-sdk')
    expect(shard?.indexOf('id: ci-isolation')).toBeLessThan(shard?.indexOf('id: supabase-start') ?? -1)
    expect(shard).toContain("if: always() && steps.ci-isolation.outcome == 'success' && steps.supabase-start.outcome != 'skipped'")
    const lifecycle = workflow.split('  contextual-test-owner-sdk-lifecycle:\n')[1]?.split(/\n  [a-z][a-z-]+:\n/)[0]
    expect(lifecycle).not.toContain('heavy_runner')
    expect(lifecycle).toContain('node scripts/ci-runner-preflight.mjs --lane test-owner-sdk-lifecycle')
    expect(lifecycle?.indexOf('id: ci-isolation')).toBeLessThan(lifecycle?.indexOf('id: supabase-start') ?? -1)
    expect(lifecycle).toContain("if: always() && steps.ci-isolation.outcome == 'success' && steps.supabase-start.outcome != 'skipped'")
    const dark = workflow.split('  browser-experience-dark:\n')[1]?.split(/\n  [a-z][a-z-]+:\n/)[0]
    expect(dark).not.toContain('heavy_runner')
    expect(dark).toContain('node scripts/ci-runner-preflight.mjs --lane browser-dark')
    expect(dark?.indexOf('id: ci-isolation')).toBeLessThan(dark?.indexOf('id: supabase-start') ?? -1)
    expect(dark).toContain("if: always() && steps.ci-isolation.outcome == 'success' && steps.supabase-start.outcome != 'skipped'")
    for (const job of ['architecture-database-contracts', 'test-and-build', 'browser-experience-matrix']) {
      const body = workflow.split(`  ${job}:\n`)[1]?.split(/\n  [a-z][a-z-]+:\n/)[0]
      expect(body).toContain('runs-on: ${{ fromJSON(needs.classify-changes.outputs.heavy_runner) }}')
      expect(body).toContain('node scripts/ci-runner-preflight.mjs --lane')
      if (job !== 'test-and-build') {
        expect(body?.indexOf('id: ci-isolation')).toBeLessThan(body?.indexOf('id: supabase-start') ?? -1)
        const cleanup = body?.split('      - name: Stop ephemeral database')[1]
        expect(cleanup).toContain("if: always() && steps.ci-isolation.outcome == 'success' && steps.supabase-start.outcome != 'skipped'")
        expect(cleanup).toContain('supabase stop --no-backup')
      }
    }
    expect(workflow).toContain('permissions:\n  contents: read')
    expect(workflow).not.toContain('CI_REPOSITORY_PRIVATE:')
    expect(workflow).toContain('CI_HEAD_REPOSITORY: ${{ github.event.pull_request.head.repo.full_name }}')
  })
})
