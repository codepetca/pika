import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import {
  buildClassroomArchiveBundle,
  canonicalJsonStringify,
  decodeClassroomArchiveData,
  discoverClassroomStorageReferences,
  encodeTar,
  parseAndValidateNdjson,
  parseTar,
  sha256Bytes,
  verifyClassroomArchiveBundle,
} from '@/lib/server/classroom-archive-format'
import { CLASSROOM_RELATIONAL_RESOURCES } from '@/lib/contracts/classroom-data'
import type { ClassroomArchiveManifest } from '@/lib/contracts/classroom-artifacts'
import {
  buildClassroomArchiveV2Fixture,
  V2_CLASSROOM_ID,
  V2_STUDENT_ID,
  V2_TEACHER_ID,
} from '../../fixtures/classroom-archive-v2'
import {
  LEGACY_QUIZ_RETIRED_SOURCE_CONTRACT,
  RETIRED_ASSESSMENT_CHECKSUM_ALGORITHM,
  retiredAssessmentPayloadChecksum,
} from '@/lib/server/classroom-retired-assessment-contract'

const ARCHIVE_ID = '00000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '00000000-0000-4000-8000-000000000002'
const TEACHER_ID = '00000000-0000-4000-8000-000000000003'

function emptyResources() {
  return Object.fromEntries(
    CLASSROOM_RELATIONAL_RESOURCES.map((resource) => [resource.table, []]),
  )
}

function buildFixture() {
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
      classrooms: [
        {
          teacher_id: TEACHER_ID,
          id: CLASSROOM_ID,
          title: 'Chemistry',
          settings: { z: true, a: false },
        },
      ],
      assignments: [
        { id: '00000000-0000-4000-8000-000000000020', classroom_id: CLASSROOM_ID, title: 'B' },
        { title: 'A', classroom_id: CLASSROOM_ID, id: '00000000-0000-4000-8000-000000000010' },
      ],
    },
    actors: [
      {
        id: TEACHER_ID,
        email: 'teacher@example.test',
        role: 'teacher',
        profile: null,
      },
    ],
    storageObjects: [
      {
        bucket: 'assignment-artifacts',
        sourcePath: 'student/assignment/evidence.png',
        contentType: 'image/png',
        bytes: Buffer.from('png-bytes'),
      },
    ],
  })
}

function legacyV1Canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(legacyV1Canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, legacyV1Canonicalize(item)]),
  )
}

function legacyV1Stringify(value: unknown): string {
  return JSON.stringify(legacyV1Canonicalize(value))
}

function legacyV1ContentChecksum(
  files: Array<{ path: string; byte_size: number; sha256: string }>,
): string {
  const descriptors = [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => ({
      path: file.path,
      byte_size: file.byte_size,
      sha256: file.sha256,
    }))
  return createHash('sha256').update(legacyV1Stringify(descriptors)).digest('hex')
}

function buildLegacyV1Fixture(): Uint8Array {
  const files = parseTar(gunzipSync(buildFixture().archive))
  const manifest = JSON.parse(files.get('manifest.json')?.toString('utf8') || '') as ClassroomArchiveManifest
  const classroomPath = 'data/classrooms.ndjson'
  const classroomRows = (files.get(classroomPath)?.toString('utf8').trim().split('\n') || [])
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  classroomRows[0].settings = { 'é': 3, z: 1, 'ä': 2 }
  const classroomBytes = Buffer.from(
    `${classroomRows.map(legacyV1Stringify).join('\n')}\n`,
    'utf8',
  )
  files.set(classroomPath, classroomBytes)

  const classroomDescriptor = manifest.resources.find((item) => item.path === classroomPath)
  if (!classroomDescriptor) throw new Error('Missing classroom fixture descriptor')
  classroomDescriptor.byte_size = classroomBytes.byteLength
  classroomDescriptor.sha256 = sha256Bytes(classroomBytes)
  const contentDescriptors = [
    ...manifest.resources,
    manifest.actors,
    ...manifest.storage_objects.map((object) => ({
      path: object.archive_path,
      byte_size: object.byte_size,
      sha256: object.sha256,
    })),
  ]
  manifest.content_sha256 = legacyV1ContentChecksum(contentDescriptors)
  files.set('manifest.json', Buffer.from(`${legacyV1Stringify(manifest)}\n`, 'utf8'))

  const entries = [...files.entries()]
    .sort(([left], [right]) => {
      if (left === 'manifest.json') return -1
      if (right === 'manifest.json') return 1
      return left.localeCompare(right)
    })
    .map(([path, bytes]) => ({ path, bytes }))
  return gzipSync(encodeTar(entries), { level: 9 })
}

