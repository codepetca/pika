import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  assertLocalClassroomArchiveRecoveryDrillTarget,
} from '@/lib/server/classroom-archive-recovery-drill'
import {
  canonicalJsonStringify,
  sha256Bytes,
} from '@/lib/server/classroom-archive-format'
import { compactClassroomArchive } from '@/lib/server/classroom-archive-compaction'
import { exportClassroomArchive } from '@/lib/server/classroom-archive-operations'
import { restoreClassroomArchive } from '@/lib/server/classroom-archive-restore-operations'
import { classroomArchiveRestoreObjectPath } from '@/lib/server/classroom-archive-restore'
import { runClassroomArchiveSourceCleanup } from '@/lib/server/classroom-archive-source-cleanup'
import { getServiceRoleClient } from '@/lib/supabase'

const archiveMetadataSchema = z.object({
  id: z.string().uuid(),
  storage_bucket: z.literal('classroom-archives'),
  storage_path: z.string().min(1),
}).passthrough()
const sourceObjectPresenceSchema = z.object({
  bucket_exists: z.boolean(),
  object_exists: z.boolean(),
}).strict()

const fixtureTables = [
  'classrooms',
  'classroom_enrollments',
  'assignments',
  'assignment_docs',
  'assignment_submission_requirements',
  'assignment_submission_artifacts',
] as const

type SupabaseClient = ReturnType<typeof getServiceRoleClient>
type FixtureTable = typeof fixtureTables[number]
type FixtureIds = Record<FixtureTable, string> & {
  teacher: string
  student: string
  studentProfile: string
  exportOperation: string
  compactionOperation: string
  restoreOperation: string
  cleanupLease: string
}

function fixtureIds(): FixtureIds {
  return {
    teacher: randomUUID(),
    student: randomUUID(),
    studentProfile: randomUUID(),
    classrooms: randomUUID(),
    classroom_enrollments: randomUUID(),
    assignments: randomUUID(),
    assignment_docs: randomUUID(),
    assignment_submission_requirements: randomUUID(),
    assignment_submission_artifacts: randomUUID(),
    exportOperation: randomUUID(),
    compactionOperation: randomUUID(),
    restoreOperation: randomUUID(),
    cleanupLease: randomUUID(),
  }
}

function operationFailure(label: string, result: { error_code: string }): never {
  throw new Error(`${label} failed: ${result.error_code}`)
}

async function insertFixtureRow(
  supabase: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
) {
  const response = await supabase.from(table).insert(row)
  if (response.error) throw new Error(`Fixture insert failed for ${table}: ${response.error.code}`)
}

async function loadFixtureRow(
  supabase: SupabaseClient,
  table: FixtureTable,
  id: string,
): Promise<Record<string, unknown>> {
  const response = await supabase.from(table).select('*').eq('id', id).single()
  if (response.error || !response.data) {
    throw new Error(`Fixture row is unavailable for ${table}: ${response.error?.code || 'missing'}`)
  }
  return z.record(z.string(), z.unknown()).parse(response.data)
}

async function loadFixtureSnapshot(
  supabase: SupabaseClient,
  ids: FixtureIds,
): Promise<Record<FixtureTable, Record<string, unknown>>> {
  return Object.fromEntries(await Promise.all(
    fixtureTables.map(async (table) => [
      table,
      await loadFixtureRow(supabase, table, ids[table]),
    ]),
  )) as Record<FixtureTable, Record<string, unknown>>
}

async function readStorageBytes(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
): Promise<Uint8Array> {
  const response = await supabase.storage.from(bucket).download(path)
  if (response.error || !response.data) {
    throw new Error(`Recovery drill object is unavailable in ${bucket}`)
  }
  return new Uint8Array(await response.data.arrayBuffer())
}

async function assertStorageObjectAbsent(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
) {
  const response = await supabase.storage.from(bucket).download(path)
  if (response.data) {
    throw new Error(`Recovery drill expected no object in ${bucket}`)
  }
  const presenceResponse = await supabase.rpc(
    'get_classroom_archive_source_object_presence',
    { p_storage_bucket: bucket, p_storage_path: path },
  )
  const presence = sourceObjectPresenceSchema.safeParse(presenceResponse.data)
  if (
    !presenceResponse.error
    && presence.success
    && presence.data.bucket_exists
    && !presence.data.object_exists
  ) return
  throw new Error(`Recovery drill could not verify object absence in ${bucket}`)
}

async function assertRowAbsent(
  supabase: SupabaseClient,
  table: string,
  column: string,
  value: string,
) {
  const response = await supabase.from(table).select(column).eq(column, value).maybeSingle()
  if (response.error || response.data) {
    throw new Error(`Recovery drill expected no ${table} row`)
  }
}

