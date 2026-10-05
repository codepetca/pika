import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { selectCiRunner } from '../../scripts/ci-runner-policy.mjs'

const privatePr = { event: 'pull_request', privateRepository: 'true', headRepository: 'codepetca/pika', repository: 'codepetca/pika' }

describe('CI compute routing', () => {
  it('keeps hosted compute until explicitly enabled', () => {
    expect(selectCiRunner(privatePr)).toEqual(['ubuntu-latest'])
    expect(selectCiRunner({ ...privatePr, enabled: 'true' })).toEqual(['self-hosted', 'Linux', 'pika-ci'])
  })
  it('never automatically routes public or fork code to the private runner', () => {
    expect(selectCiRunner({ ...privatePr, enabled: 'true', privateRepository: 'false' })).toEqual(['ubuntu-latest'])
    expect(selectCiRunner({ ...privatePr, enabled: 'true', headRepository: 'someone/pika' })).toEqual(['ubuntu-latest'])
    expect(selectCiRunner({ ...privatePr, enabled: 'true', headRepository: '' })).toEqual(['ubuntu-latest'])
  })
  it('supports an explicit hosted diagnostic despite the enabled default', () => {
    expect(selectCiRunner({ ...privatePr, event: 'workflow_dispatch', enabled: 'true', requested: 'hosted' })).toEqual(['ubuntu-latest'])
  })
  it('allows explicit private dispatch and rejects unsafe or malformed routing', () => {
    expect(selectCiRunner({ ...privatePr, event: 'workflow_dispatch', requested: 'self-hosted' })).toEqual(['self-hosted', 'Linux', 'pika-ci'])
    expect(() => selectCiRunner({ ...privatePr, event: 'workflow_dispatch', requested: 'self-hosted', privateRepository: 'false' })).toThrow(/private/)
    expect(() => selectCiRunner({ ...privatePr, requested: 'anything' })).toThrow(/runner/)
    expect(() => selectCiRunner({ ...privatePr, enabled: 'TRUE' })).toThrow(/PIKA_SELF_HOSTED_CI/)
    expect(() => selectCiRunner({ ...privatePr, event: 'push' })).toThrow(/event/)
  })

  it('changes only heavy-job compute and keeps refusal from triggering database cleanup', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    for (const job of ['classify-changes', 'pr-gate']) {
      const body = workflow.split(`  ${job}:\n`)[1]?.split(/\n  [a-z][a-z-]+:\n/)[0]
      expect(body).toContain('runs-on: ubuntu-latest')
    }
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
    expect(workflow).toContain('CI_REPOSITORY_PRIVATE: ${{ github.event.repository.private }}')
    expect(workflow).toContain('CI_HEAD_REPOSITORY: ${{ github.event.pull_request.head.repo.full_name }}')
  })
})
