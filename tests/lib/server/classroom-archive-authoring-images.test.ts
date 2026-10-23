import { describe, expect, it } from 'vitest'
import { buildClassroomArchiveBundle, verifyClassroomArchiveBundle } from '@/lib/server/classroom-archive-format'
import { buildClassroomArchiveV2RestorePlan } from '@/lib/server/classroom-archive-restore'
import { buildClassroomArchiveV2Fixture, V2_CLASSROOM_ID, V2_TEACHER_ID, V2_STUDENT_ID } from '../../fixtures/classroom-archive-v2'

const OBJECT_ID = '81abcdef-0000-4000-8000-000000000001'
const ORPHAN_ID = '81000000-0000-4000-8000-000000000002'
const OPERATION_ID = '81000000-0000-4000-8000-000000000003'
const url = `/api/storage/authoring-images?object_id=${OBJECT_ID}`

function bundle(options: { resourceId?: string; orphanPurpose?: 'teacher_authoring_image' | 'teacher_test_material'; imageUrl?: string } = {}) {
  const fixture = buildClassroomArchiveV2Fixture()
  const imageUrl = options.imageUrl ?? url
  fixture.resources.classrooms[0].course_outline = `![Course image](${imageUrl})`
  fixture.resources.classrooms[0].content = { type: 'doc', attrs: { authoring_markdown: `![Image](${imageUrl})` }, content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: imageUrl, alt: 'Image' } }] }] }
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
  it.each([
    `https://pika.codepet.ca${url}`,
    `http://127.0.0.1:3036${url}`,
    `http://[::1]:3036${url}`,
    `https://pika.codepet.ca${url.replace(OBJECT_ID, OBJECT_ID.toUpperCase())}`,
  ])('restores an absolute protected URL against the new app identity: %s', (imageUrl) => {
    const restored = plan(bundle({ imageUrl }).archive)
    const image = restored.storageObjects.find((object) => object.sourceManagedObjectId === OBJECT_ID)!
    const restoredUrl = `/api/storage/authoring-images?object_id=${image.managedObjectId}`
    expect(restored.resources.classrooms[0].course_outline).toBe(`![Course image](${restoredUrl})`)
    const content = JSON.stringify(restored.resources.classrooms[0].content)
    expect(content).toContain(restoredUrl)
    expect(content).not.toContain(OBJECT_ID)
    expect(content).not.toContain('https://pika.codepet.ca')
    expect(content).not.toContain('http://127.0.0.1:3036')
  })

  it.each(['classwork_materials', 'assignments'])('validates the authoritative %s source despite stale compatibility nodes', (table) => {
    for (const source of ['', 'Image removed by a source-only edit', `![Active image](${url})`]) {
      const fixture = buildClassroomArchiveV2Fixture()
      const staleDoc = { type: 'doc', content: [{ type: 'image', attrs: { src: url } }] }
      fixture.resources[table] = [{ id: ORPHAN_ID, classroom_id: V2_CLASSROOM_ID, created_by: V2_TEACHER_ID,
        ...(table === 'classwork_materials'
          ? { content: { ...staleDoc, attrs: { authoring_markdown: source } } }
          : { instructions_markdown: source, instructions_rich: staleDoc }),
      }]
      // The removed image has already been cleaned up: export contains no bytes
      // or old managed identity. Build, read back and restore the actual bundle.
      const exported = buildClassroomArchiveBundle({ version: 2, archiveId: OPERATION_ID,
        classroomId: V2_CLASSROOM_ID, teacherId: V2_TEACHER_ID, createdAt: '2026-10-22T12:00:00.000Z',
        source: { schemaMigration: '105_classroom_archive_v2_contract', appCommit: 'abcdef1234567890' },
        retention: { mode: 'teacher_managed', delete_after: null }, resources: fixture.resources,
        actors: fixture.actors, storageObjects: [],
      })
      if (source.includes(url)) {
        expect(() => plan(exported.archive)).toThrow('authoring image identities do not exactly match')
        continue
      }
      const restored = plan(exported.archive)
      expect(restored.storageObjects).toEqual([])
      const row = restored.resources[table][0]
      expect(row).toMatchObject(table === 'assignments'
        ? { instructions_markdown: source }
        : { content: { attrs: { authoring_markdown: source } } })
    }
  })

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

  it.each([url, `https://pika.codepet.ca${url}`])('rejects an archive missing the object named only by a protected image URL: %s', (imageUrl) => {
    const verified = verifyClassroomArchiveBundle(bundle({ imageUrl }).archive)
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
