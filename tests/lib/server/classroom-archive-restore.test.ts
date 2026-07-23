import { describe, expect, it } from 'vitest'
import { CLASSROOM_RELATIONAL_RESOURCES } from '@/lib/contracts/classroom-data'
import {
  buildClassroomArchiveBundle,
  decodeClassroomArchiveData,
  verifyClassroomArchiveBundle,
} from '@/lib/server/classroom-archive-format'
import { adaptLegacyQuizArchiveResources } from '@/lib/server/classroom-archive-quiz-retirement'
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
      quizzes: [{
        id: '60000000-0000-4000-8000-000000000001',
        classroom_id: CLASSROOM_ID,
        created_by: TEACHER_ID,
        title: 'Historical quiz',
      }],
      quiz_questions: [{
        id: '60000000-0000-4000-8000-000000000002',
        quiz_id: '60000000-0000-4000-8000-000000000001',
        question_text: 'Historical question',
      }],
      quiz_responses: [{
        id: '60000000-0000-4000-8000-000000000003',
        quiz_id: '60000000-0000-4000-8000-000000000001',
        question_id: '60000000-0000-4000-8000-000000000002',
        student_id: STUDENT_ID,
        selected_option: 1,
      }],
      quiz_student_scores: [{
        id: '60000000-0000-4000-8000-000000000004',
        quiz_id: '60000000-0000-4000-8000-000000000001',
        student_id: STUDENT_ID,
        manual_override_score: 9,
      }],
      assessment_drafts: [{
        id: '60000000-0000-4000-8000-000000000005',
        assessment_type: 'quiz',
        assessment_id: '60000000-0000-4000-8000-000000000001',
        classroom_id: CLASSROOM_ID,
        content: { title: 'Historical Quiz draft' },
        version: 2,
        created_by: TEACHER_ID,
        updated_by: TEACHER_ID,
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
  it('freezes the legacy quiz resources into the archive v1 contract', () => {
    const resourceNames = CLASSROOM_RELATIONAL_RESOURCES.map((resource) => resource.table)

    expect(resourceNames).toEqual(expect.arrayContaining([
      'quizzes',
      'quiz_questions',
      'quiz_responses',
      'quiz_student_scores',
    ]))
  })

  it('adapts a verified non-empty v1 Quiz graph without mutating its bytes', () => {
    const verified = verifiedFixture()
    const manifestBefore = structuredClone(verified.manifest)
    const quizBytesBefore = Buffer.from(
      verified.files.get('data/quizzes.ndjson') || Buffer.alloc(0),
    )
    const decoded = decodeClassroomArchiveData(verified)
    const adapted = adaptLegacyQuizArchiveResources({
      classroomId: CLASSROOM_ID,
      resources: decoded.resources,
    })

    expect(adapted.records.map((record) => record.source_resource)).toEqual([
      'assessment_drafts',
      'quiz_questions',
      'quiz_responses',
      'quiz_student_scores',
      'quizzes',
    ])
    expect(adapted.records.find((record) =>
      record.source_resource === 'quiz_student_scores',
    )?.payload.manual_override_score).toBe(9)
    expect(adapted.resources.assessment_drafts).toEqual([])
    expect(verified.manifest).toEqual(manifestBefore)
    expect(verified.files.get('data/quizzes.ndjson')).toEqual(quizBytesBefore)
  })

  it('requires explicit outer artifact checksum evidence', () => {
    expect(() => buildClassroomArchiveRestorePlan({
      verified: verifiedFixture(),
      artifactChecksumVerified: false,
      operationId: OPERATION_ID,
      currentActors,
      supabaseUrl: 'https://project.supabase.co',
    })).toThrow('artifact checksum was not verified')
  })

  it('keeps verified v2 input disabled until persistence is activated', () => {
    const verified = verifiedFixture()
    Object.assign(verified.manifest, { version: 2 })

    expect(() => buildClassroomArchiveRestorePlan({
      verified,
      artifactChecksumVerified: true,
      operationId: OPERATION_ID,
      currentActors,
      supabaseUrl: 'https://project.supabase.co',
    })).toThrow('version 2 is verified but not enabled for restore')
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
    expect(plan.resources.assignment_docs[0]).not.toHaveProperty('save_session_id')
    expect(plan.resources.assignment_docs[0]).not.toHaveProperty('save_sequence')
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
    expect(plan.resources.quizzes).toEqual([
      expect.objectContaining({ title: 'Historical quiz' }),
    ])
    expect(plan.resources.quiz_questions).toEqual([
      expect.objectContaining({ question_text: 'Historical question' }),
    ])
    expect(plan.resources.quiz_responses).toEqual([
      expect.objectContaining({ student_id: STUDENT_ID, selected_option: 1 }),
    ])
    expect(plan.resources.quiz_student_scores).toEqual([
      expect.objectContaining({ student_id: STUDENT_ID, manual_override_score: 9 }),
    ])
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
