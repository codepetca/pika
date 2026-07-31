import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { config as loadEnvironment } from 'dotenv'
import { z } from 'zod'
import {
  collectExactReadPages,
  createSupabaseClassroomArchiveInventoryReader,
  readClassroomArchiveResourceGraph,
} from '@/lib/server/classroom-archive-inventory'
import {
  backfillAllClassroomManagedStorage,
  collectManagedStorageBlueprintReferences,
  collectManagedStorageBackfillCandidates,
} from '@/lib/server/managed-storage-backfill'
import {
  resumeLegacyBlueprintClassroomStorageReconciliation,
  type LegacyBlueprintClassroomReconciliationPlan,
} from '@/lib/server/managed-storage-blueprint-reconciliation'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  analyzeGlobalManagedStorage,
  parseManagedStorageReadinessArguments,
  readManagedStorageCatalog,
  redactManagedStorageFindings,
  resolveManagedStorageReadinessTarget,
} from './lib/managed-storage-readiness'

loadEnvironment({ path: process.env.ENV_FILE || '.env.local' })

const classroomSchema = z.object({
  id: z.string().uuid(),
  teacher_id: z.string().uuid(),
}).strict()
const blueprintSchema = z.object({
  id: z.string().uuid(),
  teacher_id: z.string().uuid(),
}).strict()
const blueprintAssessmentSchema = z.object({
  id: z.string().uuid(),
  course_blueprint_id: z.string().uuid(),
  documents: z.unknown(),
}).strict()
const blueprintVersionSchema = z.object({
  id: z.string().uuid(),
  course_blueprint_id: z.string().uuid(),
  snapshot_json: z.unknown(),
}).strict()
const coverageSchema = z.object({
  classroom_id: z.string().uuid(),
  status: z.enum(['pending', 'verified', 'blocked']),
  reference_count: z.number().int().nonnegative().nullable(),
  object_count: z.number().int().nonnegative().nullable(),
  error_code: z.string().nullable(),
}).strict()

type SupabaseClient = ReturnType<typeof getServiceRoleClient>
type Classroom = z.infer<typeof classroomSchema>
type Blueprint = z.infer<typeof blueprintSchema>
type BlueprintAssessment = z.infer<typeof blueprintAssessmentSchema>
type BlueprintVersion = z.infer<typeof blueprintVersionSchema>

function gitOutput(args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

function deterministicUuid(parts: string[]): string {
  const bytes = createHash('sha256').update(parts.join('\0'), 'utf8').digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const value = bytes.toString('hex')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

function legacyReconciliationTargetPath(classroomId: string, reconciliationId: string, sourcePath: string) {
  const extension = /\.[a-zA-Z0-9]{1,12}$/.exec(sourcePath)?.[0] || ''
  return `classrooms/${classroomId}/tests/legacy-blueprint-reconciliation/${reconciliationId}${extension}`
}

async function readAllClassrooms(supabase: SupabaseClient): Promise<Classroom[]> {
  const snapshot = async () => collectExactReadPages(async (offset, pageSize) => {
    const response = await supabase.from('classrooms')
      .select('id,teacher_id', { count: 'exact' })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (response.error) throw new Error(`Could not read classroom set: ${response.error.message}`)
    return {
      rows: z.array(classroomSchema).parse(response.data),
      count: z.number().int().nonnegative().parse(response.count),
    }
  })
  const first = await snapshot()
  const second = await snapshot()
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error('All-classroom set changed during discovery; rerun the report')
  }
  return second
}

async function readAllBlueprintStorageState(supabase: SupabaseClient): Promise<{
  blueprints: Blueprint[]
  assessments: BlueprintAssessment[]
  versions: BlueprintVersion[]
}> {
  const snapshot = async () => {
    const read = async <T>(table: string, columns: string, schema: z.ZodType<T>): Promise<T[]> => (
      collectExactReadPages(async (offset, pageSize) => {
        const response = await (supabase as any).from(table)
          .select(columns, { count: 'exact' })
          .order('id', { ascending: true })
          .range(offset, offset + pageSize - 1)
        if (response.error) throw new Error(`Could not read ${table}: ${response.error.message}`)
        return {
          rows: z.array(schema).parse(response.data || []),
          count: z.number().int().nonnegative().parse(response.count),
        }
      })
    )
    const [blueprints, assessments, versions] = await Promise.all([
      read('course_blueprints', 'id,teacher_id', blueprintSchema),
      read('course_blueprint_assessments', 'id,course_blueprint_id,documents', blueprintAssessmentSchema),
      read('course_blueprint_versions', 'id,course_blueprint_id,snapshot_json', blueprintVersionSchema),
    ])
    return { blueprints, assessments, versions }
  }
  const first = await snapshot()
  const second = await snapshot()
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error('Blueprint document set changed during discovery; rerun the report')
  }
  return second
}