async function createFixture(args: {
  supabase: SupabaseClient
  ids: FixtureIds
  sourceObjectPath: string
  sourceObjectBytes: Uint8Array
}) {
  const runLabel = args.ids.classrooms.slice(0, 8)
  await insertFixtureRow(args.supabase, 'users', {
    id: args.ids.teacher,
    email: `archive-recovery-teacher-${runLabel}@example.test`,
    role: 'teacher',
  })
  await insertFixtureRow(args.supabase, 'users', {
    id: args.ids.student,
    email: `archive-recovery-student-${runLabel}@example.test`,
    role: 'student',
  })
  await insertFixtureRow(args.supabase, 'student_profiles', {
    id: args.ids.studentProfile,
    user_id: args.ids.student,
    student_number: `R-${runLabel}`,
    first_name: 'Recovery',
    last_name: 'Fixture',
  })
  await insertFixtureRow(args.supabase, 'classrooms', {
    id: args.ids.classrooms,
    teacher_id: args.ids.teacher,
    title: 'Archive recovery drill fixture',
    class_code: `R${runLabel.replaceAll('-', '').slice(0, 5)}`,
    archived_at: '2026-07-13T12:00:00.000Z',
  })
  await insertFixtureRow(args.supabase, 'classroom_enrollments', {
    id: args.ids.classroom_enrollments,
    classroom_id: args.ids.classrooms,
    student_id: args.ids.student,
  })
  await insertFixtureRow(args.supabase, 'assignments', {
    id: args.ids.assignments,
    classroom_id: args.ids.classrooms,
    title: 'Recovery drill assignment',
    description: 'Synthetic archive recovery content',
    due_at: '2026-07-20T16:00:00.000Z',
    created_by: args.ids.teacher,
  })
  await insertFixtureRow(args.supabase, 'assignment_docs', {
    id: args.ids.assignment_docs,
    assignment_id: args.ids.assignments,
    student_id: args.ids.student,
    content: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Synthetic recovery answer' }],
      }],
    },
    is_submitted: true,
    submitted_at: '2026-07-13T13:00:00.000Z',
  })
  await insertFixtureRow(args.supabase, 'assignment_submission_requirements', {
    id: args.ids.assignment_submission_requirements,
    assignment_id: args.ids.assignments,
    type: 'image',
    label: 'Recovery evidence',
    required: true,
    position: 0,
  })

  const upload = await args.supabase.storage
    .from('assignment-artifacts')
    .upload(args.sourceObjectPath, args.sourceObjectBytes, {
      contentType: 'image/png',
      upsert: false,
    })
  if (upload.error) throw new Error(`Fixture storage upload failed: ${upload.error.name}`)

  await insertFixtureRow(args.supabase, 'assignment_submission_artifacts', {
    id: args.ids.assignment_submission_artifacts,
    assignment_doc_id: args.ids.assignment_docs,
    requirement_id: args.ids.assignment_submission_requirements,
    student_id: args.ids.student,
    type: 'image',
    storage_path: args.sourceObjectPath,
    validation_status: 'valid',
    validated_at: '2026-07-13T13:01:00.000Z',
  })
}

