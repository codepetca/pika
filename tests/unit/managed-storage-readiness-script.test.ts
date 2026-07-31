import { describe, expect, it } from 'vitest'
import {
  analyzeGlobalManagedStorage,
  managedStorageProductionAcknowledgement,
  parseManagedStorageReadinessArguments,
  redactManagedStorageFindings,
  resolveManagedStorageReadinessTarget,
} from '../../scripts/lib/managed-storage-readiness'

const projectRef = 'abcdefghijklmnopqrst'
const commit = 'a'.repeat(40)
const hostedUrl = `https://${projectRef}.supabase.co`
const hostedDatabaseUrl =
  `postgresql://postgres:secret@db.${projectRef}.supabase.co/postgres?sslmode=verify-full`

describe('managed storage readiness operator', () => {
  it('defaults to a read-only report and accepts an explicit dry-run', () => {
    expect(parseManagedStorageReadinessArguments([])).toEqual({
      command: 'report',
      expectedProjectRef: undefined,
      acknowledgement: undefined,
      json: false,
    })
    expect(parseManagedStorageReadinessArguments(['report', '--dry-run', '--json']).command)
      .toBe('report')
    expect(() => parseManagedStorageReadinessArguments(['execute', '--dry-run']))
      .toThrow('--dry-run cannot be combined')
  })

  it('requires production opt-in, a clean exact commit, and target-bound acknowledgement', () => {
    const args = parseManagedStorageReadinessArguments([
      'execute',
      '--expected-project-ref', projectRef,
      '--acknowledgement', managedStorageProductionAcknowledgement(projectRef, commit),
    ])
    const base = {
      args,
      supabaseUrl: hostedUrl,
      databaseUrl: hostedDatabaseUrl,
      commit,
      checkoutClean: true,
    }
    expect(() => resolveManagedStorageReadinessTarget({
      ...base,
      environment: {},
    })).toThrow('MANAGED_STORAGE_BACKFILL_ALLOW_PRODUCTION=1')
    expect(() => resolveManagedStorageReadinessTarget({
      ...base,
      checkoutClean: false,
      environment: { MANAGED_STORAGE_BACKFILL_ALLOW_PRODUCTION: '1' },
    })).toThrow('clean checkout')
    expect(resolveManagedStorageReadinessTarget({
      ...base,
      environment: { MANAGED_STORAGE_BACKFILL_ALLOW_PRODUCTION: '1' },
    })).toMatchObject({ local: false, projectRef, supabaseOrigin: hostedUrl })
  })

  it('requires a separate local write opt-in but not for local reports', () => {
    const base = {
      supabaseUrl: 'http://127.0.0.1:54321',
      databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      environment: {},
      commit,
      checkoutClean: false,
    }
    expect(resolveManagedStorageReadinessTarget({
      ...base,
      args: parseManagedStorageReadinessArguments([]),
    })).toMatchObject({ local: true, supabaseOrigin: 'http://127.0.0.1:54321' })
    expect(() => resolveManagedStorageReadinessTarget({
      ...base,
      args: parseManagedStorageReadinessArguments(['resume']),
    })).toThrow('PIKA_ALLOW_LOCAL_MANAGED_STORAGE_BACKFILL=1')
  })

  it('reports cross-classroom paths, missing references, and true global orphans', () => {
    const report = analyzeGlobalManagedStorage({
      physical: [
        { bucket: 'submission-images', path: 'shared.png' },
        { bucket: 'submission-images', path: 'orphan.png' },
        { bucket: 'test-documents', path: 'blueprint.pdf' },
      ],
      registered: [{
        bucket: 'test-documents', path: 'blueprint.pdf',
        classroomId: null, blueprintId: '10000000-0000-4000-8000-000000000001',
      }],
      discovered: [{
        bucket: 'submission-images', path: 'shared.png', classroomId: 'classroom-a',
      }, {
        bucket: 'submission-images', path: 'shared.png', classroomId: 'classroom-b',
      }, {
        bucket: 'assignment-artifacts', path: 'missing.pdf', classroomId: 'classroom-a',
      }],
    })
    expect(report.shared).toHaveLength(1)
    expect(report.missing).toEqual([expect.objectContaining({ path: 'missing.pdf' })])
    expect(report.orphans).toEqual([{ bucket: 'submission-images', path: 'orphan.png' }])
    expect(report.registeredMissing).toEqual([])
  })

  it('fails closed on legacy Blueprint references that need a managed copy/rewrite or share classroom bytes', () => {
    const blueprintId = '10000000-0000-4000-8000-000000000001'
    const report = analyzeGlobalManagedStorage({
      physical: [{ bucket: 'test-documents', path: 'legacy/shared.pdf' }],
      registered: [{
        id: '20000000-0000-4000-8000-000000000002',
        bucket: 'test-documents',
        path: 'legacy/shared.pdf',
        classroomId: 'classroom-a',
        blueprintId: null,
      }],
      discovered: [{
        bucket: 'test-documents',
        path: 'legacy/shared.pdf',
        classroomId: 'classroom-a',
      }],
      discoveredBlueprints: [{
        bucket: 'test-documents',
        path: 'legacy/shared.pdf',
        blueprintId,
        source: 'mutable_assessment',
        managedObjectId: null,
        versionId: null,
      }, {
        bucket: 'test-documents',
        path: 'legacy/shared.pdf',
        blueprintId,
        source: 'immutable_version',
        managedObjectId: null,
        versionId: '30000000-0000-4000-8000-000000000003',
      }],
    })

    expect(report.classroomBlueprintShared).toHaveLength(1)
    expect(report.mutableBlueprintReconciliationRequired).toHaveLength(1)
    expect(report.immutableBlueprintOwnershipRequired).toHaveLength(1)
    expect(report.immutableBlueprintClassroomConflicts).toHaveLength(1)
    const redacted = JSON.stringify(redactManagedStorageFindings(report))
    expect(redacted).not.toContain('legacy/shared.pdf')
  })

  it('accepts a mutable Blueprint document only when its exact Blueprint owner and managed id agree', () => {
    const blueprintId = '10000000-0000-4000-8000-000000000001'
    const managedObjectId = '20000000-0000-4000-8000-000000000002'
    const report = analyzeGlobalManagedStorage({
      physical: [{ bucket: 'test-documents', path: 'blueprints/material.pdf' }],
      registered: [{
        id: managedObjectId,
        bucket: 'test-documents',
        path: 'blueprints/material.pdf',
        classroomId: null,
        blueprintId,
      }],
      discovered: [],
      discoveredBlueprints: [{
        bucket: 'test-documents',
        path: 'blueprints/material.pdf',
        blueprintId,
        source: 'mutable_assessment',
        managedObjectId,
        versionId: null,
      }],
    })

    expect(report.mutableBlueprintReconciliationRequired).toEqual([])
    expect(report.orphans).toEqual([])
  })

  it('redacts raw Storage paths from durable readiness findings', () => {
    const sentinelPath = 'private/teacher-name/sensitive-file.pdf'
    const findings = redactManagedStorageFindings(analyzeGlobalManagedStorage({
      physical: [{ bucket: 'test-documents', path: sentinelPath }],
      registered: [],
      discovered: [],
    }))
    const serialized = JSON.stringify(findings)
    expect(serialized).not.toContain(sentinelPath)
    expect(findings.orphans).toEqual([{
      bucket: 'test-documents',
      storage_path_sha256: 'ba760eca923cc300fee7842a9dac0b59af14e4eb849174861a0391e885cc46ce',
    }])
  })
})
