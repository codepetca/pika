import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from '@/lib/contracts/repolight/manifest.json'
import { publicRepositoryBundleSchema } from '@/lib/contracts/repolight/report/bundle-contract'
import { canonicalRepoLightJson, digestRepoLightJson } from '@/lib/server/repolight-client'
import fixture from './fixture.json'

describe('canonical RepoLight contract parity receipt', () => {
  it('matches every import-rewritten canonical source hash with a truthful upstream receipt', () => {
    expect(manifest.sourceRevision).toMatch(/^[a-f0-9]{40}$/)
    expect(['committed', 'working-tree-snapshot']).toContain(manifest.sourceState)
    expect(manifest.files).toHaveLength(8)
    for (const file of manifest.files) {
      const source = readFileSync(resolve('src/lib/contracts/repolight', file.targetPath), 'utf8')
      expect(createHash('sha256').update(source).digest('hex')).toBe(file.transformedSha256)
      const restored = source.replaceAll("'@/lib/contracts/repolight/", "'@/lib/")
      expect(createHash('sha256').update(restored).digest('hex')).toBe(file.sourceSha256)
    }
  })
  it('preserves canonical bytes, array order and complete synthetic evidence validation', () => {
    expect(fixture.synthetic).toBe(true)
    expect(canonicalRepoLightJson(fixture.envelope)).toBe(fixture.encodedBody)
    expect(digestRepoLightJson(fixture.envelope)).toBe(fixture.requestFingerprint)
    expect(digestRepoLightJson(fixture.bundle)).toBe(fixture.reportDigest)
    expect(publicRepositoryBundleSchema.parse(fixture.bundle)).toEqual(fixture.bundle)
  })
  it.each(['metric', 'partition', 'cross-reference'])('rejects corrupted %s evidence using the unchanged canonical refinements', kind => {
    const bundle = structuredClone(fixture.bundle)
    if (kind === 'metric') bundle.overview.facts.metrics.commits.value++
    if (kind === 'partition') bundle.contributors[0].analysis.facts.commits.pop()
    if (kind === 'cross-reference') bundle.overview.facts.heatmap.cells[0].commitSha = 'f'.repeat(40)
    expect(publicRepositoryBundleSchema.safeParse(bundle).success).toBe(false)
  })
})
