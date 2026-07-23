import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { CLASSROOM_RELATIONAL_RESOURCES } from '@/lib/contracts/classroom-data'
import { CLASSROOM_ARCHIVE_V1_RESOURCES } from '@/lib/contracts/classroom-archive-resources'
import {
  buildClassroomArchiveBundle,
  decodeClassroomArchiveData,
  verifyClassroomArchiveBundle,
} from '@/lib/server/classroom-archive-format'
import { adaptLegacyQuizArchiveResources } from '@/lib/server/classroom-archive-quiz-retirement'
import {
  buildClassroomArchiveRestorePlan,
  buildClassroomArchiveV2RestorePlan,
  classroomArchiveRestoreObjectPath,
  CLASSROOM_ARCHIVE_RESTORE_TARGET_MIGRATION,
  CLASSROOM_ARCHIVE_V2_RESTORE_TARGET_MIGRATION,
} from '@/lib/server/classroom-archive-restore'
import { retiredAssessmentPayloadChecksum } from '@/lib/server/classroom-retired-assessment-contract'
import { buildClassroomArchiveV2Fixture } from '../../fixtures/classroom-archive-v2'
import {
  V2_STUDENT_ID,
  V2_TEACHER_ID,
} from '../../fixtures/classroom-archive-v2'

const ARCHIVE_ID = '00000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '00000000-0000-4000-8000-000000000002'
const TEACHER_ID = '00000000-0000-4000-8000-000000000003'
const STUDENT_ID = '00000000-0000-4000-8000-000000000004'
const OPERATION_ID = '00000000-0000-4000-8000-000000000005'

function emptyResources() {
  return Object.fromEntries(
    CLASSROOM_ARCHIVE_V1_RESOURCES.map((resource) => [resource.table, []]),
  )
}