async function discoverClassroomStorageState(input: {
  classrooms: Classroom[]
  reader: ReturnType<typeof createSupabaseClassroomArchiveInventoryReader>
}) {
  const discoveredClassrooms: Array<{
    teacherId: string
    classroomId: string
    sourceRevision: number
    resources: Record<string, Array<Record<string, unknown>>>
  }> = []
  for (const [index, classroom] of input.classrooms.entries()) {
    process.stderr.write(
      `Managed storage discovery ${index + 1}/${input.classrooms.length}: ${classroom.id}\n`,
    )
    let stable: {
      sourceRevision: number
      resources: Record<string, Array<Record<string, unknown>>>
    } | undefined
    for (let attempt = 0; attempt < 3 && !stable; attempt += 1) {
      const revisionBefore = z.coerce.number().int().positive().parse(
        await input.reader.readRevision(classroom.id),
      )
      const resources = await readClassroomArchiveResourceGraph(input.reader, classroom.id)
      const revisionAfter = z.coerce.number().int().positive().parse(
        await input.reader.readRevision(classroom.id),
      )
      if (revisionBefore === revisionAfter) stable = { sourceRevision: revisionAfter, resources }
    }
    if (!stable) throw new Error(`Classroom ${classroom.id} did not stabilize during discovery`)
    discoveredClassrooms.push({ teacherId: classroom.teacher_id, classroomId: classroom.id, ...stable })
  }
  return discoveredClassrooms
}

async function readCoverage(supabase: SupabaseClient) {
  const response = await (supabase as any).from('classroom_managed_storage_coverage')
    .select('classroom_id,status,reference_count,object_count,error_code')
    .order('classroom_id', { ascending: true })
  if (response.error) throw new Error(`Could not read managed storage coverage: ${response.error.message}`)
  return z.array(coverageSchema).parse(response.data || [])
}

async function readSettings(supabase: SupabaseClient) {
  const response = await (supabase as any).from('managed_storage_settings')
    .select('enforce_ownership,hot_classroom_purge_enabled')
    .eq('singleton', true)
    .single()
  if (response.error) throw new Error(`Could not read managed storage settings: ${response.error.message}`)
  return z.object({
    enforce_ownership: z.boolean(),
    hot_classroom_purge_enabled: z.boolean(),
  }).strict().parse(response.data)
}

