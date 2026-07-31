import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  getClassroomPurgeImpact,
  startClassroomPurge,
  tickClassroomPurge,
} from '@/lib/server/classroom-purge'
import {
  adoptManagedStorageUpload,
  queueManagedStorageCleanup,
  reserveManagedStorageUpload,
  type ManagedSourceBucket,
  type ManagedStoragePurpose,
} from '@/lib/server/managed-storage'
import { getServiceRoleClient } from '@/lib/supabase'

type ResponseError = { code?: string; message: string } | null
type FixtureObject = {
  id: string
  bucket: ManagedSourceBucket
  path: string
  contentType: string
  purpose: ManagedStoragePurpose
  owner: 'classroom' | 'blueprint'
  resourceType?: string
  resourceId?: string
  dataSubjectUserId?: string
}
type OperationalObject = {
  bucket: 'classroom-archives' | 'gradex-analytics-extracts'
  path: string
  contentType: string
}

function dataOrThrow<T>(label: string, response: { data: T; error: ResponseError }): T {
  if (response.error) throw new Error(`${label}: ${response.error.message}`)
  return response.data
}

function assertFixture(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

function requireLocalFixtureEnvironment() {
  if (process.env.PIKA_ALLOW_LOCAL_DESTRUCTIVE_PURGE_FIXTURE !== '1') {
    throw new Error(
      'Set PIKA_ALLOW_LOCAL_DESTRUCTIVE_PURGE_FIXTURE=1 to run the destructive local fixture',
    )
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const databaseUrl = process.env.PIKA_LOCAL_DATABASE_URL
  if (!supabaseUrl || !databaseUrl) throw new Error('Missing local Supabase fixture environment')
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

function runSql(databaseUrl: string, sql: string): string {
  return execFileSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function setRolloutGates(databaseUrl: string, enabled: boolean) {
  const value = enabled ? 'true' : 'false'
  const result = runSql(databaseUrl, `
    update public.managed_storage_settings
    set enforce_ownership = ${value}, hot_classroom_purge_enabled = ${value},
        updated_at = clock_timestamp()
    where singleton;
    select enforce_ownership::text || ':' || hot_classroom_purge_enabled::text
    from public.managed_storage_settings where singleton;
  `)
  assertFixture(result === `${value}:${value}`, 'Fixture could not set both rollout gates exactly')
}

async function storageObjectExists(
  supabase: ReturnType<typeof getServiceRoleClient>,
  object: { bucket: string; path: string },
): Promise<boolean> {
  const separator = object.path.lastIndexOf('/')
  const directory = object.path.slice(0, separator)
  const name = object.path.slice(separator + 1)
  const listing = dataOrThrow(
    `list ${object.bucket}/${object.path}`,
    await supabase.storage.from(object.bucket).list(directory, { limit: 100, search: name }),
  )
  return listing.some((candidate) => candidate.name === name)
}

async function rpc(
  supabase: ReturnType<typeof getServiceRoleClient>,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await (supabase as any).rpc(name, args)
  if (response.error) throw Object.assign(new Error(response.error.message), response.error)
  return response.data
}

async function expectFailure(
  label: string,
  operation: () => Promise<unknown>,
  expectedCodes: string[],
) {
  try {
    await operation()
  } catch (error) {
    const code = errorCode(error)
    assertFixture(
      code !== undefined && expectedCodes.includes(code),
      `${label} failed with unexpected code ${code || 'unknown'}`,
    )
    return
  }
  throw new Error(`${label} unexpectedly succeeded`)
}

async function main() {
  const { supabaseUrl, databaseUrl } = requireLocalFixtureEnvironment()
  const supabase = getServiceRoleClient()
  const fixtureId = randomUUID()
  const classroomId = randomUUID()
  const blueprintId = randomUUID()
  const purgeOperationId = randomUUID()
  const competingPurgeOperationId = randomUUID()
  const assignmentId = randomUUID()
  const assignmentDocId = randomUUID()
  const requirementId = randomUUID()
  const artifactId = randomUUID()
  const testId = randomUUID()
  const teacherMaterialDocumentId = randomUUID()
  const snapshotDocumentId = randomUUID()
  const archiveOperationId = randomUUID()
  const archiveId = randomUUID()
  const gradexOperationId = randomUUID()
  const gradexExtractId = randomUUID()
  const failedArchiveOperationId = randomUUID()
  const failedGradexOperationId = randomUUID()
  const now = new Date()
  const nowIso = now.toISOString()
  const priorIso = new Date(now.getTime() - 60_000).toISOString()
  const expiryIso = new Date(now.getTime() + 86_400_000).toISOString()
  const suffix = fixtureId.slice(0, 8)
  const createdStorageObjects: Array<{ bucket: string; path: string }> = []

  let teacherId: string | undefined
  let primaryError: unknown
  let finalizationError: unknown
  let gatesTouched = false
  try {
    // The fixture owns these local-only settings for its entire run. Keeping both
    // false during setup proves that the migration remains fail-closed by default.
    setRolloutGates(databaseUrl, false)
    gatesTouched = true

    const teachers = dataOrThrow(
      'read fixture teachers',
      await supabase.from('users').select('id,email').eq('role', 'teacher').limit(2),
    )
    const students = dataOrThrow(
      'read fixture student',
      await supabase.from('users').select('id,email').eq('role', 'student').limit(1),
    )
    const teacher = teachers[0]
    const otherTeacher = teachers[1]
    const student = students[0]
    assertFixture(teacher, 'Local fixture requires one seeded teacher')
    assertFixture(otherTeacher, 'Local fixture requires two seeded teachers for authorization checks')
    assertFixture(student, 'Local fixture requires one seeded student')
    teacherId = teacher.id

    dataOrThrow('insert fixture Blueprint', await supabase.from('course_blueprints').insert({
      id: blueprintId,
      teacher_id: teacher.id,
      title: `Purge fixture Blueprint ${suffix}`,
    }))
    dataOrThrow('insert fixture classroom', await supabase.from('classrooms').insert({
      id: classroomId,
      teacher_id: teacher.id,
      title: `Purge fixture classroom ${suffix}`,
      class_code: `PURGE-${suffix}`,
      source_blueprint_id: blueprintId,
    }))

    const managedObjects: FixtureObject[] = [
      {
        id: randomUUID(), bucket: 'assignment-artifacts',
        path: `purge-fixture/${fixtureId}/classroom/submission.png`,
        contentType: 'image/png', purpose: 'student_assignment_artifact', owner: 'classroom',
        resourceType: 'assignment_doc', resourceId: assignmentDocId,
        dataSubjectUserId: student.id,
      },
      {
        id: randomUUID(), bucket: 'submission-images',
        path: `purge-fixture/${fixtureId}/classroom/daily-log.png`,
        contentType: 'image/png', purpose: 'student_inline_image', owner: 'classroom',
        resourceType: 'entry', dataSubjectUserId: student.id,
      },
      {
        id: randomUUID(), bucket: 'test-documents',
        path: `purge-fixture/${fixtureId}/classroom/teacher-material.pdf`,
        contentType: 'application/pdf', purpose: 'teacher_test_material', owner: 'classroom',
        resourceType: 'test', resourceId: testId,
      },
      {
        id: randomUUID(), bucket: 'test-documents',
        path: `purge-fixture/${fixtureId}/classroom/execution-snapshot.pdf`,
        contentType: 'application/pdf', purpose: 'test_execution_snapshot', owner: 'classroom',
        resourceType: 'test', resourceId: testId,
      },
      {
        id: randomUUID(), bucket: 'test-documents',
        path: `purge-fixture/${fixtureId}/blueprint/teacher-material-copy-a.pdf`,
        contentType: 'application/pdf', purpose: 'teacher_test_material', owner: 'blueprint',
      },
      {
        id: randomUUID(), bucket: 'test-documents',
        path: `purge-fixture/${fixtureId}/blueprint/teacher-material-copy.pdf`,
        contentType: 'application/pdf', purpose: 'teacher_test_material', owner: 'blueprint',
      },
    ]
    const cleanupProbe: FixtureObject = {
      id: randomUUID(), bucket: 'submission-images',
      path: `purge-fixture/${fixtureId}/cleanup/abandoned.png`,
      contentType: 'image/png', purpose: 'legacy_classroom_file', owner: 'classroom',
    }

    for (const object of [...managedObjects, cleanupProbe]) {
      await reserveManagedStorageUpload({
        supabase,
        objectId: object.id,
        bucket: object.bucket,
        path: object.path,
        classroomId: object.owner === 'classroom' ? classroomId : null,
        courseBlueprintId: object.owner === 'blueprint' ? blueprintId : null,
        purpose: object.purpose,
        createdByUserId: teacher.id,
        dataSubjectUserId: object.dataSubjectUserId,
        resourceType: object.resourceType,
        resourceId: object.resourceId,
        contentType: object.contentType,
      })
      dataOrThrow(`upload ${object.bucket}/${object.path}`, await supabase.storage
        .from(object.bucket)
        .upload(object.path, new TextEncoder().encode(`Pika owned fixture ${object.id}`), {
          contentType: object.contentType,
          upsert: false,
        }))
      createdStorageObjects.push(object)
      await adoptManagedStorageUpload({ supabase, objectId: object.id })
    }

    // Exercise generic cleanup independently: concurrent claims are exclusive,
    // a failed lease is retryable, and completion removes both bytes and ownership.
    assertFixture(await queueManagedStorageCleanup({
      supabase,
      objectId: cleanupProbe.id,
      errorCode: 'fixture_abandoned_upload',
    }), 'Fixture cleanup object was not queued')
    const unrelatedDueCleanupCount = Number(runSql(databaseUrl, `
      select count(*) from public.managed_storage_objects
      where id <> '${cleanupProbe.id}'
        and next_attempt_at <= clock_timestamp()
        and (
          status = 'cleanup_pending'
          or (status = 'pending_upload' and upload_expires_at <= clock_timestamp())
          or (status = 'cleanup_processing' and lease_expires_at <= clock_timestamp())
        );
    `))
    assertFixture(
      unrelatedDueCleanupCount === 0,
      'Local fixture requires an isolated managed cleanup queue',
    )
    const cleanupLeaseA = randomUUID()
    const cleanupLeaseB = randomUUID()
    const cleanupClaims = await Promise.all([
      rpc(supabase, 'claim_managed_storage_cleanup', {
        p_lease_token: cleanupLeaseA, p_limit: 1, p_lease_seconds: 60,
      }),
      rpc(supabase, 'claim_managed_storage_cleanup', {
        p_lease_token: cleanupLeaseB, p_limit: 1, p_lease_seconds: 60,
      }),
    ]) as Array<Array<{ id: string; lease_token: string }>>
    const claimedCleanup = cleanupClaims.flat().filter((row) => row.id === cleanupProbe.id)
    assertFixture(claimedCleanup.length === 1, 'Concurrent cleanup workers double-claimed fixture object')
    const failedCleanup = claimedCleanup[0]
    assertFixture(await rpc(supabase, 'fail_managed_storage_cleanup', {
      p_object_id: failedCleanup.id,
      p_lease_token: failedCleanup.lease_token,
      p_error_code: 'fixture_transient_delete_failure',
    }) === true, 'Managed cleanup failure was not recorded')
    runSql(databaseUrl, `
      update public.managed_storage_objects set next_attempt_at = clock_timestamp()
      where id = '${cleanupProbe.id}' and status = 'cleanup_pending';
    `)
    const managedCleanupRetryLease = randomUUID()
    const retryClaims = await rpc(supabase, 'claim_managed_storage_cleanup', {
      p_lease_token: managedCleanupRetryLease, p_limit: 1, p_lease_seconds: 60,
    }) as Array<{ id: string; lease_token: string; attempt_count: number }>
    const retriedCleanup = retryClaims.find((row) => row.id === cleanupProbe.id)
    assertFixture(retriedCleanup?.attempt_count === 2, 'Managed cleanup did not resume after failure')
    dataOrThrow('remove cleanup probe', await supabase.storage
      .from(cleanupProbe.bucket).remove([cleanupProbe.path]))
    assertFixture(await rpc(supabase, 'complete_managed_storage_cleanup', {
      p_object_id: cleanupProbe.id,
      p_lease_token: retriedCleanup.lease_token,
    }) === true, 'Managed cleanup did not complete')
    assertFixture(!await storageObjectExists(supabase, cleanupProbe), 'Cleanup probe bytes survived')

    const publicStorageUrl = (bucket: string, path: string) =>
      `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/`
      + path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
    const classroomImage = managedObjects[1]
    const classroomTeacherMaterial = managedObjects[2]
    const classroomSnapshot = managedObjects[3]
    const blueprintTeacherMaterialA = managedObjects[4]
    const blueprintTeacherMaterialB = managedObjects[5]
    dataOrThrow('link Blueprint physical copies', await supabase.from('course_blueprints').update({
      overview_markdown:
        `Blueprint material copy A: ${publicStorageUrl(blueprintTeacherMaterialA.bucket, blueprintTeacherMaterialA.path)}`,
      resources_markdown:
        `Blueprint material copy B: ${publicStorageUrl(blueprintTeacherMaterialB.bucket, blueprintTeacherMaterialB.path)}`,
    }).eq('id', blueprintId))
    dataOrThrow('link classroom-owned image', await supabase.from('classrooms').update({
      course_overview_markdown: `Classroom image: ${publicStorageUrl(classroomImage.bucket, classroomImage.path)}`,
    }).eq('id', classroomId))
    dataOrThrow('insert fixture enrollment', await supabase.from('classroom_enrollments').insert({
      classroom_id: classroomId, student_id: student.id,
    }))
    dataOrThrow('insert fixture roster', await supabase.from('classroom_roster').insert({
      classroom_id: classroomId, email: student.email,
      first_name: 'Purge', last_name: 'Fixture',
    }))
    dataOrThrow('insert fixture daily log', await supabase.from('entries').insert({
      classroom_id: classroomId, student_id: student.id, date: nowIso.slice(0, 10),
      on_time: false, minutes_reported: 15, mood: '😐',
      text: 'Fixture attendance and daily log',
      rich_content: { image: publicStorageUrl(classroomImage.bucket, classroomImage.path) },
    }))
    dataOrThrow('insert fixture log summary', await supabase.from('log_summaries').insert({
      classroom_id: classroomId, date: nowIso.slice(0, 10), entry_count: 1,
      model: 'fixture', summary_items: [{ text: 'Fixture operational summary' }],
    }))
    dataOrThrow('insert fixture assignment', await supabase.from('assignments').insert({
      id: assignmentId, classroom_id: classroomId, created_by: teacher.id,
      title: 'Fixture assignment', due_at: expiryIso, points_possible: 100,
    }))
    dataOrThrow('insert fixture submission requirement', await supabase
      .from('assignment_submission_requirements').insert({
        id: requirementId, assignment_id: assignmentId, type: 'image', label: 'Fixture image',
      }))
    dataOrThrow('insert fixture submission', await supabase.from('assignment_docs').insert({
      id: assignmentDocId, assignment_id: assignmentId, student_id: student.id,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      content_legacy: 'Fixture student work',
    }))
    dataOrThrow('insert fixture assignment artifact', await supabase
      .from('assignment_submission_artifacts').insert({
        id: artifactId, assignment_doc_id: assignmentDocId, requirement_id: requirementId,
        student_id: student.id, type: 'image', storage_path: managedObjects[0].path,
        validation_status: 'valid',
      }))
    dataOrThrow('submit and grade fixture assignment', await supabase
      .from('assignment_docs').update({
        is_submitted: true, submitted_at: nowIso, feedback: 'Fixture feedback',
        score_completion: 9, score_thinking: 8, score_workflow: 7,
      }).eq('id', assignmentDocId))
    dataOrThrow('insert fixture test', await supabase.from('tests').insert({
      id: testId, classroom_id: classroomId, created_by: teacher.id,
      title: 'Fixture test', status: 'closed', points_possible: 100,
      documents: [{
        id: teacherMaterialDocumentId,
        title: 'Fixture teacher material', source: 'upload',
        url: publicStorageUrl(classroomTeacherMaterial.bucket, classroomTeacherMaterial.path),
        managed_object_id: classroomTeacherMaterial.id,
      }, {
        id: snapshotDocumentId,
        title: 'Fixture execution snapshot', source: 'link', url: 'https://example.invalid/test',
        snapshot_path: classroomSnapshot.path,
        snapshot_managed_object_id: classroomSnapshot.id,
      }],
    }))
    dataOrThrow('archive fixture classroom', await supabase.from('classrooms')
      .update({ archived_at: nowIso }).eq('id', classroomId))

    const revision = dataOrThrow('read fixture classroom revision', await supabase
      .from('classroom_archive_revisions').select('revision')
      .eq('classroom_id', classroomId).single()).revision
    const classroomObjects = managedObjects.filter((object) => object.owner === 'classroom')
    const inventorySha256 = createHash('sha256')
      .update(JSON.stringify(classroomObjects
        .map((object) => [object.bucket, object.path])
        .sort((left, right) => `${left[0]}/${left[1]}`.localeCompare(`${right[0]}/${right[1]}`))))
      .digest('hex')
    await rpc(supabase, 'verify_classroom_managed_storage_coverage', {
      p_teacher_id: teacher.id,
      p_classroom_id: classroomId,
      p_source_revision: revision,
      p_reference_count: classroomObjects.length,
      p_inventory_sha256: inventorySha256,
    })

    const operationalObjects: OperationalObject[] = [
      { bucket: 'classroom-archives', path: `purge-fixture/${fixtureId}/classroom.tar.gz`, contentType: 'application/gzip' },
      { bucket: 'gradex-analytics-extracts', path: `purge-fixture/${fixtureId}/gradex.tar.gz`, contentType: 'application/gzip' },
      { bucket: 'classroom-archives', path: `purge-fixture/${fixtureId}/interrupted-classroom.tar.gz`, contentType: 'application/gzip' },
      { bucket: 'gradex-analytics-extracts', path: `purge-fixture/${fixtureId}/interrupted-gradex.tar.gz`, contentType: 'application/gzip' },
    ]
    for (const object of operationalObjects) {
      dataOrThrow(`upload ${object.bucket}/${object.path}`, await supabase.storage
        .from(object.bucket).upload(object.path, new TextEncoder().encode('Pika operational fixture'), {
          contentType: object.contentType, upsert: false,
        }))
      createdStorageObjects.push(object)
    }
    dataOrThrow('insert fixture archive operation', await supabase.from('classroom_archive_operations').insert({
      id: archiveOperationId, teacher_id: teacher.id, classroom_id: classroomId,
      operation_type: 'export', request_sha256: 'a'.repeat(64), status: 'completed',
      source_revision: revision, source_schema_migration: '117_hot_archived_classroom_purge_review_hardening',
      source_app_commit: 'purge-fixture', retention: {}, archive_id: archiveId,
      storage_bucket: operationalObjects[0].bucket, storage_path: operationalObjects[0].path,
      artifact_sha256: 'b'.repeat(64), content_sha256: 'c'.repeat(64),
      compressed_byte_size: 32, uncompressed_byte_size: 64, verification: {},
      snapshot_created_at: priorIso, snapshot_expires_at: expiryIso, completed_at: nowIso,
      archive_format_version: 2, source_contract_version: 2, restore_contract_version: 2,
    }))
    dataOrThrow('insert fixture classroom archive', await supabase.from('classroom_archives').insert({
      id: archiveId, operation_id: archiveOperationId, classroom_id: classroomId,
      teacher_id: teacher.id, format: 'pika.classroom-archive', format_version: 2,
      source_revision: revision, source_schema_migration: '117_hot_archived_classroom_purge_review_hardening',
      source_app_commit: 'purge-fixture', storage_bucket: operationalObjects[0].bucket,
      storage_path: operationalObjects[0].path, artifact_sha256: 'b'.repeat(64),
      content_sha256: 'c'.repeat(64), compressed_byte_size: 32, uncompressed_byte_size: 64,
      resource_counts: {}, storage_object_counts: {}, verification: {}, retention: {},
      created_at: priorIso, verified_at: nowIso,
    }))
    dataOrThrow('insert fixture Gradex operation', await supabase.from('classroom_archive_operations').insert({
      id: gradexOperationId, teacher_id: teacher.id, classroom_id: classroomId,
      operation_type: 'gradex_extract', request_sha256: 'd'.repeat(64), status: 'completed',
      source_revision: revision, source_schema_migration: '117_hot_archived_classroom_purge_review_hardening',
      source_app_commit: 'purge-fixture', retention: { delete_after: expiryIso }, archive_id: archiveId,
      storage_bucket: operationalObjects[1].bucket, storage_path: operationalObjects[1].path,
      artifact_sha256: 'e'.repeat(64), content_sha256: 'f'.repeat(64),
      compressed_byte_size: 32, uncompressed_byte_size: 64, verification: {},
      snapshot_created_at: priorIso, snapshot_expires_at: expiryIso, completed_at: nowIso,
      archive_format_version: 2, source_contract_version: 2, restore_contract_version: 2,
    }))
    dataOrThrow('insert fixture Gradex extract', await supabase.from('classroom_gradex_extracts').insert({
      id: gradexExtractId, operation_id: gradexOperationId, source_archive_id: archiveId,
      classroom_id: classroomId, teacher_id: teacher.id, format: 'pika.gradex-classroom-extract',
      format_version: 2, source_archive_sha256: 'b'.repeat(64),
      storage_bucket: operationalObjects[1].bucket, storage_path: operationalObjects[1].path,
      artifact_sha256: 'e'.repeat(64), content_sha256: 'f'.repeat(64),
      compressed_byte_size: 32, uncompressed_byte_size: 64, resource_counts: {}, verification: {},
      generated_at: priorIso, verified_at: nowIso, delete_after: expiryIso,
    }))
    for (const [index, operationId] of [failedArchiveOperationId, failedGradexOperationId].entries()) {
      const object = operationalObjects[index + 2]
      dataOrThrow(`insert interrupted ${object.bucket} operation`, await supabase
        .from('classroom_archive_operations').insert({
          id: operationId, teacher_id: teacher.id, classroom_id: classroomId,
          operation_type: index === 0 ? 'export' : 'gradex_extract',
          request_sha256: String(index + 1).repeat(64), status: 'failed',
          source_revision: revision, source_schema_migration: '117_hot_archived_classroom_purge_review_hardening',
          source_app_commit: 'purge-fixture', retention: { delete_after: expiryIso },
          archive_id: index === 0 ? randomUUID() : archiveId,
          storage_bucket: object.bucket, storage_path: object.path,
          error_code: 'fixture_interrupted_upload', retryable: false,
          snapshot_created_at: priorIso, snapshot_expires_at: priorIso,
          archive_format_version: 2, source_contract_version: 2, restore_contract_version: 2,
        }))
      const cleanupTable = index === 0
        ? 'classroom_archive_object_upload_cleanup'
        : 'classroom_gradex_extract_cleanup'
      const cleanupRow = index === 0
        ? {
            operation_id: operationId, storage_bucket: object.bucket, storage_path: object.path,
            expected_sha256: '2'.repeat(64), expected_byte_size: 32,
            status: 'pending', next_attempt_at: expiryIso,
          }
        : {
            operation_id: operationId, storage_bucket: object.bucket, storage_path: object.path,
            delete_after: expiryIso, status: 'pending', next_attempt_at: expiryIso,
          }
      dataOrThrow(`insert interrupted ${object.bucket} cleanup`, await supabase
        .from(cleanupTable as any).insert(cleanupRow as any))
    }

    setRolloutGates(databaseUrl, true)
    const impact = await getClassroomPurgeImpact(teacher.id, classroomId)
    assertFixture(impact.managed_file_count === 8, 'Impact did not use exact owned and operational objects')
    assertFixture(impact.missing_file_count === 0, 'Impact reported missing classroom-owned bytes')
    assertFixture(impact.storage_counts['assignment-artifacts'] === 1, 'Artifact ownership drift')
    assertFixture(impact.storage_counts['submission-images'] === 1, 'Image ownership drift')
    assertFixture(impact.storage_counts['test-documents'] === 2, 'Test ownership drift')
    assertFixture(impact.storage_counts['classroom-archives'] === 2, 'Archive inventory drift')
    assertFixture(impact.storage_counts['gradex-analytics-extracts'] === 2, 'Gradex inventory drift')
    assertFixture(impact.ownership_coverage_status === 'verified' && impact.deletion_available,
      'Verified exact ownership did not enable the local purge')

    await expectFailure(
      'other teacher impact read',
      () => getClassroomPurgeImpact(otherTeacher.id, classroomId),
      ['classroom_not_found'],
    )
    let status = await startClassroomPurge({
      teacherId: teacher.id, classroomId, operationId: purgeOperationId, confirmation: 'DELETE',
    })
    await expectFailure(
      'other teacher purge claim',
      () => tickClassroomPurge(otherTeacher.id, purgeOperationId),
      ['P0002'],
    )
    await expectFailure(
      'competing purge begin',
      () => startClassroomPurge({
        teacherId: teacher.id, classroomId,
        operationId: competingPurgeOperationId, confirmation: 'DELETE',
      }),
      ['classroom_purge_active'],
    )

    const purgeObjectRetryLease = randomUUID()
    const retryClaim = (await rpc(supabase, 'claim_classroom_purge_object', {
      p_operation_id: purgeOperationId, p_teacher_id: teacher.id,
      p_lease_token: purgeObjectRetryLease, p_lease_seconds: 60,
    }) as Array<{ id: string; lease_token: string }>)[0]
    assertFixture(retryClaim, 'Fixture could not claim a purge object for retry proof')
    assertFixture(await rpc(supabase, 'fail_classroom_purge_object', {
      p_object_id: retryClaim.id, p_teacher_id: teacher.id,
      p_lease_token: retryClaim.lease_token, p_error_code: 'fixture_transient_storage_failure',
    }) === true, 'Transient purge failure was not persisted')
    runSql(databaseUrl, `
      update public.classroom_purge_objects set next_attempt_at = clock_timestamp()
      where id = '${retryClaim.id}' and status = 'failed';
    `)

    const unmanagedPath = `purge-fixture/${fixtureId}/unmanaged-write.png`
    const unmanagedWrite = await supabase.storage.from('submission-images').upload(
      unmanagedPath,
      new TextEncoder().encode('must be rejected'),
      { contentType: 'image/png', upsert: false },
    )
    assertFixture(
      unmanagedWrite.error?.message.includes('managed_storage_owner_required'),
      'Ownership enforcement accepted an unreserved source-bucket write',
    )
    const reservedRewrite = await supabase.storage.from(managedObjects[0].bucket).upload(
      managedObjects[0].path,
      new TextEncoder().encode('must be fenced'),
      { contentType: managedObjects[0].contentType, upsert: true },
    )
    assertFixture(
      reservedRewrite.error?.message.includes('storage_path_permanently_reserved'),
      'Purge fence accepted a write to an exact reserved path',
    )

    await Promise.all([
      tickClassroomPurge(teacher.id, purgeOperationId),
      tickClassroomPurge(teacher.id, purgeOperationId),
    ])
    for (let tick = 0; tick < 18 && status.status !== 'completed'; tick += 1) {
      status = await tickClassroomPurge(teacher.id, purgeOperationId)
    }
    assertFixture(status.status === 'completed', `Fixture purge did not complete: ${status.error_code}`)
    assertFixture(status.storage_object_counts.deleted === 8,
      'Fixture purge did not record exactly eight deletions')

    const [classroom, assignment, artifact, test, archive, extract] = await Promise.all([
      supabase.from('classrooms').select('id').eq('id', classroomId).maybeSingle(),
      supabase.from('assignments').select('id').eq('id', assignmentId).maybeSingle(),
      supabase.from('assignment_submission_artifacts').select('id').eq('id', artifactId).maybeSingle(),
      supabase.from('tests').select('id').eq('id', testId).maybeSingle(),
      supabase.from('classroom_archives').select('id').eq('id', archiveId).maybeSingle(),
      supabase.from('classroom_gradex_extracts').select('id').eq('id', gradexExtractId).maybeSingle(),
    ])
    for (const [label, response] of Object.entries({ classroom, assignment, artifact, test, archive, extract })) {
      assertFixture(!response.error && !response.data, `${label} relational data survived the purge`)
    }
    const blueprint = dataOrThrow('verify Blueprint preservation', await supabase
      .from('course_blueprints').select('id').eq('id', blueprintId).maybeSingle())
    assertFixture(blueprint, 'Reusable Blueprint was deleted')
    for (const object of [...managedObjects.filter((item) => item.owner === 'classroom'), ...operationalObjects]) {
      assertFixture(!await storageObjectExists(supabase, object), `${object.bucket}/${object.path} survived purge`)
    }
    for (const object of managedObjects.filter((item) => item.owner === 'blueprint')) {
      assertFixture(await storageObjectExists(supabase, object), `${object.bucket}/${object.path} Blueprint copy was deleted`)
    }
    const blueprintOwnership = dataOrThrow('verify Blueprint managed ownership', await (supabase as any)
      .from('managed_storage_objects').select('id,course_blueprint_id,status')
      .eq('course_blueprint_id', blueprintId))
    assertFixture(
      blueprintOwnership.length === 2
      && blueprintOwnership.every((object: any) => object.status === 'ready'),
      'Blueprint physical copies lost their independent ownership',
    )
    const classroomOwnership = dataOrThrow('verify classroom ownership cleanup', await (supabase as any)
      .from('managed_storage_objects').select('id').eq('classroom_id', classroomId))
    assertFixture(classroomOwnership.length === 0, 'Classroom managed ownership survived finalization')
    const purgeObjects = dataOrThrow('verify terminal purge ledger', await supabase
      .from('classroom_purge_objects').select('status,storage_path,lease_token,last_error_code')
      .eq('operation_id', purgeOperationId))
    assertFixture(
      purgeObjects.length === 8
      && purgeObjects.every((object) => object.status === 'deleted'
        && object.storage_path === null && object.lease_token === null
        && object.last_error_code === null),
      'Terminal purge ledger retained sensitive paths, leases, or errors',
    )

    process.stdout.write(
      `Hot archived classroom purge fixture passed: exactly 8 classroom/operational files deleted; `
      + '2 independently owned Blueprint copies preserved; cleanup retry, concurrent claims, '
      + 'authorization, fencing, and terminal redaction verified.\n',
    )
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    try {
      // This reset is intentionally independent of fixture-row cleanup. No test
      // failure may leave either rollout gate enabled, even on local Supabase.
      setRolloutGates(databaseUrl, false)
    } catch (gateError) {
      finalizationError = gateError
      process.stderr.write('CRITICAL: fixture could not restore managed storage rollout gates to false.\n')
    }

    const cleanupSql = `
      begin;
      select set_config('pika.classroom_purge_finalize', 'on', true);
      delete from public.classroom_purge_operations
        where id in ('${purgeOperationId}', '${competingPurgeOperationId}');
      delete from public.managed_storage_objects
        where classroom_id = '${classroomId}' or course_blueprint_id = '${blueprintId}';
      delete from public.classroom_archive_operations
        where id in ('${archiveOperationId}', '${gradexOperationId}',
          '${failedArchiveOperationId}', '${failedGradexOperationId}');
      delete from public.classrooms where id = '${classroomId}';
      delete from public.course_blueprints where id = '${blueprintId}';
      commit;
    `
    try {
      runSql(databaseUrl, cleanupSql)
      for (const object of createdStorageObjects) {
        await supabase.storage.from(object.bucket).remove([object.path])
      }
    } catch (cleanupError) {
      finalizationError ||= cleanupError
      process.stderr.write(
        `Fixture cleanup also failed; inspect fixture ${fixtureId}`
        + `${teacherId ? ` owned by ${teacherId}` : ''}.\n`,
      )
    }
    if (!gatesTouched && !primaryError && !finalizationError) {
      finalizationError = new Error('Fixture failed before taking control of local rollout gates')
    }
    if (!primaryError && finalizationError) throw finalizationError
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown fixture failure'
  process.stderr.write(`Hot archived classroom purge fixture failed: ${message}\n`)
  process.exitCode = 1
})
