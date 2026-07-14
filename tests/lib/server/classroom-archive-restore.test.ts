import { describe, expect, it } from 'vitest'
import { CLASSROOM_RELATIONAL_RESOURCES } from '@/lib/contracts/classroom-data'
import {
  buildClassroomArchiveBundle,
  verifyClassroomArchiveBundle,
} from '@/lib/server/classroom-archive-format'
import {
  buildClassroomArchiveRestorePlan,
  classroomArchiveRestoreObjectPath,
  CLASSROOM_ARCHIVE_RESTORE_TARGET_MIGRATION,
} from '@/lib/server/classroom-archive-restore'

const ARCHIVE_ID = '00000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '00000000-0000-4000-8000-000000000002'
const TEACHER_ID = '00000000-0000-4000-8000-000000000003'
const STUDENT_ID = '00000000-0000-4000-8000-000000000004'
const OPERATION_ID = '00000000-0000-4000-8000-000000000005'

function emptyResources() {
  return Object.fromEntries(
    CLASSROOM_RELATIONAL_RESOURCES.map((resource) => [resource.table, []]),
  )
}

function verifiedFixture() {
  const bundle = buildClassroomArchiveBundle({
    archiveId: ARCHIVE_ID,
    classroomId: CLASSROOM_ID,
    teacherId: TEACHER_ID,
    createdAt: '2026-07-13T12:00:00.000Z',
    source: {
      schemaMigration: '082_verified_classroom_archive_exports',
      appCommit: 'abcdef1234567890',
    },
    retention: { mode: 'teacher_managed', delete_after: null },
    resources: {
      ...emptyResources(),
      classrooms: [{ id: CLASSROOM_ID, teacher_id: TEACHER_ID, title: 'Restore me' }],
      assignments: [{
        id: '10000000-0000-4000-8000-000000000001',
        classroom_id: CLASSROOM_ID,
        created_by: TEACHER_ID,
      }],
      assignment_docs: [{
        id: '20000000-0000-4000-8000-000000000001',
        assignment_id: '10000000-0000-4000-8000-000000000001',
        student_id: STUDENT_ID,
        content: {
          image: 'https://project.supabase.co/storage/v1/object/public/submission-images/student/work.png',
        },
      }],
      assignment_submission_artifacts: [{
        id: '30000000-0000-4000-8000-000000000001',
        assignment_doc_id: '20000000-0000-4000-8000-000000000001',
        student_id: STUDENT_ID,
        storage_path: 'student/private/evidence.png',
      }],
      tests: [{
        id: '40000000-0000-4000-8000-000000000001',
        classroom_id: CLASSROOM_ID,
        created_by: TEACHER_ID,
        documents: [{
          snapshot_path: 'teacher/test/snapshot.html',
          url: 'https://project.supabase.co/storage/v1/object/public/test-documents/teacher/test/source.pdf',
        }],
      }],
    },
    actors: [
      { id: TEACHER_ID, email: 'teacher@example.test', role: 'teacher', profile: null },
      {
        id: STUDENT_ID,
        email: 'student@example.test',
        role: 'student',
        profile: {
          id: '50000000-0000-4000-8000-000000000001',
          user_id: STUDENT_ID,
          student_number: 'S1',
          first_name: 'Archive',
          last_name: 'Student',
          created_at: '2026-07-13T12:00:00.000Z',
        },
      },
    ],
    storageObjects: [
      {
        bucket: 'assignment-artifacts',
        sourcePath: 'student/private/evidence.png',
        contentType: 'image/png',
        bytes: Buffer.from('artifact'),
      },
      {
        bucket: 'submission-images',
        sourcePath: 'student/work.png',
        contentType: 'image/png',
        bytes: Buffer.from('image'),
      },
      {
        bucket: 'test-documents',
        sourcePath: 'teacher/test/snapshot.html',
        contentType: 'text/html',
        bytes: Buffer.from('snapshot'),
      },
      {
        bucket: 'test-documents',
        sourcePath: 'teacher/test/source.pdf',
        contentType: 'application/pdf',
        bytes: Buffer.from('pdf'),
      },
    ],
  })
  const verified = verifyClassroomArchiveBundle(bundle.archive)
  if (!verified.ok) throw new Error(verified.error)
  return verified
}

describe('classroom archive restore object paths', () => {
  it('binds the classroom, operation, source identity, content type, and checksum', () => {
    const args = {
      classroomId: CLASSROOM_ID,
      operationId: OPERATION_ID,
      sha256: 'a'.repeat(64),
      sourcePath: 'student/evidence.png',
      contentType: 'image/png',
    }
    const path = classroomArchiveRestoreObjectPath(args)

    expect(path).toMatch(
      new RegExp(`^restores/${CLASSROOM_ID}/${OPERATION_ID}/[a-f0-9]{64}-${'a'.repeat(64)}$`),
    )
    expect(classroomArchiveRestoreObjectPath({ ...args, sourcePath: 'student/other.png' }))
      .not.toBe(path)
    expect(classroomArchiveRestoreObjectPath({ ...args, contentType: 'image/jpeg' }))
      .not.toBe(path)
  })
})

const currentActors = [
  { id: TEACHER_ID, email: 'teacher@example.test', role: 'teacher' as const },
  { id: STUDENT_ID, email: 'student@example.test', role: 'student' as const },
]