async function main() {
  const args = parseManagedStorageReadinessArguments(process.argv.slice(2))
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  const databaseUrl = process.env.MANAGED_STORAGE_READINESS_DATABASE_URL
    || process.env.PIKA_LOCAL_DATABASE_URL
  if (!supabaseUrl || !secretKey || !databaseUrl) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, and '
      + 'MANAGED_STORAGE_READINESS_DATABASE_URL (or local PIKA_LOCAL_DATABASE_URL) are required',
    )
  }
  const commit = gitOutput(['rev-parse', 'HEAD'])
  const checkoutClean = gitOutput(['status', '--porcelain', '--untracked-files=all']) === ''
  const target = resolveManagedStorageReadinessTarget({
    args,
    supabaseUrl,
    databaseUrl,
    environment: process.env,
    commit,
    checkoutClean,
  })
  const supabase = getServiceRoleClient({ fetch: createTargetBoundFetch(target.supabaseOrigin) })
  const reader = createSupabaseClassroomArchiveInventoryReader({
    supabase,
    supabaseUrl: target.supabaseOrigin,
    secretKey,
  })

  let classrooms = await readAllClassrooms(supabase)
  let discoveredClassrooms = await discoverClassroomStorageState({ classrooms, reader })
  const classroomSetAfterDiscovery = await readAllClassrooms(supabase)
  if (JSON.stringify(classroomSetAfterDiscovery) !== JSON.stringify(classrooms)) {
    throw new Error('All-classroom set changed after discovery; no ownership was written')
  }
  let blueprintState = await readAllBlueprintStorageState(supabase)
  let discoveredBlueprints = collectManagedStorageBlueprintReferences({
    supabaseUrl: target.supabaseOrigin,
    ...blueprintState,
  })

  let coverageBefore = await readCoverage(supabase)
  let coverageByClassroom = new Map(coverageBefore.map((row) => [row.classroom_id, row]))
  let discovered = discoveredClassrooms.flatMap((classroom) =>
    collectManagedStorageBackfillCandidates({
      resources: classroom.resources,
      supabaseUrl: target.supabaseOrigin,
    })
      .map((object) => ({ ...object, classroomId: classroom.classroomId })),
  )
  let catalogBefore = readManagedStorageCatalog(target.psqlEnvironment)
  let analysisBefore = analyzeGlobalManagedStorage({
    ...catalogBefore,
    discovered,
    discoveredBlueprints,
  })
  const settingsBefore = await readSettings(supabase)
  let pendingClassrooms = discoveredClassrooms.filter((classroom) =>
    coverageByClassroom.get(classroom.classroomId)?.status !== 'verified',
  )

  const buildLegacyBlueprintReconciliationPlans = (): LegacyBlueprintClassroomReconciliationPlan[] => {
    const candidatesByPath = new Map<string, Array<(typeof discovered)[number]>>()
    for (const candidate of discovered) {
      const key = `${candidate.bucket}\0${candidate.path}`
      candidatesByPath.set(key, [...(candidatesByPath.get(key) || []), candidate])
    }
    const refsByPath = new Map<string, typeof discoveredBlueprints>()
    for (const reference of discoveredBlueprints) {
      const key = `${reference.bucket}\0${reference.path}`
      refsByPath.set(key, [...(refsByPath.get(key) || []), reference])
    }
    return analysisBefore.classroomBlueprintShared.map((shared) => {
      if (shared.classroomIds.length !== 1 || shared.blueprintIds.length !== 1) {
        throw new Error('Legacy Blueprint reconciliation requires exactly one Classroom and one Blueprint owner')
      }
      const key = `${shared.bucket}\0${shared.path}`
      const classroomId = shared.classroomIds[0]
      const blueprintId = shared.blueprintIds[0]
      const classroomCandidates = (candidatesByPath.get(key) || []).filter((candidate) => (
        candidate.classroomId === classroomId
        && candidate.purpose === 'teacher_test_material'
        && candidate.testDocument?.referenceKind === 'teacher_upload'
      ))
      // The inventory collector rejects multi-resource sharing before this point.
      if (classroomCandidates.length !== 1 || !classroomCandidates[0].testDocument) {
        throw new Error('Legacy Blueprint reconciliation requires exactly one current Classroom test document')
      }
      const classroom = discoveredClassrooms.find((value) => value.classroomId === classroomId)
      if (!classroom) throw new Error('Legacy Blueprint reconciliation Classroom disappeared during discovery')
      const references = (refsByPath.get(key) || []).filter((reference) => reference.blueprintId === blueprintId)
      if (references.length === 0 || references.some((reference) => reference.teacherId !== classroom.teacherId)) {
        throw new Error('Legacy Blueprint reconciliation requires a same-teacher Blueprint evidence set')
      }
      const registered = catalogBefore.registered.find((object) => object.bucket === shared.bucket && object.path === shared.path)
      const reconciliationId = deterministicUuid([
        'legacy-blueprint-classroom-reconciliation', blueprintId, classroomId, shared.bucket, shared.path,
      ])
      const sourceObjectId = registered?.id || deterministicUuid([
        'legacy-blueprint-source-object', blueprintId, shared.bucket, shared.path,
      ])
      const targetObjectId = deterministicUuid([
        'legacy-blueprint-classroom-target-object', blueprintId, classroomId, shared.bucket, shared.path,
      ])
      return {
        reconciliationId, sourceObjectId, targetObjectId,
        teacherId: classroom.teacherId, blueprintId, classroomId, sourcePath: shared.path,
        targetPath: legacyReconciliationTargetPath(classroomId, reconciliationId, shared.path),
        classroomDocuments: [classroomCandidates[0].testDocument],
        mutableBlueprintDocuments: references.filter((reference) => reference.source === 'mutable_assessment')
          .map((reference) => ({
            assessmentId: reference.assessmentId, documentId: reference.documentId,
            expectedReference: reference.expectedReference,
          })),
        immutableBlueprintEvidence: references.filter((reference) => reference.source === 'immutable_version')
          .map((reference) => ({
            versionId: reference.versionId!, expectedReference: reference.expectedReference,
          })),
      }
    })
  }

  const buildLegacyBlueprintOnlyRegistrations = () => {
    const classroomBlueprintKeys = new Set(analysisBefore.classroomBlueprintShared.map((shared) => (
      `${shared.bucket}\0${shared.path}`
    )))
    const requiredKeys = new Set([
      ...analysisBefore.mutableBlueprintReconciliationRequired,
      ...analysisBefore.immutableBlueprintOwnershipRequired,
    ].map((reference) => `${reference.bucket}\0${reference.path}`).filter((key) => (
      !classroomBlueprintKeys.has(key)
    )))
    const referencesByPath = new Map<string, typeof discoveredBlueprints>()
    for (const reference of discoveredBlueprints) {
      const key = `${reference.bucket}\0${reference.path}`
      referencesByPath.set(key, [...(referencesByPath.get(key) || []), reference])
    }
    return [...requiredKeys].sort().map((key) => {
      const references = referencesByPath.get(key) || []
      const blueprintIds = [...new Set(references.map((reference) => reference.blueprintId))]
      const [bucket, path] = key.split('\0')
      if (references.length === 0 || blueprintIds.length !== 1 || discovered.some((candidate) => (
        candidate.bucket === bucket && candidate.path === path
      ))) {
        throw new Error('Blueprint-only registration requires one unshared Blueprint source path')
      }
      const blueprintId = blueprintIds[0]
      const teacherId = references[0].teacherId
      if (references.some((reference) => reference.teacherId !== teacherId)) {
        throw new Error('Blueprint-only registration has inconsistent teacher ownership')
      }
      const registered = catalogBefore.registered.find((object) => object.bucket === bucket && object.path === path)
      if (registered && registered.blueprintId !== blueprintId) {
        throw new Error('Blueprint-only registration found a conflicting managed owner')
      }
      return {
        objectId: registered?.id || deterministicUuid([
          'legacy-blueprint-only-object', blueprintId, bucket, path,
        ]),
        teacherId, blueprintId, bucket, path,
        mutableBlueprintDocuments: references
          .filter((reference) => reference.source === 'mutable_assessment')
          .map((reference) => ({
            assessmentId: reference.assessmentId, documentId: reference.documentId,
            expectedReference: reference.expectedReference,
          })),
        immutableBlueprintEvidence: references
          .filter((reference) => reference.source === 'immutable_version')
          .map((reference) => ({
            versionId: reference.versionId!, expectedReference: reference.expectedReference,
          })),
      }
    })
  }

  if (args.command !== 'report') {
    if (settingsBefore.enforce_ownership || settingsBefore.hot_classroom_purge_enabled) {
      throw new Error(
        'Backfill execution requires both managed storage rollout gates to remain false',
      )
    }
    if (analysisBefore.shared.length > 0) {
      throw new Error('Cross-classroom shared paths must be resolved before ownership writes')
    }
    if (analysisBefore.blueprintShared.length > 0) {
      throw new Error('Cross-Blueprint shared paths require copy/rewrite reconciliation before ownership writes')
    }
    if (analysisBefore.missing.length > 0) {
      throw new Error('Missing referenced Storage objects must be resolved before ownership writes')
    }
    if (analysisBefore.missingBlueprint.length > 0) {
      throw new Error('Missing Blueprint-referenced Storage objects must be resolved before ownership writes')
    }
    if (analysisBefore.registeredMissing.length > 0) {
      throw new Error('Registered managed objects missing from Storage must be resolved first')
    }
    for (const plan of buildLegacyBlueprintReconciliationPlans()) {
      await resumeLegacyBlueprintClassroomStorageReconciliation({ plan, supabase })
    }
    for (const registration of buildLegacyBlueprintOnlyRegistrations()) {
      const result = await supabase.rpc('register_legacy_blueprint_storage_object', {
        p_object_id: registration.objectId,
        p_teacher_id: registration.teacherId,
        p_blueprint_id: registration.blueprintId,
        p_storage_bucket: registration.bucket,
        p_storage_path: registration.path,
        p_mutable_blueprint_documents: registration.mutableBlueprintDocuments,
        p_immutable_blueprint_evidence: registration.immutableBlueprintEvidence,
      })
      if (result.error) {
        throw new Error(`Blueprint-only legacy registration failed: ${result.error.message}`)
      }
    }
    // Adoption rewrites current Classroom URLs and mutable Blueprint ids. Re-read
    // exact state before backfill; never use the pre-reconciliation revision.
    classrooms = await readAllClassrooms(supabase)
    discoveredClassrooms = await discoverClassroomStorageState({ classrooms, reader })
    blueprintState = await readAllBlueprintStorageState(supabase)
    discoveredBlueprints = collectManagedStorageBlueprintReferences({
      supabaseUrl: target.supabaseOrigin, ...blueprintState,
    })
    coverageBefore = await readCoverage(supabase)
    coverageByClassroom = new Map(coverageBefore.map((row) => [row.classroom_id, row]))
    discovered = discoveredClassrooms.flatMap((classroom) => collectManagedStorageBackfillCandidates({
      resources: classroom.resources, supabaseUrl: target.supabaseOrigin,
    }).map((object) => ({ ...object, classroomId: classroom.classroomId })))
    catalogBefore = readManagedStorageCatalog(target.psqlEnvironment)
    analysisBefore = analyzeGlobalManagedStorage({ ...catalogBefore, discovered, discoveredBlueprints })
    pendingClassrooms = discoveredClassrooms.filter((classroom) =>
      coverageByClassroom.get(classroom.classroomId)?.status !== 'verified',
    )
    if (analysisBefore.classroomBlueprintShared.length > 0
      || analysisBefore.mutableBlueprintReconciliationRequired.length > 0
      || analysisBefore.immutableBlueprintOwnershipRequired.length > 0
      || analysisBefore.immutableBlueprintClassroomConflicts.length > 0) {
      throw new Error('Legacy Blueprint reconciliation did not settle every exact ownership reference')
    }
    if (pendingClassrooms.length > 0) {
      await backfillAllClassroomManagedStorage({
        inventoryScope: 'all_classrooms',
        supabase,
        supabaseUrl: target.supabaseOrigin,
        classrooms: pendingClassrooms.map(({
          teacherId, classroomId, sourceRevision, resources,
        }) => ({
          teacherId,
          classroomId,
          expectedSourceRevision: sourceRevision,
          resources,
        })),
      })
    }
    for (const classroom of discoveredClassrooms) {
      const revisionAfter = z.coerce.number().int().positive().parse(
        await reader.readRevision(classroom.classroomId),
      )
      if (revisionAfter !== classroom.sourceRevision) {
        throw new Error(
          `Classroom ${classroom.classroomId} changed during backfill; rerun safely with resume`,
        )
      }
    }
  }

  const coverageAfter = await readCoverage(supabase)
  const catalogAfter = readManagedStorageCatalog(target.psqlEnvironment)
  const analysisAfter = analyzeGlobalManagedStorage({
    ...catalogAfter,
    discovered,
    discoveredBlueprints,
  })
  const settingsAfter = await readSettings(supabase)
  if (
    args.command !== 'report'
    && (settingsAfter.enforce_ownership || settingsAfter.hot_classroom_purge_enabled)
  ) {
    throw new Error('A managed storage rollout gate changed during backfill execution')
  }
  const coverageAfterByClassroom = new Map(
    coverageAfter.map((row) => [row.classroom_id, row]),
  )
  const coverageCounts: Record<string, number> = {
    pending: 0,
    verified: 0,
    blocked: 0,
    missing: 0,
  }
  const classroomProgress = classrooms.map((classroom) => {
    const coverage = coverageAfterByClassroom.get(classroom.id)
    if (!coverage) {
      coverageCounts.missing += 1
      return {
        classroom_id: classroom.id,
        status: 'missing' as const,
        reference_count: null,
        object_count: null,
        error_code: 'managed_storage_coverage_row_missing',
      }
    }
    coverageCounts[coverage.status] += 1
    return {
      classroom_id: coverage.classroom_id,
      status: coverage.status,
      reference_count: coverage.reference_count,
      object_count: coverage.object_count,
      error_code: coverage.error_code,
    }
  })
  const redactedFindings = redactManagedStorageFindings(analysisAfter)
  const report = {
    format: 'pika.managed-storage-readiness',
    version: 1,
    generated_at: new Date().toISOString(),
    mode: args.command === 'report' ? 'report/dry-run' : args.command,
    target: target.local ? 'local' : target.projectRef,
    runner_commit: commit,
    classroom_count: classrooms.length,
    classroom_progress: classroomProgress,
    coverage: coverageCounts,
    discovered_reference_count: discovered.length,
    blueprint_reference_count: discoveredBlueprints.length,
    global_orphans: redactedFindings.orphans,
    cross_classroom_shared_paths: redactedFindings.shared,
    classroom_blueprint_shared_paths: redactedFindings.classroomBlueprintShared,
    cross_blueprint_shared_paths: redactedFindings.blueprintShared,
    missing_referenced_objects: redactedFindings.missing,
    missing_blueprint_referenced_objects: redactedFindings.missingBlueprint,
    mutable_blueprint_reconciliation_required:
      redactedFindings.mutableBlueprintReconciliationRequired,
    immutable_blueprint_ownership_required:
      redactedFindings.immutableBlueprintOwnershipRequired,
    immutable_blueprint_classroom_conflicts:
      redactedFindings.immutableBlueprintClassroomConflicts,
    registered_objects_missing_from_storage: redactedFindings.registeredMissing,
    rollout_gates: settingsAfter,
    gates_changed_by_command: false,
    ready_for_enforcement:
      coverageCounts.verified === classrooms.length
      && analysisAfter.orphans.length === 0
      && analysisAfter.shared.length === 0
      && analysisAfter.classroomBlueprintShared.length === 0
      && analysisAfter.blueprintShared.length === 0
      && analysisAfter.missing.length === 0
      && analysisAfter.missingBlueprint.length === 0
      && analysisAfter.mutableBlueprintReconciliationRequired.length === 0
      && analysisAfter.immutableBlueprintOwnershipRequired.length === 0
      && analysisAfter.immutableBlueprintClassroomConflicts.length === 0
      && analysisAfter.registeredMissing.length === 0,
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write(
      `Managed storage ${report.mode} complete: ${coverageCounts.verified}/${classrooms.length} `
      + `classrooms verified; ${coverageCounts.pending} pending; ${coverageCounts.blocked} blocked; `
      + `${coverageCounts.missing} coverage rows missing.\n`,
    )
    process.stdout.write(
      `Global evidence: ${report.discovered_reference_count} classroom and `
      + `${report.blueprint_reference_count} Blueprint references; ${analysisAfter.shared.length} `
      + `cross-classroom, ${analysisAfter.classroomBlueprintShared.length} classroom/Blueprint, `
      + `${analysisAfter.blueprintShared.length} cross-Blueprint shared; ${analysisAfter.missing.length} `
      + `classroom and ${analysisAfter.missingBlueprint.length} Blueprint missing; `
      + `${analysisAfter.registeredMissing.length} registered-but-missing; `
      + `${analysisAfter.orphans.length} unowned Storage orphans.\n`,
    )
    for (const orphan of redactedFindings.orphans) {
      process.stdout.write(
        `ORPHAN ${orphan.bucket} path_sha256=${orphan.storage_path_sha256}\n`,
      )
    }
    process.stdout.write(
      `Ready for ownership enforcement: ${report.ready_for_enforcement}. `
      + 'This command did not change either rollout gate.\n',
    )
  }
  if (args.command !== 'report' && !report.ready_for_enforcement) process.exitCode = 2
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown readiness failure'
  process.stderr.write(`Managed storage readiness failed: ${message}\n`)
  process.exitCode = 1
})
