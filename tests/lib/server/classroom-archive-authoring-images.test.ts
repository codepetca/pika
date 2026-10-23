import { describe, expect, it } from 'vitest'
import { buildClassroomArchiveBundle, verifyClassroomArchiveBundle } from '@/lib/server/classroom-archive-format'
import { buildClassroomArchiveV2RestorePlan } from '@/lib/server/classroom-archive-restore'
import { buildClassroomArchiveV2Fixture, V2_CLASSROOM_ID, V2_TEACHER_ID, V2_STUDENT_ID } from '../../fixtures/classroom-archive-v2'

const OBJECT_ID = '81000000-0000-4000-8000-000000000001'
const ORPHAN_ID = '81000000-0000-4000-8000-000000000002'
const OPERATION_ID = '81000000-0000-4000-8000-000000000003'
const url = `/api/storage/authoring-images?object_id=${OBJECT_ID}`

function bundle(options: { resourceId?: string; orphanPurpose?: 'teacher_authoring_image' | 'teacher_test_material' } = {}) {
  const fixture = buildClassroomArchiveV2Fixture()
  fixture.resources.classrooms[0].course_outline = `![Course image](${url})`
  fixture.resources.classrooms[0].content = { type: 'doc', attrs: { authoring_markdown: `![Image](${url})` }, content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: url, alt: 'Image' } }] }] }
  return buildClassroomArchiveBundle({
    version: 2, archiveId: OPERATION_ID, classroomId: V2_CLASSROOM_ID, teacherId: V2_TEACHER_ID,
    createdAt: '2026-10-22T12:00:00.000Z', source: { schemaMigration: '105_classroom_archive_v2_contract', appCommit: 'abcdef1234567890' },
    retention: { mode: 'teacher_managed', delete_after: null }, resources: fixture.resources, actors: fixture.actors,
    storageObjects: [OBJECT_ID, ORPHAN_ID].map((id) => ({ bucket: 'test-documents' as const,
      sourcePath: `authoring/${id}.png`, contentType: 'image/png', bytes: new Uint8Array([1, 2, 3]),
      managedOwner: { objectId: id, purpose: id === ORPHAN_ID ? options.orphanPurpose || 'teacher_authoring_image' : 'teacher_authoring_image',
        createdByUserId: V2_TEACHER_ID, dataSubjectUserId: null, resourceType: 'classroom', resourceId: options.resourceId || V2_CLASSROOM_ID },
    })),
  })
}

function plan(archive: Uint8Array) {
  const verified = verifyClassroomArchiveBundle(archive)
  if (!verified.ok) throw new Error(verified.error)
  return buildClassroomArchiveV2RestorePlan({ verified, artifactChecksumVerified: true, operationId: OPERATION_ID,
    currentActors: [{ id: V2_TEACHER_ID, email: 'teacher@example.test', role: 'teacher' }, { id: V2_STUDENT_ID, email: 'student@example.test', role: 'student' }],
    supabaseUrl: 'https://project.supabase.co' })
}

describe('teacher authoring images in classroom archives', () => {
  it('retains class-owned images without path references and rewrites Markdown and image URLs to restored identities', () => {
    const restored = plan(bundle().archive)
    expect(restored.storageObjects).toHaveLength(2)
    const image = restored.storageObjects.find((object) => object.sourceManagedObjectId === OBJECT_ID)!
    expect(image).toMatchObject({ purpose: 'teacher_authoring_image', resourceType: 'classroom', resourceId: V2_CLASSROOM_ID, dataSubjectUserId: null })
    expect(image.managedObjectId).not.toBe(OBJECT_ID)
    const restoredUrl = `/api/storage/authoring-images?object_id=${image.managedObjectId}`
    const classroom = restored.resources.classrooms[0]
    expect(classroom.course_outline).toBe(`![Course image](${restoredUrl})`)
    expect(JSON.stringify(classroom.content)).toContain(restoredUrl)
    expect(JSON.stringify(restored.resources)).not.toContain(OBJECT_ID)
    expect(restored.storageObjects.find((object) => object.sourceManagedObjectId === ORPHAN_ID)).toBeDefined()
  })

  it('rejects an archive missing the object named only by a protected image URL', () => {
    const verified = verifyClassroomArchiveBundle(bundle().archive)
    if (!verified.ok) throw new Error(verified.error)
    verified.manifest.storage_objects = verified.manifest.storage_objects.filter((object) => object.managed_owner?.object_id !== OBJECT_ID)
    expect(() => buildClassroomArchiveV2RestorePlan({ verified, artifactChecksumVerified: true, operationId: OPERATION_ID,
      currentActors: [{ id: V2_TEACHER_ID, email: 'teacher@example.test', role: 'teacher' }, { id: V2_STUDENT_ID, email: 'student@example.test', role: 'student' }],
      supabaseUrl: 'https://project.supabase.co' })).toThrow('authoring image identities do not exactly match')
  })

  it('does not admit another purpose as an unreferenced class-owned asset', () => {
    expect(() => plan(bundle({ orphanPurpose: 'teacher_test_material' }).archive)).toThrow('do not exactly match classroom references')
  })

  it('rejects authoring image ownership scoped to a different classroom', () => {
    expect(() => bundle({ resourceId: '81000000-0000-4000-8000-000000000099' })).toThrow()
  })
})