async function removeFixture(args: {
  supabase: SupabaseClient
  ids: FixtureIds
  sourceObjectPath: string
  restoredObjectPath: string
  archiveObjectPath?: string
}) {
  const failures: string[] = []
  const pathHashResponse = await args.supabase.rpc(
    'classroom_archive_source_object_path_sha256',
    {
      p_storage_bucket: 'assignment-artifacts',
      p_storage_path: args.sourceObjectPath,
    },
  )
  const sourcePathHash = typeof pathHashResponse.data === 'string'
    ? pathHashResponse.data
    : null
  if (pathHashResponse.error || !sourcePathHash) failures.push('reservation:path-hash')

  const removeObjects = async (bucket: string, paths: string[]) => {
    const response = await args.supabase.storage.from(bucket).remove(paths)
    if (response.error) failures.push(`storage:${bucket}`)
  }
  await removeObjects('assignment-artifacts', [args.sourceObjectPath, args.restoredObjectPath])
  if (args.archiveObjectPath) {
    await removeObjects('classroom-archives', [args.archiveObjectPath])
  }

  const deleteRows = async (table: string, column: string, values: string[]) => {
    const response = await args.supabase.from(table).delete().in(column, values)
    if (response.error) failures.push(`table:${table}:${response.error.code}`)
  }
  await deleteRows('classroom_cold_tombstones', 'classroom_id', [args.ids.classrooms])
  await deleteRows(
    'classroom_archive_operations',
    'id',
    [args.ids.restoreOperation, args.ids.compactionOperation],
  )
  await deleteRows('classroom_archives', 'id', [args.ids.exportOperation])
  await deleteRows('classroom_archive_operations', 'id', [args.ids.exportOperation])
  await deleteRows('classrooms', 'id', [args.ids.classrooms])
  await deleteRows('users', 'id', [args.ids.student, args.ids.teacher])

  if (sourcePathHash) {
    const reservation = await args.supabase
      .from('classroom_archive_source_object_reservations')
      .select('storage_bucket,storage_path_sha256,operation_id')
      .eq('storage_bucket', 'assignment-artifacts')
      .eq('storage_path_sha256', sourcePathHash)
      .maybeSingle()
    if (
      reservation.error
      || reservation.data?.storage_path_sha256 !== sourcePathHash
      || reservation.data.operation_id !== null
    ) {
      failures.push('reservation:deidentified-fence')
    }
  }

  for (const [table, column, value] of [
    ['classroom_archive_operations', 'id', args.ids.exportOperation],
    ['classroom_archives', 'id', args.ids.exportOperation],
    ['classrooms', 'id', args.ids.classrooms],
    ['users', 'id', args.ids.teacher],
    ['users', 'id', args.ids.student],
  ] as const) {
    try {
      await assertRowAbsent(args.supabase, table, column, value)
    } catch {
      failures.push(`leftover:${table}`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`Recovery drill fixture teardown failed: ${failures.join(',')}`)
  }
}

async function runRecoveryDrill() {
  const target = assertLocalClassroomArchiveRecoveryDrillTarget({
    acknowledgement: process.env.CLASSROOM_ARCHIVE_RECOVERY_DRILL_ACK,
    serviceRoleKey: process.env.SUPABASE_SECRET_KEY,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  })
  const ids = fixtureIds()
  const supabase = getServiceRoleClient()
  const sourceObjectPath = `recovery-drill/${ids.classrooms}/evidence.png`
  const sourceObjectBytes = Buffer.from('pika synthetic classroom archive recovery evidence')
  const sourceObjectSha256 = sha256Bytes(sourceObjectBytes)
  const restoredObjectPath = classroomArchiveRestoreObjectPath({
    classroomId: ids.classrooms,
    operationId: ids.restoreOperation,
    sha256: sourceObjectSha256,
    sourcePath: sourceObjectPath,
    contentType: 'image/png',
  })
  let archiveObjectPath =
    `${ids.teacher}/${ids.classrooms}/${ids.exportOperation}/classroom-v1.tar.gz`
  let completed = false

  try {
    await createFixture({ supabase, ids, sourceObjectPath, sourceObjectBytes })
    const expectedRows = await loadFixtureSnapshot(supabase, ids)

    const exported = await exportClassroomArchive({
      supabase,
      operationId: ids.exportOperation,
      teacherId: ids.teacher,
      classroomId: ids.classrooms,
      retention: { mode: 'teacher_managed', delete_after: null },
      sourceAppCommit: '0000000',
      supabaseUrl: target.supabaseUrl,
    })
    if (!exported.ok) operationFailure('Archive export', exported)

    const archiveResponse = await supabase
      .from('classroom_archives')
      .select('*')
      .eq('id', ids.exportOperation)
      .single()
    if (archiveResponse.error || !archiveResponse.data) {
      throw new Error('Verified archive metadata is unavailable')
    }
    const archive = archiveMetadataSchema.parse(archiveResponse.data)
    archiveObjectPath = archive.storage_path
    await readStorageBytes(supabase, archive.storage_bucket, archive.storage_path)

    process.env.CLASSROOM_ARCHIVE_COMPACTION_ENABLED = 'true'
    process.env.CLASSROOM_ARCHIVE_COMPACTION_TEACHER_IDS = ids.teacher
    process.env.CLASSROOM_ARCHIVE_COMPACTION_ARCHIVE_IDS = ids.exportOperation
    const compacted = await compactClassroomArchive({
      supabase,
      operationId: ids.compactionOperation,
      teacherId: ids.teacher,
      classroomId: ids.classrooms,
      archiveId: ids.exportOperation,
      supabaseUrl: target.supabaseUrl,
    })
    if (!compacted.ok) operationFailure('Archive compaction', compacted)
    await assertRowAbsent(supabase, 'classrooms', 'id', ids.classrooms)
    const coldTombstone = await supabase
      .from('classroom_cold_tombstones')
      .select('classroom_id')
      .eq('classroom_id', ids.classrooms)
      .single()
    if (coldTombstone.error || !coldTombstone.data) {
      throw new Error('Archive compaction did not create a cold tombstone')
    }

    process.env.CLASSROOM_ARCHIVE_SOURCE_CLEANUP_ENABLED = 'true'
    const cleaned = await runClassroomArchiveSourceCleanup({
      supabase,
      leaseToken: ids.cleanupLease,
      operationId: ids.compactionOperation,
      limit: 10,
      leaseSeconds: 300,
    })
    if (!cleaned.ok) operationFailure('Archive source cleanup', cleaned)
    if (cleaned.claimed !== 1 || cleaned.deleted !== 1 || cleaned.failed !== 0) {
      throw new Error('Ownership-fenced archive source cleanup did not delete exactly one object')
    }
    await assertStorageObjectAbsent(
      supabase,
      'assignment-artifacts',
      sourceObjectPath,
    )

    const restored = await restoreClassroomArchive({
      supabase,
      operationId: ids.restoreOperation,
      archiveId: ids.exportOperation,
      teacherId: ids.teacher,
      classroomId: ids.classrooms,
      databaseBudgetBytes: 2_147_483_648,
      supabaseUrl: target.supabaseUrl,
    })
    if (!restored.ok) operationFailure('Archive restore', restored)

    const expectedRestoredRows = structuredClone(expectedRows)
    expectedRestoredRows.assignment_submission_artifacts.storage_path = restoredObjectPath
    const actualRestoredRows = await loadFixtureSnapshot(supabase, ids)
    if (
      canonicalJsonStringify(actualRestoredRows) !==
      canonicalJsonStringify(expectedRestoredRows)
    ) {
      throw new Error('Restored classroom rows differ from the verified source snapshot')
    }

    const restoredObjectBytes = await readStorageBytes(
      supabase,
      'assignment-artifacts',
      restoredObjectPath,
    )
    if (sha256Bytes(restoredObjectBytes) !== sourceObjectSha256) {
      throw new Error('Restored classroom object differs from the verified source object')
    }
    await assertRowAbsent(
      supabase,
      'classroom_cold_tombstones',
      'classroom_id',
      ids.classrooms,
    )
    await readStorageBytes(supabase, archive.storage_bucket, archive.storage_path)

    const exportReplay = await exportClassroomArchive({
      supabase,
      operationId: ids.exportOperation,
      teacherId: ids.teacher,
      classroomId: ids.classrooms,
      retention: { mode: 'teacher_managed', delete_after: null },
      sourceAppCommit: '0000000',
      supabaseUrl: target.supabaseUrl,
    })
    const compactionReplay = await compactClassroomArchive({
      supabase,
      operationId: ids.compactionOperation,
      teacherId: ids.teacher,
      classroomId: ids.classrooms,
      archiveId: ids.exportOperation,
      supabaseUrl: target.supabaseUrl,
    })
    const restoreReplay = await restoreClassroomArchive({
      supabase,
      operationId: ids.restoreOperation,
      archiveId: ids.exportOperation,
      teacherId: ids.teacher,
      classroomId: ids.classrooms,
      databaseBudgetBytes: 2_147_483_648,
      supabaseUrl: target.supabaseUrl,
    })
    const cleanupReplay = await runClassroomArchiveSourceCleanup({
      supabase,
      leaseToken: randomUUID(),
      operationId: ids.compactionOperation,
      limit: 10,
      leaseSeconds: 300,
    })
    if (!exportReplay.ok || !exportReplay.replayed) {
      throw new Error('Archive export replay was not idempotent')
    }
    if (!compactionReplay.ok || !compactionReplay.replayed) {
      throw new Error('Archive compaction replay was not idempotent')
    }
    if (!restoreReplay.ok || !restoreReplay.replayed) {
      throw new Error('Archive restore replay was not idempotent')
    }
    if (!cleanupReplay.ok || cleanupReplay.claimed !== 0) {
      throw new Error('Archive cleanup replay claimed completed work')
    }

    completed = true
    console.info('[classroom-archive-recovery-drill]', JSON.stringify({
      format: 'pika.classroom-archive-recovery-drill',
      version: 1,
      status: 'passed',
      target: 'loopback-supabase',
      fixture_classroom_id: ids.classrooms,
      resource_table_count: Object.keys(exported.resource_counts).length,
      representative_rows_verified: fixtureTables.length,
      storage_objects_verified: 1,
      source_cleanup_deletion_verified: true,
      deidentified_source_fence_retained: true,
      immutable_archive_retained: true,
      cold_tombstone_removed: true,
      idempotent_replays_verified: 4,
    }))
  } finally {
    try {
      await removeFixture({
        supabase,
        ids,
        sourceObjectPath,
        restoredObjectPath,
        archiveObjectPath,
      })
    } catch (error) {
      if (completed) throw error
      console.error(error instanceof Error ? error.message : 'Recovery drill teardown failed')
    }
  }
}

runRecoveryDrill().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Classroom archive recovery drill failed')
  process.exitCode = 1
})
