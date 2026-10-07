import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as native from '../../scripts/contextual-test-draft-save-native-contracts'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { testOwnerDigest } from '../../scripts/contextual-test-owner-detail-proof-fixture'
import { newTestOwnerPublicationFixture } from '../../scripts/contextual-test-publication-proof-fixture'

const original = newAssignmentListProofFixture()
const fixture = newTestOwnerPublicationFixture(original)
const head = 'a'.repeat(40)
const repository = process.cwd()

describe('inert additive publication native profile', () => {
  it('provides only fixed252 manifest/factory/SQL admission', () => {
    expect(typeof native.buildTestOwnerPublicationNativeContractsManifest).toBe('function')
    expect(typeof native.createTestOwnerPublicationNativeContracts).toBe('function')
    expect(typeof native.validateTestOwnerPublicationNativeSql).toBe('function')
  })
  it('shares existing limits and prepares presence-only setup, never reinserts the durable fixture', () => {
    const manifest = native.buildTestOwnerPublicationNativeContractsManifest(original, fixture, head, repository)
    const prior = native.buildDraftSaveNativeContractsManifest(original, head, repository)
    expect(manifest.capabilities).toEqual(prior.capabilities)
    expect(manifest.setup).not.toMatch(/\b(?:insert|update|delete|commit)\b/i)
    expect(manifest.setup).toContain('Migration252 fixture presence differs')
    expect(manifest.concurrency.schedules).toHaveLength(12)
    expect(manifest.committed.schedules).toHaveLength(5)
    expect(manifest.privilege.expectedEvidence.rpcCalls).toBe(2)
    expect(Object.keys(manifest.publicationPrivileges).sort()).toEqual(['activation134', 'legacy139', 'publication252', 'snapshot247'])
    expect(manifest.publicationPrivileges.snapshot247.expectedEvidence.rpcCalls).toBe(1)
    expect(Object.isFrozen(manifest.publicationPrivileges)).toBe(true)
    expect(Object.isFrozen(manifest.committed.schedules)).toBe(true)
  })
  it('accepts only exact owned SQL and does not export restoration or arbitrary profile selection', () => {
    const manifest = native.buildTestOwnerPublicationNativeContractsManifest(original, fixture, head, repository)
    for (const sql of [manifest.setup, manifest.snapshot, manifest.bootstrap, manifest.close, manifest.contracts.contracts]) {
      expect(native.validateTestOwnerPublicationNativeSql(manifest, sql)).toBe(true)
      expect(native.validateTestOwnerPublicationNativeSql(manifest, sql + ' select 1;')).toBe(false)
    }
    for (const capability of Object.values(manifest.publicationPrivileges)) {
      expect(native.validateTestOwnerPublicationNativeSql(manifest, capability.catalog)).toBe(true)
      expect(native.validateTestOwnerPublicationNativeSql(manifest, capability.revoke)).toBe(true)
      expect(native.validateTestOwnerPublicationNativeSql(manifest, capability.restore)).toBe(false)
    }
    expect(native.validateTestOwnerPublicationNativeSql(manifest, 'delete from public.users;')).toBe(false)
    expect(native).not.toHaveProperty('createNativeOwnerContracts')
    expect(native).not.toHaveProperty('snapshotPrivilegeSql')
    expect(() => native.buildTestOwnerPublicationNativeContractsManifest(original, { ...fixture, cases: [] }, head, repository)).toThrow('Test publication fixture differs')
  })
  it('requires the existing adopter absolute deadline before target/native operations', () => {
    const manifest = native.buildTestOwnerPublicationNativeContractsManifest(original, fixture, head, repository)
    const input = { repository, reviewedHead: head, original, fixture, containerId: 'b'.repeat(64), capturedResources: [], acceptedManifestSha256: testOwnerDigest(JSON.stringify(manifest)) }
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000000)
    try {
      for (const absoluteDeadline of [NaN, Infinity, -Infinity, 1000000, 1900001]) {
        expect(() => native.createTestOwnerPublicationNativeContracts({ ...input, absoluteDeadline })).toThrow()
      }
      const facade = native.createTestOwnerPublicationNativeContracts({ ...input, absoluteDeadline: 1000100 })
      expect(Object.keys(facade).sort()).toEqual(['diagnostic', 'manifest', 'probeActivationPrivilegeDrift', 'probeLegacyPublicationPrivilegeDrift',
        'probePublicationPrivilegeDrift', 'probePublicationSnapshotPrivilegeDrift', 'run', 'runCommittedTransitions', 'setup', 'verifyTarget'])
      expect(facade).not.toHaveProperty('probeFixedPrivilegeDrift')
      expect(manifest.capabilities.totalMs).toBe(900000)
    } finally { clock.mockRestore() }
  })
  it('preserves whole-row rollback equality and uses separate source-owned committed execution', () => {
    const source = readFileSync('scripts/contextual-test-draft-save-native-contracts.ts', 'utf8')
    expect(source).toContain("assert.deepEqual(await single(manifest.snapshot), before, 'Rollback contract whole-row equality differs')")
    expect(source).toContain("assert.deepEqual(await single(manifest.snapshot), before, 'Rollback schedule whole-row equality differs')")
    expect(source.includes('async runCommittedTransitions()')).toBe(true)
    expect(source.includes('profile.runCommitted(')).toBe(true)
    expect(source.includes('Date.now() < profile.absoluteDeadline')).toBe(true)
    expect(source).not.toMatch(/export (?:type|interface) NativeOwnerProfile/)
  })
})