describe('classroom archive format', () => {
  it('writes the explicitly requested v2 envelope graph', () => {
    const fixture = buildClassroomArchiveV2Fixture()
    const bundle = buildClassroomArchiveBundle({
      version: 2,
      archiveId: fixture.manifest.archive_id,
      classroomId: fixture.manifest.classroom_id,
      teacherId: fixture.manifest.teacher_id,
      createdAt: fixture.manifest.created_at,
      source: {
        schemaMigration: fixture.manifest.source.schema_migration,
        appCommit: fixture.manifest.source.app_commit,
      },
      retention: fixture.manifest.retention,
      resources: fixture.resources,
      actors: fixture.actors,
      storageObjects: [],
    })

    const verification = verifyClassroomArchiveBundle(bundle.archive)
    expect(verification.ok && verification.manifest.version).toBe(2)
  })

  it('canonicalizes object keys recursively while retaining array order', () => {
    expect(canonicalJsonStringify({ z: 1, a: { y: 2, b: 3 }, items: [{ z: 4, a: 5 }] })).toBe(
      '{"a":{"b":3,"y":2},"items":[{"a":5,"z":4}],"z":1}',
    )
  })

  it('uses UTF-8 byte ordering without consulting the host locale', () => {
    const localeCompare = vi.spyOn(String.prototype, 'localeCompare')
      .mockImplementation(() => {
        throw new Error('locale-dependent comparison is forbidden')
      })

    expect(canonicalJsonStringify({ 'é': 3, z: 1, 'ä': 2 })).toBe(
      '{"z":1,"ä":2,"é":3}',
    )
    expect(() => buildFixture()).not.toThrow()
    localeCompare.mockRestore()
  })

  it('verifies and decodes locale-canonical archives created by the original v1 writer', () => {
    const archive = buildLegacyV1Fixture()
    const verification = verifyClassroomArchiveBundle(archive)

    expect(verification.ok).toBe(true)
    if (!verification.ok) throw new Error(verification.error)
    expect(decodeClassroomArchiveData(verification).resources.classrooms[0].settings).toEqual({
      'é': 3,
      z: 1,
      'ä': 2,
    })
  })

  it('limits locale-canonical NDJSON recovery to explicitly identified v1 data', () => {
    const bytes = Buffer.from(`${legacyV1Stringify({ 'é': 3, z: 1, 'ä': 2 })}\n`)

    expect(() => parseAndValidateNdjson(bytes)).toThrow(
      'NDJSON resource is not canonically serialized',
    )
    expect(parseAndValidateNdjson(bytes, undefined, {
      allowLegacyV1Canonicalization: true,
    })).toEqual([{ 'é': 3, z: 1, 'ä': 2 }])
  })

  it('builds deterministic gzip archives and sorts resource rows by primary key', () => {
    const first = buildFixture()
    const second = buildFixture()

    expect(Buffer.from(first.archive).equals(Buffer.from(second.archive))).toBe(true)
    expect(first.artifactSha256).toBe(second.artifactSha256)
    expect(sha256Bytes(gunzipSync(first.archive))).toBe(
      '4d3c518c262c5269844b112953dab52b08b68e7999ec235f422e126f54306093',
    )

    const verification = verifyClassroomArchiveBundle(first.archive)
    expect(verification.ok).toBe(true)
    if (!verification.ok) throw new Error(verification.error)
    expect(verification.manifest).toEqual(first.manifest)
    expect(verification.files.get('data/assignments.ndjson')?.toString('utf8')).toBe(
      `${canonicalJsonStringify({ title: 'A', classroom_id: CLASSROOM_ID, id: '00000000-0000-4000-8000-000000000010' })}\n` +
      `${canonicalJsonStringify({ id: '00000000-0000-4000-8000-000000000020', classroom_id: CLASSROOM_ID, title: 'B' })}\n`,
    )
  })

  it('strictly verifies the inactive v2 envelope graph', () => {
    const sourceRowId = '72000000-0000-4000-8000-000000000001'
    const recordId = '72000000-0000-4000-8000-000000000002'
    const actorId = '72000000-0000-4000-8000-000000000003'
    const payload = {
      id: sourceRowId,
      classroom_id: V2_CLASSROOM_ID,
      title: 'Retired assessment',
      created_by: V2_TEACHER_ID,
    }
    const record = {
      id: recordId,
      classroom_id: V2_CLASSROOM_ID,
      source_contract: LEGACY_QUIZ_RETIRED_SOURCE_CONTRACT,
      source_contract_version: 1,
      source_resource: 'quizzes',
      source_row_id: sourceRowId,
      parent_source_resource: null,
      parent_source_row_id: null,
      payload,
      payload_sha256: retiredAssessmentPayloadChecksum(payload),
      checksum_algorithm: RETIRED_ASSESSMENT_CHECKSUM_ALGORITHM,
      source_created_at: null,
      source_updated_at: null,
    }
    const actor = {
      id: actorId,
      record_id: recordId,
      actor_id: V2_TEACHER_ID,
      source_column: 'created_by',
    }
    const built = buildClassroomArchiveV2Fixture({
      resources: {
        classroom_retired_assessment_records: [record],
        classroom_retired_assessment_record_actors: [actor],
      },
    })
    const verified = verifyClassroomArchiveBundle(built.archive)

    expect(verified.ok).toBe(true)
    if (!verified.ok) throw new Error(verified.error)
    expect(decodeClassroomArchiveData(verified).resources)
      .toMatchObject({
        classroom_retired_assessment_records: [record],
        classroom_retired_assessment_record_actors: [actor],
      })
  })

  it('rejects invalid v2 envelope checksums, relationships, actors, and credentials', () => {
    const sourceRowId = '73000000-0000-4000-8000-000000000001'
    const recordId = '73000000-0000-4000-8000-000000000002'
    const parentSourceRowId = '73000000-0000-4000-8000-000000000009'
    const payload = { id: sourceRowId, quiz_id: parentSourceRowId }
    const baseRecord = {
      id: recordId,
      classroom_id: V2_CLASSROOM_ID,
      source_contract: LEGACY_QUIZ_RETIRED_SOURCE_CONTRACT,
      source_contract_version: 1,
      source_resource: 'quiz_questions',
      source_row_id: sourceRowId,
      parent_source_resource: 'quizzes',
      parent_source_row_id: parentSourceRowId,
      payload,
      payload_sha256: retiredAssessmentPayloadChecksum(payload),
      checksum_algorithm: RETIRED_ASSESSMENT_CHECKSUM_ALGORITHM,
      source_created_at: null,
      source_updated_at: null,
    }
    const verifyRecords = (
      records: Record<string, unknown>[],
      actors: Record<string, unknown>[] = [],
    ) => verifyClassroomArchiveBundle(buildClassroomArchiveV2Fixture({
      resources: {
        classroom_retired_assessment_records: records,
        classroom_retired_assessment_record_actors: actors,
      },
    }).archive)

    expect(verifyRecords([{ ...baseRecord, payload_sha256: '0'.repeat(64) }]))
      .toEqual(expect.objectContaining({
        ok: false,
        error: expect.stringContaining('payload checksum mismatch'),
      }))
    expect(verifyRecords([{ ...baseRecord, source_contract: undefined }])).toEqual(expect.objectContaining({
      ok: false,
    }))
    expect(verifyRecords([baseRecord])).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('parent is missing'),
    }))

    const root = {
      ...baseRecord,
      source_resource: 'quizzes',
      parent_source_resource: null,
      parent_source_row_id: null,
      payload: {
        id: sourceRowId,
        classroom_id: V2_CLASSROOM_ID,
      },
      payload_sha256: retiredAssessmentPayloadChecksum({
        id: sourceRowId,
        classroom_id: V2_CLASSROOM_ID,
      }),
    }
    const actorPayload = {
      id: sourceRowId,
      classroom_id: V2_CLASSROOM_ID,
      created_by: V2_TEACHER_ID,
    }
    expect(verifyRecords([{
      ...root,
      payload: actorPayload,
      payload_sha256: retiredAssessmentPayloadChecksum(actorPayload),
    }])).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('actor reference is missing'),
    }))
    expect(verifyRecords([root], [{
      id: '73000000-0000-4000-8000-000000000003',
      record_id: recordId,
      actor_id: '73000000-0000-4000-8000-000000000004',
      source_column: 'created_by',
    }])).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('missing from archive snapshots'),
    }))

    expect(verifyRecords([{
      ...root,
      source_contract: 'pika.unsupported@1/example',
    }])).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('Unsupported retired assessment source contract'),
    }))

    const mismatchedActorPayload = {
      id: sourceRowId,
      classroom_id: V2_CLASSROOM_ID,
      created_by: V2_TEACHER_ID,
    }
    expect(verifyRecords([{
      ...root,
      payload: mismatchedActorPayload,
      payload_sha256: retiredAssessmentPayloadChecksum(mismatchedActorPayload),
    }], [{
      id: '73000000-0000-4000-8000-000000000005',
      record_id: recordId,
      actor_id: V2_STUDENT_ID,
      source_column: 'created_by',
    }])).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('does not match its payload'),
    }))

    for (const credentialPayload of [
      { id: sourceRowId, classroom_id: V2_CLASSROOM_ID, password_hash: 'forbidden' },
      { id: sourceRowId, classroom_id: V2_CLASSROOM_ID, clientSecret: 'forbidden' },
      { id: sourceRowId, classroom_id: V2_CLASSROOM_ID, 'private-key': 'forbidden' },
      { id: sourceRowId, classroom_id: V2_CLASSROOM_ID, resetToken: 'forbidden' },
    ]) {
      expect(verifyRecords([{
        ...root,
        payload: credentialPayload,
        payload_sha256: retiredAssessmentPayloadChecksum(credentialPayload),
      }])).toEqual(expect.objectContaining({
        ok: false,
        error: expect.stringContaining('forbidden credential field'),
      }))
    }

    const payloadWithWrongId = {
      ...root.payload,
      id: '73000000-0000-4000-8000-000000000008',
    }
    expect(verifyRecords([{
      ...root,
      payload: payloadWithWrongId,
      payload_sha256: retiredAssessmentPayloadChecksum(payloadWithWrongId),
    }])).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('payload identity does not match'),
    }))

    const missingParentPayload = {
      id: sourceRowId,
      quiz_id: parentSourceRowId,
    }
    expect(verifyRecords([{
      ...baseRecord,
      parent_source_resource: null,
      parent_source_row_id: null,
      payload: missingParentPayload,
      payload_sha256: retiredAssessmentPayloadChecksum(missingParentPayload),
    }])).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('required parent is missing'),
    }))

    const wrongParentResourcePayload = {
      id: sourceRowId,
      quiz_id: parentSourceRowId,
    }
    expect(verifyRecords([{
      ...baseRecord,
      parent_source_resource: 'quiz_responses',
      payload: wrongParentResourcePayload,
      payload_sha256: retiredAssessmentPayloadChecksum(wrongParentResourcePayload),
    }])).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('parent resource is invalid'),
    }))

    const wrongParentForeignKeyPayload = {
      id: sourceRowId,
      quiz_id: '73000000-0000-4000-8000-000000000008',
    }
    expect(verifyRecords([{
      ...baseRecord,
      payload: wrongParentForeignKeyPayload,
      payload_sha256: retiredAssessmentPayloadChecksum(wrongParentForeignKeyPayload),
    }])).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('parent foreign key does not match'),
    }))

    const otherClassroomPayload = {
      ...root.payload,
      classroom_id: '73000000-0000-4000-8000-000000000008',
    }
    expect(verifyRecords([{
      ...root,
      payload: otherClassroomPayload,
      payload_sha256: retiredAssessmentPayloadChecksum(otherClassroomPayload),
    }])).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('payload belongs to another classroom'),
    }))

    const questionRecord = {
      ...baseRecord,
      id: '73000000-0000-4000-8000-000000000011',
      parent_source_row_id: root.source_row_id,
      payload: {
        id: sourceRowId,
        quiz_id: root.source_row_id,
      },
      payload_sha256: retiredAssessmentPayloadChecksum({
        id: sourceRowId,
        quiz_id: root.source_row_id,
      }),
    }
    const responseRowId = '73000000-0000-4000-8000-000000000006'
    const unrelatedQuizId = '73000000-0000-4000-8000-000000000007'
    const responsePayload = {
      id: responseRowId,
      question_id: questionRecord.source_row_id,
      quiz_id: unrelatedQuizId,
    }
    expect(verifyRecords([root, questionRecord, {
      ...baseRecord,
      id: '73000000-0000-4000-8000-000000000010',
      source_resource: 'quiz_responses',
      source_row_id: responseRowId,
      parent_source_resource: 'quiz_questions',
      parent_source_row_id: questionRecord.source_row_id,
      payload: responsePayload,
      payload_sha256: retiredAssessmentPayloadChecksum(responsePayload),
    }])).toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining('parent payload relationship is invalid'),
    }))
  })

  it('rejects a bundle whose decompressed content was modified', () => {
    const built = buildFixture()
    const tar = Buffer.from(gunzipSync(built.archive))
    const marker = Buffer.from('png-bytes')
    const markerOffset = tar.indexOf(marker)
    expect(markerOffset).toBeGreaterThan(0)
    tar[markerOffset] = 'x'.charCodeAt(0)

    const verification = verifyClassroomArchiveBundle(tar, { compressed: false })
    expect(verification).toEqual({ ok: false, error: 'Storage object checksum mismatch' })
  })

  it('rejects resources that do not match the canonical inventory', () => {
    expect(() => buildClassroomArchiveBundle({
      version: 1,
      archiveId: ARCHIVE_ID,
      classroomId: CLASSROOM_ID,
      teacherId: TEACHER_ID,
      createdAt: '2026-07-13T12:00:00.000Z',
      source: {
        schemaMigration: '082_verified_classroom_archive_exports',
        appCommit: 'abcdef1',
      },
      retention: { mode: 'teacher_managed', delete_after: null },
      resources: { classrooms: [] },
      actors: [],
      storageObjects: [],
    })).toThrow('Missing classroom archive resource')
  })

  it('rejects actor snapshots containing credential fields', () => {
    expect(() => buildClassroomArchiveBundle({
      version: 1,
      archiveId: ARCHIVE_ID,
      classroomId: CLASSROOM_ID,
      teacherId: TEACHER_ID,
      createdAt: '2026-07-13T12:00:00.000Z',
      source: {
        schemaMigration: '082_verified_classroom_archive_exports',
        appCommit: 'abcdef1',
      },
      retention: { mode: 'teacher_managed', delete_after: null },
      resources: emptyResources(),
      actors: [{
        id: TEACHER_ID,
        email: 'teacher@example.test',
        role: 'teacher',
        profile: null,
        password_hash: 'must-not-leave-the-database',
      }],
      storageObjects: [],
    })).toThrow()
  })

  it('rejects duplicate storage source descriptors', () => {
    const object = {
      bucket: 'assignment-artifacts' as const,
      sourcePath: 'student/assignment/evidence.png',
      contentType: 'image/png',
      bytes: Buffer.from('same-object'),
    }
    expect(() => buildClassroomArchiveBundle({
      version: 1,
      archiveId: ARCHIVE_ID,
      classroomId: CLASSROOM_ID,
      teacherId: TEACHER_ID,
      createdAt: '2026-07-13T12:00:00.000Z',
      source: { schemaMigration: '082_verified_classroom_archive_exports', appCommit: 'abcdef1' },
      retention: { mode: 'teacher_managed', delete_after: null },
      resources: emptyResources(),
      actors: [],
      storageObjects: [object, object],
    })).toThrow('Duplicate source storage object')
  })
})

