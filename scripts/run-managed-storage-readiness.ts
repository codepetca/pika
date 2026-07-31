import { execFileSync } from 'node:child_process'
import { config as loadEnvironment } from 'dotenv'
import { z } from 'zod'
import {
  collectExactReadPages,
  createSupabaseClassroomArchiveInventoryReader,
  readClassroomArchiveResourceGraph,
} from '@/lib/server/classroom-archive-inventory'
import {
  backfillAllClassroomManagedStorage,
  collectManagedStorageBackfillCandidates,
} from '@/lib/server/managed-storage-backfill'
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
const coverageSchema = z.object({
  classroom_id: z.string().uuid(),
  status: z.enum(['pending', 'verified', 'blocked']),
  reference_count: z.number().int().nonnegative().nullable(),
  object_count: z.number().int().nonnegative().nullable(),
  error_code: z.string().nullable(),
}).strict()

type SupabaseClient = ReturnType<typeof getServiceRoleClient>
type Classroom = z.infer<typeof classroomSchema>

function gitOutput(args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
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

  const classrooms = await readAllClassrooms(supabase)
  const discoveredClassrooms = []
  for (const [index, classroom] of classrooms.entries()) {
    process.stderr.write(
      `Managed storage discovery ${index + 1}/${classrooms.length}: ${classroom.id}\n`,
    )
    let stable: {
      sourceRevision: number
      resources: Record<string, Array<Record<string, unknown>>>
    } | undefined
    for (let attempt = 0; attempt < 3 && !stable; attempt += 1) {
      const revisionBefore = z.coerce.number().int().positive().parse(
        await reader.readRevision(classroom.id),
      )
      const resources = await readClassroomArchiveResourceGraph(reader, classroom.id)
      const revisionAfter = z.coerce.number().int().positive().parse(
        await reader.readRevision(classroom.id),
      )
      if (revisionBefore === revisionAfter) {
        stable = { sourceRevision: revisionAfter, resources }
      }
    }
    if (!stable) throw new Error(`Classroom ${classroom.id} did not stabilize during discovery`)
    discoveredClassrooms.push({
      teacherId: classroom.teacher_id,
      classroomId: classroom.id,
      ...stable,
    })
  }
  const classroomSetAfterDiscovery = await readAllClassrooms(supabase)
  if (JSON.stringify(classroomSetAfterDiscovery) !== JSON.stringify(classrooms)) {
    throw new Error('All-classroom set changed after discovery; no ownership was written')
  }

  const coverageBefore = await readCoverage(supabase)
  const coverageByClassroom = new Map(coverageBefore.map((row) => [row.classroom_id, row]))
  const discovered = discoveredClassrooms.flatMap((classroom) =>
    collectManagedStorageBackfillCandidates({
      resources: classroom.resources,
      supabaseUrl: target.supabaseOrigin,
    })
      .map((object) => ({ ...object, classroomId: classroom.classroomId })),
  )
  const catalogBefore = readManagedStorageCatalog(target.psqlEnvironment)
  const analysisBefore = analyzeGlobalManagedStorage({ ...catalogBefore, discovered })
  const settingsBefore = await readSettings(supabase)
  const pendingClassrooms = discoveredClassrooms.filter((classroom) =>
    coverageByClassroom.get(classroom.classroomId)?.status !== 'verified',
  )

  if (args.command !== 'report') {
    if (settingsBefore.enforce_ownership || settingsBefore.hot_classroom_purge_enabled) {
      throw new Error(
        'Backfill execution requires both managed storage rollout gates to remain false',
      )
    }
    if (analysisBefore.shared.length > 0) {
      throw new Error('Cross-classroom shared paths must be resolved before ownership writes')
    }
    if (analysisBefore.missing.length > 0) {
      throw new Error('Missing referenced Storage objects must be resolved before ownership writes')
    }
    if (analysisBefore.registeredMissing.length > 0) {
      throw new Error('Registered managed objects missing from Storage must be resolved first')
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
  const analysisAfter = analyzeGlobalManagedStorage({ ...catalogAfter, discovered })
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
    global_orphans: redactedFindings.orphans,
    cross_classroom_shared_paths: redactedFindings.shared,
    missing_referenced_objects: redactedFindings.missing,
    registered_objects_missing_from_storage: redactedFindings.registeredMissing,
    rollout_gates: settingsAfter,
    gates_changed_by_command: false,
    ready_for_enforcement:
      coverageCounts.verified === classrooms.length
      && analysisAfter.orphans.length === 0
      && analysisAfter.shared.length === 0
      && analysisAfter.missing.length === 0
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
      `Global evidence: ${report.discovered_reference_count} discovered references; `
      + `${analysisAfter.shared.length} shared; ${analysisAfter.missing.length} missing; `
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