function buildFixtureBundle() {
  return buildClassroomArchiveBundle({
    version: 1,
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
        content: {
          title: 'Historical Quiz draft',
          image: 'https://project.supabase.co/storage/v1/object/public/submission-images/student/work.png',
        },
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
}

function verifiedFixture() {
  const bundle = buildFixtureBundle()
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
    const built = buildFixtureBundle()
    const verification = verifyClassroomArchiveBundle(built.archive)
    if (!verification.ok) throw new Error(verification.error)
    const verified = verification
    const manifestBefore = structuredClone(verified.manifest)
    const quizBytesBefore = Buffer.from(
      verified.files.get('data/quizzes.ndjson') || Buffer.alloc(0),
    )
    const decoded = decodeClassroomArchiveData(verified)
    const adapted = adaptLegacyQuizArchiveResources({
      classroomId: CLASSROOM_ID,
      resources: decoded.resources,
      actors: decoded.actors,
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
    expect(adapted.records.find((record) =>
      record.source_resource === 'assessment_drafts',
    )).toMatchObject({
      parent_source_resource: 'quizzes',
      parent_source_row_id: '60000000-0000-4000-8000-000000000001',
    })
    expect(createHash('sha256').update(gunzipSync(built.archive)).digest('hex')).toBe(
      'd56394a78dfd41b0c452d73f6cdf8cd5c95dcc25cb339917bff5b0a1da61ae22',
    )
    expect(verified.manifest.content_sha256).toBe(
      '779c2783f0ccefa885a31badd740985c3e8eccfff12029975e5aebe924c2eab1',
    )
    expect(Object.fromEntries(
      verified.manifest.resources
        .filter((resource) =>
          resource.table.startsWith('quiz') ||
          resource.table === 'assessment_drafts',
        )
        .map((resource) => [resource.table, resource.sha256]),
    )).toEqual({
      assessment_drafts: '0a2db5337d856b7096a425259868385551b7c19a21979bdaa67d4c3b321ff20d',
      quiz_questions: '7d331d13169e5d2db7c455c50577db4330d1ec6ae540cefde90da09efbe14bc9',
      quiz_responses: '248a87527a97d253d5777e44ec7ccfc141db52881e76f97386d347e5a384482e',
      quiz_student_scores: '3cd9246d1b240fa3fc27d13872db9a2ea494086dfff249907f93574c429623b3',
      quizzes: '1a389ea66ae9aad4ffded2cb6e2484b9c8faab2ee6afde60e87239abe302ff10',
    })
    expect(adapted.resources.assessment_drafts).toEqual([])
    expect(verified.manifest).toEqual(manifestBefore)
    expect(verified.files.get('data/quizzes.ndjson')).toEqual(quizBytesBefore)
  })

  it('round-trips a non-empty v1 Quiz graph through a v2 envelope archive', () => {
    const v1 = verifiedFixture()
    const decodedV1 = decodeClassroomArchiveData(v1)
    const adapted = adaptLegacyQuizArchiveResources({
      classroomId: CLASSROOM_ID,
      resources: decodedV1.resources,
      actors: decodedV1.actors,
    })
    const v2 = buildClassroomArchiveBundle({
      version: 2,
      archiveId: ARCHIVE_ID,
      classroomId: CLASSROOM_ID,
      teacherId: TEACHER_ID,
      createdAt: '2026-07-13T12:00:00.000Z',
      source: {
        schemaMigration: CLASSROOM_ARCHIVE_V2_RESTORE_TARGET_MIGRATION,
        appCommit: 'abcdef1234567890',
      },
      retention: { mode: 'teacher_managed', delete_after: null },
      resources: adapted.resources,
      actors: decodedV1.actors,
      storageObjects: v1.manifest.storage_objects.map((object) => ({
        bucket: object.bucket,
        sourcePath: object.source_path,
        contentType: object.content_type,
        bytes: v1.files.get(object.archive_path) || Buffer.alloc(0),
      })),
    })
    const verifiedV2 = verifyClassroomArchiveBundle(v2.archive)
    expect(verifiedV2.ok).toBe(true)
    if (!verifiedV2.ok) throw new Error(verifiedV2.error)

    const plan = buildClassroomArchiveV2RestorePlan({
      verified: verifiedV2,
      artifactChecksumVerified: true,
      operationId: OPERATION_ID,
      currentActors,
      supabaseUrl: 'https://project.supabase.co',
    })

    expect(plan.sourceContractVersion).toBe(2)
    expect(plan.adapterChain).toEqual([])
    expect(plan.resources).not.toHaveProperty('quizzes')
    expect(plan.resources).not.toHaveProperty('quiz_questions')
    expect(plan.resources).not.toHaveProperty('quiz_responses')
    expect(plan.resources).not.toHaveProperty('quiz_student_scores')
    expect(plan.resources.classroom_retired_assessment_records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_resource: 'quiz_student_scores',
          payload: expect.objectContaining({ manual_override_score: 9 }),
        }),
      ]),
    )
    const draftEnvelope = plan.resources.classroom_retired_assessment_records.find(
      (record) => record.source_resource === 'assessment_drafts',
    )
    expect(JSON.stringify(draftEnvelope?.payload)).toContain(
      `/submission-images/restores/${CLASSROOM_ID}/${OPERATION_ID}/`,
    )
    expect(draftEnvelope?.payload_sha256).toBe(
      retiredAssessmentPayloadChecksum(draftEnvelope?.payload as Record<string, unknown>),
    )
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

  it('restores verified v2 input directly through the envelope contract', () => {
    const verification = verifyClassroomArchiveBundle(
      buildClassroomArchiveV2Fixture().archive,
    )
    expect(verification.ok).toBe(true)
    if (!verification.ok) throw new Error(verification.error)

    const plan = buildClassroomArchiveV2RestorePlan({
      verified: verification,
      artifactChecksumVerified: true,
      operationId: OPERATION_ID,
      currentActors: [
        { id: V2_TEACHER_ID, email: 'teacher@example.test', role: 'teacher' },
        { id: V2_STUDENT_ID, email: 'student@example.test', role: 'student' },
      ],
      supabaseUrl: 'https://project.supabase.co',
    })
    expect(plan.sourceContractVersion).toBe(2)
    expect(plan.restoreContractVersion).toBe(2)
    expect(plan.adapterChain).toEqual([])
  })

  it('keeps the deployed v1 restore plan on migration 083 and preserves Quiz rows', () => {
    const plan = buildClassroomArchiveRestorePlan({
      verified: verifiedFixture(),
      artifactChecksumVerified: true,
      operationId: OPERATION_ID,
      currentActors,
      supabaseUrl: 'https://project.supabase.co',
    })

    expect(plan.targetSchemaMigration).toBe(CLASSROOM_ARCHIVE_RESTORE_TARGET_MIGRATION)
    expect(plan.adapterChain).toEqual(['classroom-archive-v1-082-to-083'])
    expect(plan.sourceContractVersion).toBe(1)
    expect(plan.restoreContractVersion).toBe(1)
    expect(plan.resources.quizzes).toHaveLength(1)
    expect(plan.resources.quiz_questions).toHaveLength(1)
    expect(plan.resources.quiz_responses).toHaveLength(1)
    expect(plan.resources.quiz_student_scores).toHaveLength(1)
    expect(plan.resources).not.toHaveProperty('classroom_retired_assessment_records')
  })

  it('selects the v2 adapter, reconciles actors, and rewrites managed object references', () => {
    const plan = buildClassroomArchiveV2RestorePlan({
      verified: verifiedFixture(),
      artifactChecksumVerified: true,
      operationId: OPERATION_ID,
      currentActors,
      supabaseUrl: 'https://project.supabase.co',
    })

    expect(plan.targetSchemaMigration).toBe(CLASSROOM_ARCHIVE_V2_RESTORE_TARGET_MIGRATION)
    expect(plan.adapterChain).toEqual([
      'classroom-archive-schema-082-to-105',
      'classroom-archive-v1-quiz-to-retired-assessment-v1',
    ])
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
    expect(plan.resources).not.toHaveProperty('quizzes')
    expect(plan.resources).not.toHaveProperty('quiz_questions')
    expect(plan.resources).not.toHaveProperty('quiz_responses')
    expect(plan.resources).not.toHaveProperty('quiz_student_scores')
    expect(plan.resources.classroom_retired_assessment_records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_resource: 'quizzes',
          payload: expect.objectContaining({ title: 'Historical quiz' }),
        }),
        expect.objectContaining({
          source_resource: 'quiz_student_scores',
          payload: expect.objectContaining({
            student_id: STUDENT_ID,
            manual_override_score: 9,
          }),
        }),
      ]),
    )
    const draftEnvelope = plan.resources.classroom_retired_assessment_records.find(
      (record) => record.source_resource === 'assessment_drafts',
    )
    expect(JSON.stringify(draftEnvelope?.payload)).toContain(
      `/submission-images/restores/${CLASSROOM_ID}/${OPERATION_ID}/`,
    )
    expect(draftEnvelope?.payload_sha256).toBe(
      retiredAssessmentPayloadChecksum(draftEnvelope?.payload as Record<string, unknown>),
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
