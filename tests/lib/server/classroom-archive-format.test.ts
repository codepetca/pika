import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  buildClassroomArchiveBundle,
  canonicalJsonStringify,
  discoverClassroomStorageReferences,
  verifyClassroomArchiveBundle,
} from '@/lib/server/classroom-archive-format'
import { CLASSROOM_RELATIONAL_RESOURCES } from '@/lib/contracts/classroom-data'

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

describe('classroom archive format', () => {
  it('canonicalizes object keys recursively while retaining array order', () => {
    expect(canonicalJsonStringify({ z: 1, a: { y: 2, b: 3 }, items: [{ z: 4, a: 5 }] })).toBe(
      '{"a":{"b":3,"y":2},"items":[{"a":5,"z":4}],"z":1}',
    )
  })

  it('builds deterministic gzip archives and sorts resource rows by primary key', () => {
    const first = buildFixture()
    const second = buildFixture()

    expect(Buffer.from(first.archive).equals(Buffer.from(second.archive))).toBe(true)
    expect(first.artifactSha256).toBe(second.artifactSha256)

    const verification = verifyClassroomArchiveBundle(first.archive)
    expect(verification.ok).toBe(true)
    if (!verification.ok) throw new Error(verification.error)
    expect(verification.manifest).toEqual(first.manifest)
    expect(verification.files.get('data/assignments.ndjson')?.toString('utf8')).toBe(
      `${canonicalJsonStringify({ title: 'A', classroom_id: CLASSROOM_ID, id: '00000000-0000-4000-8000-000000000010' })}\n` +
      `${canonicalJsonStringify({ id: '00000000-0000-4000-8000-000000000020', classroom_id: CLASSROOM_ID, title: 'B' })}\n`,
    )
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