describe('classroom archive restore planning', () => {
  it('requires explicit outer artifact checksum evidence', () => {
    expect(() => buildClassroomArchiveRestorePlan({
      verified: verifiedFixture(),
      artifactChecksumVerified: false,
      operationId: OPERATION_ID,
      currentActors,
      supabaseUrl: 'https://project.supabase.co',
    })).toThrow('artifact checksum was not verified')
  })

  it('selects the version adapter, reconciles actors, and rewrites managed object references', () => {
    const plan = buildClassroomArchiveRestorePlan({
      verified: verifiedFixture(),
      artifactChecksumVerified: true,
      operationId: OPERATION_ID,
      currentActors,
      supabaseUrl: 'https://project.supabase.co',
    })

    expect(plan.targetSchemaMigration).toBe(CLASSROOM_ARCHIVE_RESTORE_TARGET_MIGRATION)
    expect(plan.adapterChain).toEqual(['classroom-archive-v1-082-to-083'])
    expect(plan.preflight.unresolved_actor_ids).toEqual([])
    expect(plan.storageObjects).toHaveLength(4)
    expect(plan.storageObjects.every((object) =>
      object.restorePath.startsWith(`restores/${CLASSROOM_ID}/${OPERATION_ID}/`),
    )).toBe(true)

    expect(plan.resources.assignment_submission_artifacts[0].storage_path).toMatch(
      new RegExp(`^restores/${CLASSROOM_ID}/${OPERATION_ID}/`),
    )
    expect(JSON.stringify(plan.resources.assignment_docs[0].content)).toContain(
      `/submission-images/restores/${CLASSROOM_ID}/${OPERATION_ID}/`,
    )
    expect(JSON.stringify(plan.resources.tests[0].documents)).toContain(
      `/test-documents/restores/${CLASSROOM_ID}/${OPERATION_ID}/`,
    )
    expect(JSON.stringify(plan.resources.tests[0].documents)).not.toContain(
      'teacher/test/snapshot.html',
    )
  })

  it('fails closed when an archived actor cannot be reconciled', () => {
    expect(() => buildClassroomArchiveRestorePlan({
      verified: verifiedFixture(),
      artifactChecksumVerified: true,
      operationId: OPERATION_ID,
      currentActors: currentActors.filter((actor) => actor.id !== STUDENT_ID),
      supabaseUrl: 'https://project.supabase.co',
    })).toThrow(`Archive restore has unresolved actors: ${STUDENT_ID}`)
  })

  it('fails closed when a stable actor id now has a different authorization role', () => {
    expect(() => buildClassroomArchiveRestorePlan({
      verified: verifiedFixture(),
      artifactChecksumVerified: true,
      operationId: OPERATION_ID,
      currentActors: currentActors.map((actor) => actor.id === STUDENT_ID
        ? { ...actor, role: 'teacher' as const }
        : actor),
      supabaseUrl: 'https://project.supabase.co',
    })).toThrow(`Archive restore has unresolved actors: ${STUDENT_ID}`)
  })

  it('fails closed when no source-to-target adapter exists', () => {
    const verified = verifiedFixture()
    verified.manifest.source.schema_migration = '081_unknown_archive_schema'

    expect(() => buildClassroomArchiveRestorePlan({
      verified,
      artifactChecksumVerified: true,
      operationId: OPERATION_ID,
      currentActors,
      supabaseUrl: 'https://project.supabase.co',
    })).toThrow('No classroom archive restore adapter')
  })

  it('fails when a resource actor reference has no archived snapshot', () => {
    const verified = verifiedFixture()
    const actors = verified.files.get('actors.ndjson')
    if (!actors) throw new Error('missing fixture actors')
    verified.files.set(
      'actors.ndjson',
      Buffer.from(actors.toString('utf8').split('\n').filter((line) =>
        !line.includes(STUDENT_ID),
      ).join('\n')),
    )

    expect(() => buildClassroomArchiveRestorePlan({
      verified,
      artifactChecksumVerified: true,
      operationId: OPERATION_ID,
      currentActors,
      supabaseUrl: 'https://project.supabase.co',
    })).toThrow('Archive actor snapshot is missing')
  })

  it('rejects duplicate actor snapshots during strict decoding', () => {
    const verified = verifiedFixture()
    const actors = verified.files.get('actors.ndjson')
    if (!actors) throw new Error('missing fixture actors')
    const firstActor = actors.toString('utf8').split('\n')[0]
    verified.files.set('actors.ndjson', Buffer.from(`${firstActor}\n${actors.toString('utf8')}`))

    expect(() => buildClassroomArchiveRestorePlan({
      verified,
      artifactChecksumVerified: true,
      operationId: OPERATION_ID,
      currentActors,
      supabaseUrl: 'https://project.supabase.co',
    })).toThrow('duplicate actor snapshots')
  })

  it('requires manifest storage objects to exactly match relational references', () => {
    const verified = verifiedFixture()
    verified.manifest.storage_objects.pop()

    expect(() => buildClassroomArchiveRestorePlan({
      verified,
      artifactChecksumVerified: true,
      operationId: OPERATION_ID,
      currentActors,
      supabaseUrl: 'https://project.supabase.co',
    })).toThrow('do not exactly match classroom references')
  })
})
