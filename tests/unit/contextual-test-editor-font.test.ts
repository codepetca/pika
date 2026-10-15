import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { applyContextualTestFontOverlay, contextualTestFontOverlay as overlay, contextualTestFontOverlaySha256 } from '../../e2e/helpers/contextual-test-font-overlay'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'
import { captureContextualTestSource, prepareContextualTestAppSnapshot } from '../../scripts/contextual-test-rehearsal-launch'
import { assignmentListProofWorkdir } from '../../scripts/contextual-assignment-list-proof-path'

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
// Supports the owner's uncommitted candidate during visual review and the
// committed original after restoration. Both full byte hashes remain fixed.
function original() {
  const bytes = readFileSync(overlay.path)
  const comment = '// Use locally available fonts and the existing fallback without a remote fetch.\n'
  return bytes.subarray(0, comment.length).toString() === comment
    ? Buffer.from(bytes.toString().replace(comment, '@import url("https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap");\n\n'))
    : bytes
}

describe('exact disposable editor font overlay (CPU/filesystem only)', () => {
  it('binds the single deterministic candidate, preserving every byte after the import', () => {
    const before = original(), after = applyContextualTestFontOverlay(overlay.path, before)
    expect(sha(before)).toBe(overlay.beforeSha256); expect(sha(after)).toBe(overlay.afterSha256)
    expect(after.toString()).not.toMatch(/@import\s+url\(|fonts\.(?:googleapis|gstatic)\.com/)
    expect(after.toString()).toContain('font-family: "DM Sans", sans-serif;')
    expect(before.toString().slice(before.indexOf('// Scoped'))).toBe(after.toString().slice(after.indexOf('// Scoped')))
    expect(contextualTestFontOverlaySha256).toBe(sha(JSON.stringify(overlay)))
    expect(createContextualTestPlan('pika_assignment_list_123456abcdef').appOverlaySha256).toBe(contextualTestFontOverlaySha256)
    expect(() => applyContextualTestFontOverlay('another.scss', before)).toThrow()
    expect(() => applyContextualTestFontOverlay(overlay.path, Buffer.concat([before, Buffer.from('\n')]))).toThrow()
    expect(() => applyContextualTestFontOverlay(overlay.path, after)).toThrow()
  })
  it('copies frozen bytes and applies the overlay only to the disposable destination', () => {
    const repository = realpathSync(mkdtempSync(join(tmpdir(), 'contextual-font-source-cpu-')))
    const dependencyRoot = realpathSync(mkdtempSync(join(tmpdir(), 'contextual-font-deps-cpu-')))
    const projectId = `pika_assignment_list_${randomBytes(6).toString('hex')}`, plan = createContextualTestPlan(projectId)
    const workdir = assignmentListProofWorkdir(projectId), appDir = join(workdir, 'app'), before = original()
    mkdirSync(workdir, { mode: 0o700 })
    try {
      const file = join(repository, overlay.path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, before)
      const sentinel = Buffer.from('source sentinel\n'); writeFileSync(join(repository, 'sentinel.txt'), sentinel)
      const entries = [[overlay.path, before], ['sentinel.txt', sentinel]].map(([path, content]) => ({ path: path as string, mode: '100644' as const,
        sha256: sha(content as Buffer), blob: createHash('sha1').update(`blob ${(content as Buffer).length}\0`).update(content as Buffer).digest('hex') }))
      const source = { repository, head: plan.sourceSha, tree: plan.sourceTree, entries, sha256: sha(JSON.stringify(entries)), bytes: before.length + sentinel.length }
      const prepared = prepareContextualTestAppSnapshot(source, { projectId, workdir, appDir }, dependencyRoot, [dependencyRoot], Date.now() + 10000)
      expect(prepared.appOverlaySha256).toBe(plan.appOverlaySha256)
      expect(sha(readFileSync(join(appDir, overlay.path)))).toBe(overlay.afterSha256)
      expect(readFileSync(file).equals(before)).toBe(true)
      expect(readFileSync(join(appDir, 'sentinel.txt')).equals(sentinel)).toBe(true)
      expect(() => prepareContextualTestAppSnapshot({ ...source, entries: [] }, { projectId, workdir, appDir }, dependencyRoot, [dependencyRoot], Date.now() + 10000)).toThrow()
    } finally { rmSync(workdir, { recursive: true }); rmSync(repository, { recursive: true }); rmSync(dependencyRoot, { recursive: true }) }
  })
  it('still rejects dirty original source before copying or accepting an overlay', async () => {
    const plan = createContextualTestPlan('pika_assignment_list_123456abcdef')
    const command = vi.fn(async (_file: string, args: string[]) => args.includes('HEAD') ? plan.sourceSha : args.includes('HEAD^{tree}') ? plan.sourceTree : ' M candidate.scss')
    await expect(captureContextualTestSource('/cpu/frozen', plan.sourceSha, plan.sourceTree, command, Date.now() + 10000)).rejects.toThrow()
    expect(command.mock.calls).toHaveLength(3)
  })
})
