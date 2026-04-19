import { describe, expect, it } from 'vitest'
import {
  decodeClassroomArchivePackage,
  encodeClassroomArchivePackage,
} from '@/lib/classroom-archive-package'

describe('classroom archive package', () => {
  it('round-trips a tar archive with manifest and snapshot', () => {
    const archive = encodeClassroomArchivePackage({
      manifest: {
        version: '1',
        exported_at: '2026-04-19T12:00:00Z',
        classroom_title: 'Computer Science 11',
        class_code: 'ABC123',
        term_label: 'Semester 1',
        teacher_id: 'teacher-1',
        source_blueprint_origin: {
          blueprint_id: 'blueprint-1',
          blueprint_title: 'Computer Science 11',
          package_manifest_version: '2',
          package_exported_at: '2026-04-18T12:00:00Z',
        },
      },
      snapshot: {
        classroom: { id: 'classroom-1', title: 'Computer Science 11' },
        assignments: [{ id: 'assignment-1', title: 'Kickoff reflection' }],
      },
    })

    const decoded = decodeClassroomArchivePackage(archive)

    expect(decoded).not.toBeNull()
    expect(decoded?.manifest.classroom_title).toBe('Computer Science 11')
    expect((decoded?.snapshot.classroom as any).id).toBe('classroom-1')
    expect((decoded?.snapshot.assignments as any[])[0]?.title).toBe('Kickoff reflection')
  })
})
