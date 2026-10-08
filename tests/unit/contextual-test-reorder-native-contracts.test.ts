import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
const processes = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn(), inventory: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: processes.spawn, execFile: processes.execFile }))
vi.mock('../../scripts/contextual-test-draft-save-proof-inventory', () => ({ draftSaveProofDockerInventory: processes.inventory }))
import * as native from '../../scripts/contextual-test-draft-save-native-contracts'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerReorderFixture, testOwnerReorderSetupSql } from '../../scripts/contextual-test-reorder-proof-fixture'
import { newTestOwnerCreateFixture } from '../../scripts/contextual-test-owner-create-proof-fixture'
import { newTestOwnerPristineDiscardFixture } from '../../scripts/contextual-test-pristine-discard-proof-fixture'
import { newTestOwnerPublicationFixture } from '../../scripts/contextual-test-publication-proof-fixture'
import { TEST_OWNER_REORDER_SOURCE_SHA256 } from '../../scripts/contextual-test-reorder-db-contracts'
import { testOwnerDigest } from '../../scripts/contextual-test-owner-detail-proof-fixture'

const original = newAssignmentListProofFixture(new Date('2026-10-07T03:00:00Z'))
const fixture = newTestOwnerReorderFixture(original)
const head = 'a'.repeat(40)
const repository = process.cwd()

