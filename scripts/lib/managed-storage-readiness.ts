import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  hostedSupabasePsqlEnvironment,
  localSupabasePsqlEnvironment,
  verifyHostedSupabaseApiOrigin,
} from '@/lib/server/supabase-target'

const projectRefSchema = z.string().regex(/^[a-z0-9]{20}$/)
const commandSchema = z.enum(['report', 'execute', 'resume'])

export type ManagedStorageReadinessCommand = z.infer<typeof commandSchema>
export type StorageIdentity = { bucket: string; path: string }
export type ManagedStorageReadinessArguments = {
  command: ManagedStorageReadinessCommand
  expectedProjectRef?: string
  acknowledgement?: string
  json: boolean
}

function readOption(args: string[], name: string): string | undefined {
  const matches = args.reduce<number[]>((indexes, value, index) => {
    if (value === name) indexes.push(index)
    return indexes
  }, [])
  if (matches.length > 1) throw new Error(`${name} may be provided only once`)
  if (matches.length === 0) return undefined
  const value = args[matches[0] + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

export function parseManagedStorageReadinessArguments(
  args: string[],
): ManagedStorageReadinessArguments {
  const positional = args.filter((value, index) => {
    if (index > 0 && ['--expected-project-ref', '--acknowledgement'].includes(args[index - 1])) {
      return false
    }
    return !value.startsWith('--')
  })
  if (args.includes('--dry-run') && positional.some((value) => value !== 'report')) {
    throw new Error('--dry-run cannot be combined with execute or resume')
  }
  const command = commandSchema.parse(positional[0] || 'report')
  if (positional.length > 1) throw new Error('Unexpected positional argument')
  const knownFlags = new Set([
    '--dry-run', '--json', '--expected-project-ref', '--acknowledgement',
  ])
  for (const value of args) {
    if (value.startsWith('--') && !knownFlags.has(value)) {
      throw new Error(`Unknown argument: ${value}`)
    }
  }
  return {
    command,
    expectedProjectRef: readOption(args, '--expected-project-ref'),
    acknowledgement: readOption(args, '--acknowledgement'),
    json: args.includes('--json'),
  }
}

export function managedStorageProductionAcknowledgement(
  projectRef: string,
  commit: string,
): string {
  return `BACKFILL MANAGED STORAGE ${projectRefSchema.parse(projectRef)} AT ${z.string()
    .regex(/^[a-f0-9]{40}$/).parse(commit)}`
}

export function resolveManagedStorageReadinessTarget(input: {
  args: ManagedStorageReadinessArguments
  supabaseUrl: string
  databaseUrl: string
  environment: NodeJS.ProcessEnv
  commit: string
  checkoutClean: boolean
}) {
  const api = new URL(input.supabaseUrl)
  const local = ['127.0.0.1', 'localhost'].includes(api.hostname) && api.port === '54321'
  if (local) {
    const psqlEnvironment = localSupabasePsqlEnvironment(input.databaseUrl)
    if (
      input.args.command !== 'report'
      && input.environment.PIKA_ALLOW_LOCAL_MANAGED_STORAGE_BACKFILL !== '1'
    ) {
      throw new Error(
        'Local execution requires PIKA_ALLOW_LOCAL_MANAGED_STORAGE_BACKFILL=1',
      )
    }
    return { local: true as const, supabaseOrigin: api.origin, psqlEnvironment }
  }

  const expectedProjectRef = input.args.expectedProjectRef
    || input.environment.MANAGED_STORAGE_BACKFILL_EXPECTED_PROJECT_REF
  if (!expectedProjectRef) {
    throw new Error('--expected-project-ref is required for a hosted target')
  }
  const supabaseOrigin = verifyHostedSupabaseApiOrigin(input.supabaseUrl, expectedProjectRef)
  const psqlEnvironment = hostedSupabasePsqlEnvironment(
    input.databaseUrl,
    expectedProjectRef,
  )
  if (input.args.command !== 'report') {
    if (input.environment.MANAGED_STORAGE_BACKFILL_ALLOW_PRODUCTION !== '1') {
      throw new Error('Production execution requires MANAGED_STORAGE_BACKFILL_ALLOW_PRODUCTION=1')
    }
    if (!input.checkoutClean) {
      throw new Error('Production execution requires a clean checkout')
    }
    const acknowledgement = input.args.acknowledgement
      || input.environment.MANAGED_STORAGE_BACKFILL_ACKNOWLEDGEMENT
    const expected = managedStorageProductionAcknowledgement(expectedProjectRef, input.commit)
    if (acknowledgement !== expected) {
      throw new Error(`Production acknowledgement must equal: ${expected}`)
    }
  }
  return {
    local: false as const,
    projectRef: expectedProjectRef,
    supabaseOrigin,
    psqlEnvironment,
  }
}

function identityKey(value: StorageIdentity): string {
  return `${value.bucket}\0${value.path}`
}

export function analyzeGlobalManagedStorage(input: {
  physical: StorageIdentity[]
  registered: Array<StorageIdentity & {
    id?: string
    classroomId?: string | null
    blueprintId?: string | null
    classroomScopeState?: 'hot' | 'cold' | 'split' | 'missing' | null
  }>
  discovered: Array<StorageIdentity & {
    classroomId: string
    managedObjectId?: string | null
    ledger?: string
  }>
  discoveredBlueprints?: Array<StorageIdentity & {
    blueprintId: string
    source: 'mutable_assessment' | 'immutable_version'
    managedObjectId: string | null
    versionId: string | null
  }>
  legacyCleanupLedgers?: Array<StorageIdentity & {
    ledger: string
    managedObjectId: string | null
  }>
}) {
  const physical = new Map(input.physical.map((value) => [identityKey(value), value]))
  const registered = new Map(input.registered.map((value) => [identityKey(value), value]))
  const registeredById = new Map(input.registered
    .filter((value) => value.id)
    .map((value) => [value.id!, value]))
  const discoveredBlueprints = input.discoveredBlueprints || []
  const discoveredOwners = new Map<string, Set<string>>()
  for (const value of input.discovered) {
    const key = identityKey(value)
    const owners = discoveredOwners.get(key) || new Set<string>()
    owners.add(value.classroomId)
    discoveredOwners.set(key, owners)
  }
  const blueprintOwners = new Map<string, Set<string>>()
  for (const value of discoveredBlueprints) {
    const key = identityKey(value)
    const owners = blueprintOwners.get(key) || new Set<string>()
    owners.add(value.blueprintId)
    blueprintOwners.set(key, owners)
  }
  const shared = [...discoveredOwners.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([key, owners]) => ({
      ...(physical.get(key) || input.discovered.find((value) => identityKey(value) === key)!),
      classroomIds: [...owners].sort(),
    }))
  const classroomBlueprintShared = [...blueprintOwners.entries()]
    .filter(([key]) => discoveredOwners.has(key))
    .map(([key, blueprintIds]) => ({
      ...(physical.get(key) || discoveredBlueprints.find((value) => identityKey(value) === key)!),
      classroomIds: [...(discoveredOwners.get(key) || [])].sort(),
      blueprintIds: [...blueprintIds].sort(),
    }))
  const blueprintShared = [...blueprintOwners.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([key, blueprintIds]) => ({
      ...(physical.get(key) || discoveredBlueprints.find((value) => identityKey(value) === key)!),
      blueprintIds: [...blueprintIds].sort(),
    }))
  const missing = [...discoveredOwners.keys()]
    .filter((key) => !physical.has(key))
    .map((key) => input.discovered.find((value) => identityKey(value) === key)!)
  const missingBlueprint = [...blueprintOwners.keys()]
    .filter((key) => !physical.has(key))
    .map((key) => discoveredBlueprints.find((value) => identityKey(value) === key)!)
  const mutableBlueprintReconciliationRequired = discoveredBlueprints.filter((value) => {
    if (value.source !== 'mutable_assessment') return false
    const owner = registered.get(identityKey(value))
    return owner?.blueprintId !== value.blueprintId || owner.id !== value.managedObjectId
  })
  const immutableBlueprintOwnershipRequired = discoveredBlueprints.filter((value) => {
    if (value.source !== 'immutable_version') return false
    return registered.get(identityKey(value))?.blueprintId !== value.blueprintId
  })
  const immutableBlueprintClassroomConflicts = discoveredBlueprints.filter((value) => (
    value.source === 'immutable_version' && discoveredOwners.has(identityKey(value))
  ))
  const orphans = [...physical.entries()]
    .filter(([key]) => (
      !registered.has(key)
      && !discoveredOwners.has(key)
      && !blueprintOwners.has(key)
    ))
    .map(([, value]) => value)
    .sort((left, right) => identityKey(left).localeCompare(identityKey(right)))
  const registeredMissing = [...registered.entries()]
    .filter(([key]) => !physical.has(key))
    .map(([, value]) => value)
  const operationalOwnershipRequired = input.discovered.filter((value) => {
    if (!value.ledger) return false
    const owner = registered.get(identityKey(value))
    return !owner
      || owner.id !== value.managedObjectId
      || owner.classroomId !== value.classroomId
  })
  const invalidClassroomScopes = input.registered.filter((value) => (
    value.classroomId != null
    && value.classroomScopeState != null
    && !['hot', 'cold'].includes(value.classroomScopeState)
  ))
  const unresolvedLegacyCleanupLedgers = (input.legacyCleanupLedgers || []).filter((value) => {
    const owner = value.managedObjectId
      ? registeredById.get(value.managedObjectId)
      : undefined
    return !owner
      || owner.classroomId == null
      || owner.bucket !== value.bucket
      || owner.path !== value.path
  })
  return {
    shared,
    classroomBlueprintShared,
    blueprintShared,
    missing,
    missingBlueprint,
    mutableBlueprintReconciliationRequired,
    immutableBlueprintOwnershipRequired,
    immutableBlueprintClassroomConflicts,
    orphans,
    registeredMissing,
    operationalOwnershipRequired,
    invalidClassroomScopes,
    unresolvedLegacyCleanupLedgers,
  }
}

function pathFingerprint(value: StorageIdentity) {
  return {
    bucket: value.bucket,
    storage_path_sha256: createHash('sha256').update(value.path, 'utf8').digest('hex'),
  }
}

export function redactManagedStorageFindings(input: ReturnType<
  typeof analyzeGlobalManagedStorage
>) {
  return {
    shared: input.shared.map((value) => ({
      ...pathFingerprint(value),
      classroom_ids: value.classroomIds,
    })),
    missing: input.missing.map((value) => ({
      ...pathFingerprint(value),
      classroom_id: value.classroomId,
    })),
    classroomBlueprintShared: input.classroomBlueprintShared.map((value) => ({
      ...pathFingerprint(value),
      classroom_ids: value.classroomIds,
      blueprint_ids: value.blueprintIds,
    })),
    blueprintShared: input.blueprintShared.map((value) => ({
      ...pathFingerprint(value),
      blueprint_ids: value.blueprintIds,
    })),
    missingBlueprint: input.missingBlueprint.map((value) => ({
      ...pathFingerprint(value),
      blueprint_id: value.blueprintId,
      source: value.source,
      version_id: value.versionId,
    })),
    mutableBlueprintReconciliationRequired: input.mutableBlueprintReconciliationRequired.map((value) => ({
      ...pathFingerprint(value),
      blueprint_id: value.blueprintId,
      assessment_id: value.assessmentId,
      document_id: value.documentId,
    })),
    immutableBlueprintOwnershipRequired: input.immutableBlueprintOwnershipRequired.map((value) => ({
      ...pathFingerprint(value),
      blueprint_id: value.blueprintId,
      version_id: value.versionId,
    })),
    immutableBlueprintClassroomConflicts: input.immutableBlueprintClassroomConflicts.map((value) => ({
      ...pathFingerprint(value),
      blueprint_id: value.blueprintId,
      version_id: value.versionId,
    })),
    orphans: input.orphans.map(pathFingerprint),
    registeredMissing: input.registeredMissing.map(pathFingerprint),
    operationalOwnershipRequired: input.operationalOwnershipRequired.map((value) => ({
      ...pathFingerprint(value),
      classroom_id: value.classroomId,
      ledger: value.ledger,
    })),
    invalidClassroomScopes: input.invalidClassroomScopes.map((value) => ({
      ...pathFingerprint(value),
      classroom_id: value.classroomId,
      scope_state: value.classroomScopeState,
    })),
    unresolvedLegacyCleanupLedgers: input.unresolvedLegacyCleanupLedgers.map((value) => ({
      ...pathFingerprint(value),
      ledger: value.ledger,
    })),
  }
}

export function readManagedStorageCatalog(
  psqlEnvironment: Record<string, string>,
): {
  physical: StorageIdentity[]
  registered: Array<StorageIdentity & {
    id: string
    classroomId: string | null
    blueprintId: string | null
    classroomScopeState: 'hot' | 'cold' | 'split' | 'missing' | null
  }>
  operational: Array<StorageIdentity & {
    classroomId: string
    managedObjectId: string | null
    ledger: string
  }>
  legacyCleanupLedgers: Array<StorageIdentity & {
    managedObjectId: string | null
    ledger: string
  }>
} {
  const sql = `
    with legacy_cleanup as (
      select 'assignment_artifact_storage_cleanup'::text ledger,
        'assignment-artifacts'::text bucket, cleanup.storage_path path,
        cleanup.managed_object_id
      from public.assignment_artifact_storage_cleanup cleanup
      union all
      select 'test_document_snapshot_storage_cleanup',
        'test-documents', cleanup.storage_path, cleanup.managed_object_id
      from public.test_document_snapshot_storage_cleanup cleanup
    ), operational as (
      select 'classroom_archives'::text ledger, archive.classroom_id,
        archive.storage_bucket bucket, archive.storage_path path,
        archive.managed_object_id
      from public.classroom_archives archive
      join public.classrooms classroom on classroom.id = archive.classroom_id
      union all
      select 'classroom_archive_operations', operation.classroom_id,
        operation.storage_bucket, operation.storage_path, operation.managed_object_id
      from public.classroom_archive_operations operation
      join public.classrooms classroom on classroom.id = operation.classroom_id
      where operation.storage_bucket is not null and operation.storage_path is not null
      union all
      select 'classroom_archive_object_upload_cleanup', operation.classroom_id,
        cleanup.storage_bucket, cleanup.storage_path, cleanup.managed_object_id
      from public.classroom_archive_object_upload_cleanup cleanup
      join public.classroom_archive_operations operation on operation.id = cleanup.operation_id
      join public.classrooms classroom on classroom.id = operation.classroom_id
      where cleanup.status <> 'deleted'
      union all
      select 'classroom_archive_source_object_cleanup', cleanup.classroom_id,
        cleanup.storage_bucket, cleanup.storage_path, cleanup.managed_object_id
      from public.classroom_archive_source_object_cleanup cleanup
      join public.classrooms classroom on classroom.id = cleanup.classroom_id
      where cleanup.status <> 'deleted'
      union all
      select 'classroom_gradex_extracts', extract.classroom_id,
        extract.storage_bucket, extract.storage_path, extract.managed_object_id
      from public.classroom_gradex_extracts extract
      join public.classrooms classroom on classroom.id = extract.classroom_id
      union all
      select 'classroom_gradex_extract_cleanup', operation.classroom_id,
        cleanup.storage_bucket, cleanup.storage_path, cleanup.managed_object_id
      from public.classroom_gradex_extract_cleanup cleanup
      join public.classroom_archive_operations operation on operation.id = cleanup.operation_id
      join public.classrooms classroom on classroom.id = operation.classroom_id
      where cleanup.status <> 'deleted'
      union all
      select 'assignment_artifact_storage_cleanup', object.classroom_id,
        object.storage_bucket, cleanup.storage_path, cleanup.managed_object_id
      from public.assignment_artifact_storage_cleanup cleanup
      join public.managed_storage_objects object on object.id = cleanup.managed_object_id
      join public.classrooms classroom on classroom.id = object.classroom_id
      where cleanup.status <> 'deleted'
      union all
      select 'test_document_snapshot_storage_cleanup', object.classroom_id,
        object.storage_bucket, cleanup.storage_path, cleanup.managed_object_id
      from public.test_document_snapshot_storage_cleanup cleanup
      join public.managed_storage_objects object on object.id = cleanup.managed_object_id
      join public.classrooms classroom on classroom.id = object.classroom_id
      where cleanup.status <> 'deleted'
    )
    select jsonb_build_object(
      'physical', coalesce((
        select jsonb_agg(jsonb_build_object('bucket', bucket_id, 'path', name)
          order by bucket_id, name)
        from storage.objects
        where bucket_id in (
          'assignment-artifacts', 'submission-images', 'test-documents',
          'classroom-archives', 'gradex-analytics-extracts'
        )
      ), '[]'::jsonb),
      'registered', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', object.id, 'bucket', object.storage_bucket, 'path', object.storage_path,
          'classroomId', object.classroom_id, 'blueprintId', object.course_blueprint_id,
          'classroomScopeState', case
            when object.classroom_id is null then null
            when exists (select 1 from public.classrooms where id = object.classroom_id)
              and exists (select 1 from public.classroom_cold_tombstones where classroom_id = object.classroom_id)
              then 'split'
            when exists (select 1 from public.classrooms where id = object.classroom_id) then 'hot'
            when exists (select 1 from public.classroom_cold_tombstones where classroom_id = object.classroom_id) then 'cold'
            else 'missing'
          end
        ) order by object.storage_bucket, object.storage_path)
        from public.managed_storage_objects object
      ), '[]'::jsonb),
      'operational', coalesce((
        select jsonb_agg(jsonb_build_object(
          'ledger', ledger, 'classroomId', classroom_id,
          'bucket', bucket, 'path', path, 'managedObjectId', managed_object_id
        ) order by ledger, classroom_id, bucket, path)
        from operational
      ), '[]'::jsonb),
      'legacyCleanupLedgers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'ledger', ledger, 'bucket', bucket, 'path', path,
          'managedObjectId', managed_object_id
        ) order by ledger, bucket, path)
        from legacy_cleanup
      ), '[]'::jsonb)
    );
  `
  const output = execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...psqlEnvironment },
  }).trim()
  return z.object({
    physical: z.array(z.object({ bucket: z.string(), path: z.string() })),
    registered: z.array(z.object({
      id: z.string().uuid(),
      bucket: z.string(), path: z.string(),
      classroomId: z.string().uuid().nullable(), blueprintId: z.string().uuid().nullable(),
      classroomScopeState: z.enum(['hot', 'cold', 'split', 'missing']).nullable(),
    })),
    operational: z.array(z.object({
      ledger: z.string(), classroomId: z.string().uuid(),
      bucket: z.string(), path: z.string(), managedObjectId: z.string().uuid().nullable(),
    })),
    legacyCleanupLedgers: z.array(z.object({
      ledger: z.string(), bucket: z.string(), path: z.string(),
      managedObjectId: z.string().uuid().nullable(),
    })),
  }).parse(JSON.parse(output))
}
