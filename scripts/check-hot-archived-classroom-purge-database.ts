import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  getClassroomPurgeImpact,
  startClassroomPurge,
  tickClassroomPurge,
} from '@/lib/server/classroom-purge'

type ResponseError = { message: string } | null

function dataOrThrow<T>(
  label: string,
  response: { data: T; error: ResponseError },
): T {
  if (response.error) {
    throw new Error(`${label}: ${response.error.message}`)
  }
  return response.data
}

function assertFixture(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function requireLocalFixtureEnvironment() {
  if (process.env.PIKA_ALLOW_LOCAL_DESTRUCTIVE_PURGE_FIXTURE !== '1') {
    throw new Error(
      'Set PIKA_ALLOW_LOCAL_DESTRUCTIVE_PURGE_FIXTURE=1 to run the destructive local fixture',
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const databaseUrl = process.env.PIKA_LOCAL_DATABASE_URL
  if (!supabaseUrl || !databaseUrl) {
    throw new Error('Missing local Supabase fixture environment')
  }

  const apiUrl = new URL(supabaseUrl)
  const database = new URL(databaseUrl)
  const localHosts = new Set(['127.0.0.1', 'localhost'])
  if (!localHosts.has(apiUrl.hostname) || !localHosts.has(database.hostname)) {
    throw new Error('The destructive purge fixture may run only against local Supabase')
  }
  if (apiUrl.port !== '54321' || database.port !== '54322') {
    throw new Error('The destructive purge fixture target does not match Pika local Supabase')
  }

  return { supabaseUrl, databaseUrl }
}

async function main() {
  const { supabaseUrl, databaseUrl } = requireLocalFixtureEnvironment()
  const supabase = getServiceRoleClient()
  const fixtureId = randomUUID()
  const classroomId = randomUUID()
  const blueprintId = randomUUID()
  const purgeOperationId = randomUUID()
  const assignmentId = randomUUID()
  const assignmentDocId = randomUUID()
  const requirementId = randomUUID()
  const artifactId = randomUUID()
  const testId = randomUUID()
  const archiveOperationId = randomUUID()
  const archiveId = randomUUID()
  const gradexOperationId = randomUUID()
  const gradexExtractId = randomUUID()
  const failedArchiveOperationId = randomUUID()
  const failedArchiveId = randomUUID()
  const failedGradexOperationId = randomUUID()
  const externalArchiveOperationId = randomUUID()
  const externalClassroomId = randomUUID()
  const now = new Date()
  const nowIso = now.toISOString()
  const priorIso = new Date(now.getTime() - 60_000).toISOString()
  const expiryIso = new Date(now.getTime() + 86_400_000).toISOString()
  const suffix = fixtureId.slice(0, 8)

  const storageObjects = [
    {
      bucket: 'assignment-artifacts',
      path: `purge-fixture/${fixtureId}/submission.png`,
      contentType: 'image/png',
    },
    {
      bucket: 'submission-images',
      path: `purge-fixture/${fixtureId}/daily-log.png`,
      contentType: 'image/png',
    },
    {
      bucket: 'test-documents',
      path: `purge-fixture/${fixtureId}/test.pdf`,
      contentType: 'application/pdf',
    },
    {
      bucket: 'classroom-archives',
      path: `purge-fixture/${fixtureId}/classroom.tar.gz`,
      contentType: 'application/gzip',
    },
    {
      bucket: 'gradex-analytics-extracts',
      path: `purge-fixture/${fixtureId}/gradex.tar.gz`,
      contentType: 'application/gzip',
    },
    {
      bucket: 'classroom-archives',
      path: `purge-fixture/${fixtureId}/interrupted-classroom.tar.gz`,
      contentType: 'application/gzip',
    },
    {
      bucket: 'gradex-analytics-extracts',
      path: `purge-fixture/${fixtureId}/interrupted-gradex.tar.gz`,
      contentType: 'application/gzip',
    },
    {
      bucket: 'submission-images',
      path: `purge-fixture/${fixtureId}/shared-blueprint.png`,
      contentType: 'image/png',
    },
    {
      bucket: 'submission-images',
      path: `purge-fixture/${fixtureId}/encoded shared.png`,
      contentType: 'image/png',
    },
    {
      bucket: 'test-documents',
      path: `purge-fixture/${fixtureId}/encoded delete.pdf`,
      contentType: 'application/pdf',
    },
  ] as const

  let primaryError: unknown
  try {
    const teachers = dataOrThrow(
      'read fixture teacher',
      await supabase.from('users').select('id,email').eq('role', 'teacher').limit(1),
    )
    const students = dataOrThrow(
      'read fixture student',
      await supabase.from('users').select('id,email').eq('role', 'student').limit(1),
    )
    const teacher = teachers[0]
    const student = students[0]
    assertFixture(teacher, 'Local fixture requires one seeded teacher')
    assertFixture(student, 'Local fixture requires one seeded student')

    for (const object of storageObjects) {
      dataOrThrow(
        `upload ${object.bucket}`,
        await supabase.storage
          .from(object.bucket)
          .upload(
            object.path,
            new TextEncoder().encode(`Pika purge fixture ${object.bucket}`),
            { contentType: object.contentType, upsert: false },
          ),
      )
    }

    const publicStorageUrl = (bucket: string, path: string) =>
      `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/`
      + path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
    const submissionImageUrl = publicStorageUrl(
      storageObjects[1].bucket,
      storageObjects[1].path,
    )
    const sharedBlueprintImageUrl = publicStorageUrl(
      storageObjects[7].bucket,
      storageObjects[7].path,
    )
    const testDocumentUrl = publicStorageUrl(
      storageObjects[2].bucket,
      storageObjects[2].path,
    )
    const encodedSharedImageUrl = publicStorageUrl(
      storageObjects[8].bucket,
      storageObjects[8].path,
    )
    const encodedDeleteDocumentUrl = publicStorageUrl(
      storageObjects[9].bucket,
      storageObjects[9].path,
    )

    dataOrThrow(
      'insert fixture Blueprint',
      await supabase.from('course_blueprints').insert({
        id: blueprintId,
        teacher_id: teacher.id,
        title: `Purge fixture Blueprint ${suffix}`,
        overview_markdown:
          'Unrelated malformed escape: https://example.invalid/%FF\n'
          + `Preserved shared upload: ${sharedBlueprintImageUrl}\n`
          + `Preserved encoded upload: ${encodedSharedImageUrl}`,
      }),
    )
    dataOrThrow(
      'insert fixture classroom',
      await supabase.from('classrooms').insert({
        id: classroomId,
        teacher_id: teacher.id,
        title: `Purge fixture classroom ${suffix}`,
        class_code: `PURGE-${suffix}`,
        archived_at: nowIso,
        source_blueprint_id: blueprintId,
        course_overview_markdown:
          `Fixture upload: ${submissionImageUrl}\n`
          + `Shared: ${sharedBlueprintImageUrl}\n`
          + `Encoded shared: ${encodedSharedImageUrl}`,
      }),
    )
    dataOrThrow(
      'insert fixture enrollment',
      await supabase.from('classroom_enrollments').insert({
        classroom_id: classroomId,
        student_id: student.id,
      }),
    )
    dataOrThrow(
      'insert fixture roster',
      await supabase.from('classroom_roster').insert({
        classroom_id: classroomId,
        email: student.email,
        first_name: 'Purge',
        last_name: 'Fixture',
      }),
    )
    dataOrThrow(
      'insert fixture daily log',
      await supabase.from('entries').insert({
        classroom_id: classroomId,
        student_id: student.id,
        date: nowIso.slice(0, 10),
        on_time: false,
        minutes_reported: 15,
        mood: '😐',
        text: 'Fixture attendance and daily log',
        rich_content: { image: submissionImageUrl },
      }),
    )
    dataOrThrow(
      'insert fixture log summary',
      await supabase.from('log_summaries').insert({
        classroom_id: classroomId,
        date: nowIso.slice(0, 10),
        entry_count: 1,
        model: 'fixture',
        summary_items: [{ text: 'Fixture operational summary' }],
      }),
    )
    dataOrThrow(
      'insert fixture assignment',
      await supabase.from('assignments').insert({
        id: assignmentId,
        classroom_id: classroomId,
        created_by: teacher.id,
        title: 'Fixture assignment',
        due_at: expiryIso,
        points_possible: 100,
      }),
    )
    dataOrThrow(
      'insert fixture submission requirement',
      await supabase.from('assignment_submission_requirements').insert({
        id: requirementId,
        assignment_id: assignmentId,
        type: 'image',
        label: 'Fixture image',
      }),
    )
    dataOrThrow(
      'insert fixture submission and grade',
      await supabase.from('assignment_docs').insert({
        id: assignmentDocId,
        assignment_id: assignmentId,
        student_id: student.id,
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        content_legacy: 'Fixture student work',
      }),
    )
    dataOrThrow(
      'insert fixture assignment artifact',
      await supabase.from('assignment_submission_artifacts').insert({
        id: artifactId,
        assignment_doc_id: assignmentDocId,
        requirement_id: requirementId,
        student_id: student.id,
        type: 'image',
        storage_path: storageObjects[0].path,
        validation_status: 'valid',
      }),
    )
    dataOrThrow(
      'submit and grade fixture assignment',
      await supabase
        .from('assignment_docs')
        .update({
          is_submitted: true,
          submitted_at: nowIso,
          feedback: 'Fixture feedback',
          score_completion: 9,
          score_thinking: 8,
          score_workflow: 7,
        })
        .eq('id', assignmentDocId),
    )
    dataOrThrow(
      'insert fixture test',
      await supabase.from('tests').insert({
        id: testId,
        classroom_id: classroomId,
        created_by: teacher.id,
        title: 'Fixture test',
        status: 'closed',
        points_possible: 100,
        documents: [{
          id: randomUUID(),
          title: 'Fixture test document',
          source: 'upload',
          snapshot_path: storageObjects[2].path,
        }, {
          id: randomUUID(),
          title: 'Fixture encoded-path test document',
          source: 'upload',
          snapshot_path: storageObjects[9].path,
        }],
      }),
    )

    const revision = dataOrThrow(
      'read fixture classroom revision',
      await supabase
        .from('classroom_archive_revisions')
        .select('revision')
        .eq('classroom_id', classroomId)
        .single(),
    ).revision

    dataOrThrow(
      'insert fixture archive operation',
      await supabase.from('classroom_archive_operations').insert({
        id: archiveOperationId,
        teacher_id: teacher.id,
        classroom_id: classroomId,
        operation_type: 'export',
        request_sha256: 'a'.repeat(64),
        status: 'completed',
        source_revision: revision,
        source_schema_migration: '115_hot_archived_classroom_purge',
        source_app_commit: 'purge-fixture',
        retention: {},
        archive_id: archiveId,
        storage_bucket: 'classroom-archives',
        storage_path: storageObjects[3].path,
        artifact_sha256: 'b'.repeat(64),
        content_sha256: 'c'.repeat(64),
        compressed_byte_size: 32,
        uncompressed_byte_size: 64,
        verification: {},
        snapshot_created_at: priorIso,
        snapshot_expires_at: expiryIso,
        completed_at: nowIso,
        archive_format_version: 2,
        source_contract_version: 2,
        restore_contract_version: 2,
      }),
    )
    dataOrThrow(
      'insert fixture classroom archive',
      await supabase.from('classroom_archives').insert({
        id: archiveId,
        operation_id: archiveOperationId,
        classroom_id: classroomId,
        teacher_id: teacher.id,
        format: 'pika.classroom-archive',
        format_version: 2,
        source_revision: revision,
        source_schema_migration: '115_hot_archived_classroom_purge',
        source_app_commit: 'purge-fixture',
        storage_bucket: 'classroom-archives',
        storage_path: storageObjects[3].path,
        artifact_sha256: 'b'.repeat(64),
        content_sha256: 'c'.repeat(64),
        compressed_byte_size: 32,
        uncompressed_byte_size: 64,
        resource_counts: {},
        storage_object_counts: {},
        verification: {},
        retention: {},
        created_at: priorIso,
        verified_at: nowIso,
      }),
    )
    dataOrThrow(
      'insert fixture Gradex operation',
      await supabase.from('classroom_archive_operations').insert({
        id: gradexOperationId,
        teacher_id: teacher.id,
        classroom_id: classroomId,
        operation_type: 'gradex_extract',
        request_sha256: 'd'.repeat(64),
        status: 'completed',
        source_revision: revision,
        source_schema_migration: '115_hot_archived_classroom_purge',
        source_app_commit: 'purge-fixture',
        retention: { delete_after: expiryIso },
        archive_id: archiveId,
        storage_bucket: 'gradex-analytics-extracts',
        storage_path: storageObjects[4].path,
        artifact_sha256: 'e'.repeat(64),
        content_sha256: 'f'.repeat(64),
        compressed_byte_size: 32,
        uncompressed_byte_size: 64,
        verification: {},
        snapshot_created_at: priorIso,
        snapshot_expires_at: expiryIso,
        completed_at: nowIso,
        archive_format_version: 2,
        source_contract_version: 2,
        restore_contract_version: 2,
      }),
    )
    dataOrThrow(
      'insert fixture Gradex extract',
      await supabase.from('classroom_gradex_extracts').insert({
        id: gradexExtractId,
        operation_id: gradexOperationId,
        source_archive_id: archiveId,
        classroom_id: classroomId,
        teacher_id: teacher.id,
        format: 'pika.gradex-classroom-extract',
        format_version: 2,
        source_archive_sha256: 'b'.repeat(64),
        storage_bucket: 'gradex-analytics-extracts',
        storage_path: storageObjects[4].path,
        artifact_sha256: 'e'.repeat(64),
        content_sha256: 'f'.repeat(64),
        compressed_byte_size: 32,
        uncompressed_byte_size: 64,
        resource_counts: {},
        verification: {},
        generated_at: priorIso,
        verified_at: nowIso,
        delete_after: expiryIso,
      }),
    )
    dataOrThrow(
      'insert interrupted archive operation',
      await supabase.from('classroom_archive_operations').insert({
        id: failedArchiveOperationId,
        teacher_id: teacher.id,
        classroom_id: classroomId,
        operation_type: 'export',
        request_sha256: '1'.repeat(64),
        status: 'failed',
        source_revision: revision,
        source_schema_migration: '117_hot_archived_classroom_purge_review_hardening',
        source_app_commit: 'purge-fixture',
        retention: {},
        archive_id: failedArchiveId,
        storage_bucket: 'classroom-archives',
        storage_path: storageObjects[5].path,
        error_code: 'fixture_interrupted_upload',
        retryable: false,
        snapshot_created_at: priorIso,
        snapshot_expires_at: priorIso,
        archive_format_version: 2,
        source_contract_version: 2,
        restore_contract_version: 2,
      }),
    )
    dataOrThrow(
      'insert interrupted archive upload cleanup',
      await supabase.from('classroom_archive_object_upload_cleanup').insert({
        operation_id: failedArchiveOperationId,
        storage_bucket: 'classroom-archives',
        storage_path: storageObjects[5].path,
        expected_sha256: '2'.repeat(64),
        expected_byte_size: 32,
        status: 'pending',
        next_attempt_at: expiryIso,
      }),
    )
    dataOrThrow(
      'insert interrupted Gradex operation',
      await supabase.from('classroom_archive_operations').insert({
        id: failedGradexOperationId,
        teacher_id: teacher.id,
        classroom_id: classroomId,
        operation_type: 'gradex_extract',
        request_sha256: '3'.repeat(64),
        status: 'failed',
        source_revision: revision,
        source_schema_migration: '117_hot_archived_classroom_purge_review_hardening',
        source_app_commit: 'purge-fixture',
        retention: { delete_after: expiryIso },
        archive_id: archiveId,
        storage_bucket: 'gradex-analytics-extracts',
        storage_path: storageObjects[6].path,
        error_code: 'fixture_interrupted_upload',
        retryable: false,
        snapshot_created_at: priorIso,
        snapshot_expires_at: priorIso,
        archive_format_version: 2,
        source_contract_version: 2,
        restore_contract_version: 2,
      }),
    )
    dataOrThrow(
      'insert interrupted Gradex upload cleanup',
      await supabase.from('classroom_gradex_extract_cleanup').insert({
        operation_id: failedGradexOperationId,
        storage_bucket: 'gradex-analytics-extracts',
        storage_path: storageObjects[6].path,
        delete_after: expiryIso,
        status: 'pending',
        next_attempt_at: expiryIso,
      }),
    )

    const impact = await getClassroomPurgeImpact(teacher.id, classroomId)
    assertFixture(
      impact.managed_file_count === 10,
      'Fixture did not inventory verified, interrupted, and shared files',
    )
    assertFixture(impact.student_count === 1, 'Fixture did not inventory the student')
    assertFixture(impact.storage_counts['assignment-artifacts'] === 1, 'Artifact inventory drift')
    assertFixture(impact.storage_counts['submission-images'] === 3, 'Image inventory drift')
    assertFixture(impact.storage_counts['test-documents'] === 2, 'Test document inventory drift')
    assertFixture(impact.storage_counts['classroom-archives'] === 2, 'Archive inventory drift')
    assertFixture(
      impact.storage_counts['gradex-analytics-extracts'] === 2,
      'Gradex inventory drift',
    )

    let status = await startClassroomPurge({
      teacherId: teacher.id,
      classroomId,
      operationId: purgeOperationId,
      confirmation: 'DELETE',
    })
    const reservedReference = await supabase
      .from('course_blueprints')
      .update({
        resources_markdown: `Must be blocked during purge: ${testDocumentUrl}`,
      })
      .eq('id', blueprintId)
    assertFixture(
      reservedReference.error?.message.includes('being permanently deleted'),
      'Blueprint writer acquired a storage path reserved for deletion',
    )
    const encodedReservedReference = await supabase
      .from('course_blueprints')
      .update({
        resources_markdown:
          'Unrelated NUL escape: https://example.invalid/%00\n'
          + `Encoded path must be blocked during purge: ${encodedDeleteDocumentUrl}`,
      })
      .eq('id', blueprintId)
    assertFixture(
      encodedReservedReference.error?.message.includes('being permanently deleted'),
      'Poisoned Blueprint field acquired a URL-encoded path reserved for deletion',
    )
    const deletedReservations = dataOrThrow(
      'read post-delete path reservation',
      await supabase
        .from('classroom_purge_objects')
        .select('storage_bucket,storage_path')
        .eq('operation_id', purgeOperationId)
        .eq('status', 'deleted')
        .not('storage_path', 'is', null)
        .limit(1),
    )
    const deletedReservation = deletedReservations[0]
    assertFixture(
      deletedReservation?.storage_path,
      'Deleted managed file lost its reservation before relational finalization',
    )
    const postDeleteBlueprintReference = await supabase
      .from('course_blueprints')
      .update({
        resources_markdown:
          `Must remain blocked after Storage deletion: ${deletedReservation.storage_path}`,
      })
      .eq('id', blueprintId)
    assertFixture(
      postDeleteBlueprintReference.error?.message.includes('being permanently deleted'),
      'Blueprint writer acquired a deleted path before purge finalization',
    )
    const externalOperationalReference = await supabase
      .from('classroom_archive_operations')
      .insert({
        id: externalArchiveOperationId,
        teacher_id: teacher.id,
        classroom_id: externalClassroomId,
        operation_type: 'export',
        request_sha256: '4'.repeat(64),
        status: 'failed',
        source_revision: 1,
        source_schema_migration: '118_hot_archived_classroom_purge_reservation_lifetime',
        source_app_commit: 'purge-fixture',
        retention: { delete_after: expiryIso },
        storage_bucket: deletedReservation.storage_bucket,
        storage_path: deletedReservation.storage_path,
        error_code: 'fixture_external_reference',
        retryable: false,
        snapshot_created_at: priorIso,
        snapshot_expires_at: priorIso,
      })
    assertFixture(
      externalOperationalReference.error?.message.includes('being permanently deleted'),
      'Archive writer acquired a managed path reserved by another classroom purge',
    )

    for (let tick = 0; tick < 18 && status.status !== 'completed'; tick += 1) {
      status = await tickClassroomPurge(teacher.id, purgeOperationId)
    }
    const objectDiagnostics = status.status === 'completed'
      ? []
      : dataOrThrow(
          'read fixture purge diagnostics',
          await supabase
            .from('classroom_purge_objects')
            .select('storage_bucket,status,last_error_code')
            .eq('operation_id', purgeOperationId),
        )
    assertFixture(
      status.status === 'completed',
      `Fixture purge did not complete: ${JSON.stringify({ status, objectDiagnostics })}`,
    )
    assertFixture(
      status.storage_object_counts.deleted === 8
        && status.storage_object_counts.preserved === 2,
      'Fixture purge did not record eight deletions and two shared preservations',
    )

    const classroom = dataOrThrow(
      'verify classroom deletion',
      await supabase.from('classrooms').select('id').eq('id', classroomId).maybeSingle(),
    )
    const assignment = dataOrThrow(
      'verify assignment deletion',
      await supabase.from('assignments').select('id').eq('id', assignmentId).maybeSingle(),
    )
    const artifact = dataOrThrow(
      'verify artifact deletion',
      await supabase
        .from('assignment_submission_artifacts')
        .select('id')
        .eq('id', artifactId)
        .maybeSingle(),
    )
    const test = dataOrThrow(
      'verify test deletion',
      await supabase.from('tests').select('id').eq('id', testId).maybeSingle(),
    )
    const archive = dataOrThrow(
      'verify archive metadata deletion',
      await supabase.from('classroom_archives').select('id').eq('id', archiveId).maybeSingle(),
    )
    const extract = dataOrThrow(
      'verify Gradex metadata deletion',
      await supabase
        .from('classroom_gradex_extracts')
        .select('id')
        .eq('id', gradexExtractId)
        .maybeSingle(),
    )
    assertFixture(!classroom, 'Classroom row survived the purge')
    assertFixture(!assignment, 'Assignment row survived the purge')
    assertFixture(!artifact, 'Assignment artifact row survived the purge')
    assertFixture(!test, 'Test row survived the purge')
    assertFixture(!archive, 'Classroom archive metadata survived the purge')
    assertFixture(!extract, 'Gradex extract metadata survived the purge')

    const preservedBlueprint = dataOrThrow(
      'verify Blueprint preservation',
      await supabase.from('course_blueprints').select('id').eq('id', blueprintId).maybeSingle(),
    )
    const preservedTeacher = dataOrThrow(
      'verify teacher preservation',
      await supabase.from('users').select('id').eq('id', teacher.id).maybeSingle(),
    )
    const preservedStudent = dataOrThrow(
      'verify student preservation',
      await supabase.from('users').select('id').eq('id', student.id).maybeSingle(),
    )
    assertFixture(preservedBlueprint, 'Reusable Blueprint was deleted')
    assertFixture(preservedTeacher, 'Teacher account was deleted')
    assertFixture(preservedStudent, 'Student account was deleted')

    const purgeObjects = dataOrThrow(
      'verify purge object ledger',
      await supabase
        .from('classroom_purge_objects')
        .select('status,storage_path')
        .eq('operation_id', purgeOperationId),
    )
    assertFixture(purgeObjects.length === 10, 'Purge object ledger is incomplete')
    assertFixture(
      purgeObjects.every((object) =>
        (object.status === 'deleted' || object.status === 'preserved')
        && object.storage_path === null
      ),
      'Purge object ledger retained a storage path or non-terminal object',
    )

    for (const object of [...storageObjects.slice(0, 7), storageObjects[9]]) {
      const separator = object.path.lastIndexOf('/')
      const directory = object.path.slice(0, separator)
      const objectName = object.path.slice(separator + 1)
      const listing = dataOrThrow(
        `verify ${object.bucket} deletion`,
        await supabase.storage
          .from(object.bucket)
          .list(directory, { limit: 100, search: objectName }),
      )
      assertFixture(
        !listing.some((candidate) => candidate.name === objectName),
        `${object.bucket}/${object.path} survived the purge`,
      )
    }
    const sharedSeparator = storageObjects[7].path.lastIndexOf('/')
    const sharedListing = dataOrThrow(
      'verify shared Blueprint upload preservation',
      await supabase.storage.from(storageObjects[7].bucket).list(
        storageObjects[7].path.slice(0, sharedSeparator),
        {
          limit: 100,
          search: storageObjects[7].path.slice(sharedSeparator + 1),
        },
      ),
    )
    assertFixture(
      sharedListing.some((candidate) =>
        candidate.name === storageObjects[7].path.slice(sharedSeparator + 1)
      ),
      'Shared Blueprint upload was deleted',
    )
    const encodedSharedSeparator = storageObjects[8].path.lastIndexOf('/')
    const encodedSharedListing = dataOrThrow(
      'verify encoded shared Blueprint upload preservation',
      await supabase.storage.from(storageObjects[8].bucket).list(
        storageObjects[8].path.slice(0, encodedSharedSeparator),
        {
          limit: 100,
          search: storageObjects[8].path.slice(encodedSharedSeparator + 1),
        },
      ),
    )
    assertFixture(
      encodedSharedListing.some((candidate) =>
        candidate.name === storageObjects[8].path.slice(encodedSharedSeparator + 1)
      ),
      'Encoded shared Blueprint upload was deleted',
    )

    process.stdout.write(
      `Hot archived classroom purge fixture passed: `
      + `${impact.relational_row_count} relational rows and 8 managed files deleted; `
      + 'two shared files, Blueprint, and user accounts preserved.\n',
    )
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    for (const object of storageObjects) {
      await supabase.storage.from(object.bucket).remove([object.path])
    }

    const cleanupSql = `
      begin;
      select set_config('pika.classroom_purge_finalize', 'on', true);
      delete from public.classroom_purge_operations where id = '${purgeOperationId}';
      delete from public.classroom_gradex_extract_cleanup
        where operation_id = '${gradexOperationId}' or extract_id = '${gradexExtractId}';
      delete from public.classroom_gradex_extracts where id = '${gradexExtractId}';
      delete from public.classroom_archives where id = '${archiveId}';
      delete from public.classroom_archive_operations
        where id in (
          '${archiveOperationId}',
          '${gradexOperationId}',
          '${failedArchiveOperationId}',
          '${failedGradexOperationId}',
          '${externalArchiveOperationId}'
        );
      delete from public.classrooms where id = '${classroomId}';
      delete from public.course_blueprints where id = '${blueprintId}';
      commit;
    `
    try {
      execFileSync(
        'psql',
        [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-c', cleanupSql],
        { stdio: 'pipe' },
      )
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError
      process.stderr.write('Fixture cleanup also failed; inspect the generated fixture IDs.\n')
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown fixture failure'
  process.stderr.write(`Hot archived classroom purge fixture failed: ${message}\n`)
  process.exitCode = 1
})