describe('closed inert native reorder profile', () => {
  it('exposes only the three fixed254 entrypoints and performs no native work during construction', () => {
    expect(typeof native.buildTestOwnerReorderNativeContractsManifest).toBe('function')
    expect(typeof native.validateTestOwnerReorderNativeSql).toBe('function')
    expect(typeof native.createTestOwnerReorderNativeContracts).toBe('function')
    const manifest = native.buildTestOwnerReorderNativeContractsManifest(original, fixture, head, repository)
    expect(manifest.sourceSha256).toBe(TEST_OWNER_REORDER_SOURCE_SHA256)
    expect(Object.isFrozen(manifest.contracts.contracts)).toBe(true)
    expect(Object.isFrozen(manifest.concurrency.schedules)).toBe(true)
    expect(Object.isFrozen(manifest.committed.steps)).toBe(true)
    expect(processes.spawn).not.toHaveBeenCalled(); expect(processes.execFile).not.toHaveBeenCalled(); expect(processes.inventory).not.toHaveBeenCalled()
    expect(native).not.toHaveProperty('createNativeOwnerContracts')
    expect(native).not.toHaveProperty('snapshotPrivilegeSql')
  })
  it('retains every runtime cap and presence-only setup with28batches/21rollback/7committed schedules', () => {
    const manifest = native.buildTestOwnerReorderNativeContractsManifest(original, fixture, head, repository)
    const older = [native.buildDraftSaveNativeContractsManifest(original, head, repository),
      native.buildTestOwnerCreateNativeContractsManifest(original, newTestOwnerCreateFixture(original), head, repository),
      native.buildTestOwnerPristineDiscardNativeContractsManifest(original, newTestOwnerPristineDiscardFixture(original), head, repository),
      native.buildTestOwnerPublicationNativeContractsManifest(original, newTestOwnerPublicationFixture(original), head, repository)]
    for (const previous of older) expect(manifest.capabilities).toEqual(previous.capabilities)
    expect(manifest.capabilities).toMatchObject({ outputBytes: 8388608, totalBytes: 67108864, actionMs: 90000, totalMs: 900000 })
    expect(manifest.setup).not.toMatch(/\b(?:insert|update|delete|commit)\b/i)
    expect(manifest.setup).toContain('Migration254 fixture presence differs')
    expect(manifest.setup).toContain('<>3012')
    expect(manifest.contracts.contracts).toHaveLength(28)
    expect(manifest.concurrency.schedules).toHaveLength(21)
    expect(manifest.concurrency.caps.dispatches).toBe(42)
    expect(manifest.concurrency.caps.totalMs).toBe(180000)
    expect(manifest.committed.schedules).toHaveLength(7)
    expect(Object.isFrozen(manifest.committed.schedules)).toBe(true)
    expect(manifest.committed.steps).toHaveLength(31)
    expect(manifest.committed.caps.dispatches).toBe(31)
    expect(manifest.committed.sourceSha256).toBe(manifest.sourceSha256)
    expect(manifest.committed.projectId).toBe(manifest.contracts.projectId)
    expect(manifest.committed.schedules).toEqual(['create-freshness', 'delete-freshness', 'reparent-freshness', 'archive-freshness', 'last-writer', 'owner-freshness', 'legacy-max'])
  })
  it('binds the sole privilege probe to exactly the four-argument service RPC', () => {
    const manifest = native.buildTestOwnerReorderNativeContractsManifest(original, fixture, head, repository)
    const signature = 'reorder_tests_for_owner_v1(uuid,uuid,uuid[],timestamp with time zone)'
    expect(manifest.privilege.catalog).toContain(signature)
    expect(manifest.privilege.revoke).toContain(signature)
    expect(manifest.privilege.restore).toContain(signature)
    expect(manifest.privilege.expectedEvidence).toEqual({ status: 503, rpcCalls: 1, rawCode: '42501' })
    expect(manifest).not.toHaveProperty('innerPrivilege')
    expect(manifest).not.toHaveProperty('publicationPrivileges')
  })
  it('admits each literal fixed batch, rollback action and committed step with no substitutions or restoration dispatch', () => {
    const manifest = native.buildTestOwnerReorderNativeContractsManifest(original, fixture, head, repository)
    expect(manifest.contracts.contracts).toHaveLength(28)
    expect(native.validateTestOwnerReorderNativeSql(manifest,
      manifest.contracts.contracts[1].sql + manifest.contracts.contracts[2].sql)).toBe(false)
    const allowed = [manifest.setup, manifest.snapshot, manifest.bootstrap, manifest.close, manifest.privilege.catalog, manifest.privilege.revoke,
      ...manifest.contracts.contracts.map(batch => batch.sql), ...manifest.concurrency.schedules.flatMap(schedule => [schedule.holderSql, schedule.rejectSql]),
      ...manifest.committed.steps.map(step => step.sql)]
    for (const sql of allowed) {
      expect(native.validateTestOwnerReorderNativeSql(manifest, sql)).toBe(true)
      expect(native.validateTestOwnerReorderNativeSql(manifest, sql + ' select 1;')).toBe(false)
    }
    for (const sql of [manifest.privilege.restore, manifest.termination, 'delete from public.users;', 'select 1;',
      testOwnerReorderSetupSql(fixture, `pika_assignment_list_${fixture.tag.slice(-12)}`), 'x'.repeat(262145)])
      expect(native.validateTestOwnerReorderNativeSql(manifest, sql)).toBe(false)
    const prior = native.buildDraftSaveNativeContractsManifest(original, head, repository)
    expect(native.validateTestOwnerReorderNativeSql(manifest, prior.contracts.contracts)).toBe(false)
    expect(native.validateTestOwnerReorderNativeSql({ ...manifest, committed: structuredClone(manifest.committed) }, manifest.committed.steps[0].sql)).toBe(false)
    const publication = native.buildTestOwnerPublicationNativeContractsManifest(original, newTestOwnerPublicationFixture(original), head, repository)
    expect(native.validateTestOwnerPublicationNativeSql(publication, manifest.committed.steps[0].sql)).toBe(false)
  })
  it('requires the complete frozen fixture and exact reviewed HEAD before process work', () => {
    for (const bad of [{ ...fixture, cases: [] }, { ...fixture, questions: [] }, structuredClone(fixture)]) {
      expect(() => native.buildTestOwnerReorderNativeContractsManifest(original, bad, head, repository)).toThrow()
    }
    expect(() => native.buildTestOwnerReorderNativeContractsManifest(original, fixture, 'main', repository)).toThrow()
    expect(processes.spawn).not.toHaveBeenCalled(); expect(processes.execFile).not.toHaveBeenCalled()
  })
  it('requires one existing absolute deadline and exposes only fixed reorder privilege/committed capabilities', () => {
    const manifest = native.buildTestOwnerReorderNativeContractsManifest(original, fixture, head, repository)
    const input = { repository, reviewedHead: head, original, fixture, containerId: 'b'.repeat(64), capturedResources: [],
      acceptedManifestSha256: testOwnerDigest(JSON.stringify(manifest)) }
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000000)
    try {
      for (const absoluteDeadline of [NaN, Infinity, -Infinity, 1000000, 1900001, 1000000.5])
        expect(() => native.createTestOwnerReorderNativeContracts({ ...input, absoluteDeadline })).toThrow()
      const facade = native.createTestOwnerReorderNativeContracts({ ...input, absoluteDeadline: 1000100 })
      expect(Object.keys(facade).sort()).toEqual(['diagnostic', 'manifest', 'probeReorderPrivilegeDrift', 'run', 'runCommittedTransitions', 'setup', 'verifyTarget'])
      expect(facade.diagnostic()).toContain('DIAG test-owner-reorder native')
      expect(() => native.createTestOwnerReorderNativeContracts({ ...input, acceptedManifestSha256: 'f'.repeat(64), absoluteDeadline: 1000100 })).toThrow()
      expect(processes.spawn).not.toHaveBeenCalled(); expect(processes.execFile).not.toHaveBeenCalled()
    } finally { clock.mockRestore() }
  })
  it('uses unchanged cleanup/guards and binds DB dispatch to the supplied deadline', () => {
    const source = readFileSync('scripts/contextual-test-draft-save-native-contracts.ts', 'utf8')
    expect(source).toContain('runTestOwnerReorderDbContracts(manifest.contracts, bound, d, absoluteDeadline)')
    expect(source).toContain('singleMs: 35000')
    expect(source).toContain("assert.deepEqual(await single(manifest.snapshot), before, 'Rollback contract whole-row equality differs')")
    expect(source).toContain("assert.deepEqual(await single(manifest.snapshot), before, 'Rollback schedule whole-row equality differs')")
    expect(source).toContain('runTestOwnerReorderCommittedTransitions(manifest.committed, bound, d, absoluteDeadline)')
    expect(source).toContain('assert(setupDone && ran && runDone && !committedRan && !probing && sessions.size === 0)')
    expect(source).toContain("if (profile.committedOuterPrivilege) assert(completedProbes.has('outer'))")
    expect(source).toContain('if (profile.publicationPrivileges) assert(Object.keys(profile.publicationPrivileges).every(k => probed.has(k as PublicationPrivilegeKind)))')
    expect(source).toContain('if (profile.publicationPrivileges) publicationRaceDeadline = Date.now() + 180000')
    expect(source).toContain('T = Awaited<ReturnType<typeof runTestOwnerPublicationCommittedTransitions>>')
    expect(source.indexOf('committedRan = true; check()')).toBeLessThan(source.indexOf('await profile.runCommitted('))
    expect(source.indexOf('runDone = true')).toBeGreaterThan(source.indexOf("'Rollback schedule whole-row equality differs'"))
    expect(source.indexOf('completedProbes.add(kind)')).toBeGreaterThan(source.indexOf('assert.deepEqual(await restorationControl(manifest.snapshot), rowsBefore)'))
    expect(source).toContain("assert.equal(await command('git', ['status', '--porcelain']), '')")
    expect(source).not.toMatch(/export (?:type|interface) NativeOwnerProfile/)
  })
  it('rejects premature committed dispatch without invoking any native process or caller SQL', async () => {
    const manifest = native.buildTestOwnerReorderNativeContractsManifest(original, fixture, head, repository)
    const facade = native.createTestOwnerReorderNativeContracts({ repository, reviewedHead: head, original, fixture,
      containerId: 'b'.repeat(64), capturedResources: [], acceptedManifestSha256: testOwnerDigest(JSON.stringify(manifest)),
      absoluteDeadline: Date.now() + 10000 })
    await expect(facade.runCommittedTransitions()).rejects.toThrow()
    await expect(facade.runCommittedTransitions()).rejects.toThrow()
    expect(processes.spawn).not.toHaveBeenCalled(); expect(processes.execFile).not.toHaveBeenCalled(); expect(processes.inventory).not.toHaveBeenCalled()
  })
  it('keeps249–251 committed capabilities stripped while252 retains its four privilege operations', () => {
    const input = { repository, reviewedHead: head, original, containerId: 'b'.repeat(64), capturedResources: [] }
    const draft = native.buildDraftSaveNativeContractsManifest(original, head, repository)
    expect(native.createDraftSaveNativeContracts({ ...input, acceptedManifestSha256: testOwnerDigest(JSON.stringify(draft)) })).not.toHaveProperty('runCommittedTransitions')
    const createFixture = newTestOwnerCreateFixture(original)
    const create = native.buildTestOwnerCreateNativeContractsManifest(original, createFixture, head, repository)
    expect(native.createTestOwnerCreateNativeContracts({ ...input, fixture: createFixture, acceptedManifestSha256: testOwnerDigest(JSON.stringify(create)) })).not.toHaveProperty('runCommittedTransitions')
    const discardFixture = newTestOwnerPristineDiscardFixture(original)
    const discard = native.buildTestOwnerPristineDiscardNativeContractsManifest(original, discardFixture, head, repository)
    expect(native.createTestOwnerPristineDiscardNativeContracts({ ...input, fixture: discardFixture, acceptedManifestSha256: testOwnerDigest(JSON.stringify(discard)) })).not.toHaveProperty('runCommittedTransitions')
    const publicationFixture = newTestOwnerPublicationFixture(original)
    const publication = native.buildTestOwnerPublicationNativeContractsManifest(original, publicationFixture, head, repository)
    const facade = native.createTestOwnerPublicationNativeContracts({ ...input, fixture: publicationFixture,
      acceptedManifestSha256: testOwnerDigest(JSON.stringify(publication)), absoluteDeadline: Date.now() + 10000 })
    for (const name of ['runCommittedTransitions', 'probePublicationSnapshotPrivilegeDrift', 'probePublicationPrivilegeDrift', 'probeLegacyPublicationPrivilegeDrift', 'probeActivationPrivilegeDrift']) expect(facade).toHaveProperty(name)
    expect(facade).not.toHaveProperty('probeReorderPrivilegeDrift')
  })
})