describe('classroom archive storage discovery', () => {
  it('collects only referenced objects from the configured Supabase origin', () => {
    const resources = {
      ...emptyResources(),
      assignment_submission_artifacts: [
        { storage_path: 'student-1/assignment-1/evidence.png' },
        { storage_path: '../escape.png' },
      ],
      assignment_docs: [
        {
          content: {
            type: 'doc',
            content: [{
              type: 'image',
              attrs: {
                src: 'https://project.supabase.co/storage/v1/object/public/submission-images/student-1/work%20sample.png',
              },
            }],
          },
        },
        {
          content: {
            external: 'https://other.supabase.co/storage/v1/object/public/submission-images/not-ours.png',
            unrelated_private_artifact: 'https://project.supabase.co/storage/v1/object/authenticated/assignment-artifacts/other-student/private.png',
            misplaced_test_document: 'https://project.supabase.co/storage/v1/object/public/test-documents/other-classroom/test.pdf',
            snapshot_path: 'student-controlled/not-a-test-snapshot',
          },
        },
      ],
      tests: [{
        documents: [
          {
            url: 'https://project.supabase.co/storage/v1/object/public/test-documents/teacher/test/file.pdf',
            unrelated_submission_image: 'https://project.supabase.co/storage/v1/object/public/submission-images/other-student/work.png',
            snapshot_path: 'link-docs/teacher/test/doc/snapshot',
          },
        ],
      }],
    }

    expect(discoverClassroomStorageReferences(resources, 'https://project.supabase.co')).toEqual([
      { bucket: 'assignment-artifacts', path: 'student-1/assignment-1/evidence.png' },
      { bucket: 'submission-images', path: 'student-1/work sample.png' },
      { bucket: 'test-documents', path: 'link-docs/teacher/test/doc/snapshot' },
      { bucket: 'test-documents', path: 'teacher/test/file.pdf' },
    ])
  })
})
