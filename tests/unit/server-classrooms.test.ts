import { describe, expect, it } from 'vitest'
import { classroomStudentRecord, hydrateClassroomRecord, hydrateClassroomRecords } from '@/lib/server/classrooms'
import { DEFAULT_CLASSROOM_FEATURE_VISIBILITY } from '@/lib/classroom-feature-visibility'

describe('server classroom hydration', () => {
  it('assigns distinct fallback theme colors to list rows missing stored colors', () => {
    const classrooms = hydrateClassroomRecords([
      { id: 'c-1', title: 'Open classroom', class_code: 'OPEN01' },
      { id: 'c-2', title: 'Test Classroom', class_code: 'TEST01' },
    ])

    expect(classrooms.map((classroom) => classroom.theme_color)).toEqual(['blue', 'teal'])
  })

  it('preserves stored theme colors while filling missing list colors', () => {
    const classrooms = hydrateClassroomRecords([
      { id: 'c-1', title: 'Open classroom', class_code: 'OPEN01', theme_color: 'rose' },
      { id: 'c-2', title: 'Test Classroom', class_code: 'TEST01' },
    ])

    expect(classrooms.map((classroom) => classroom.theme_color)).toEqual(['rose', 'blue'])
  })

  it('defaults missing feature visibility on and preserves explicit preferences', () => {
    const classrooms = hydrateClassroomRecords([
      { id: 'c-1', title: 'Legacy classroom', class_code: 'OLD001' },
      {
        id: 'c-2',
        title: 'Online classroom',
        class_code: 'WEB001',
        feature_visibility: { tests: false, attendance: false },
      },
    ])

    expect(classrooms[0].feature_visibility).toEqual(DEFAULT_CLASSROOM_FEATURE_VISIBILITY)
    expect(classrooms[1].feature_visibility).toEqual({
      ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
      tests: false,
      attendance: false,
    })
  })
})

describe('student classroom serialization', () => {
  it('omits guidance provenance in detail and list hydration while leaving teacher rows intact', () => {
    const row = { id: 'c-1', title: 'Course', source_blueprint_version_id: 'content-v3',
      authoring_guidance_version_id: 'private-guidance-v4' }
    const detail = hydrateClassroomRecord(classroomStudentRecord(row))
    const list = hydrateClassroomRecords([row].map(classroomStudentRecord))
    for (const record of [detail, ...list]) {
      expect(record.source_blueprint_version_id).toBe('content-v3')
      expect(record).not.toHaveProperty('authoring_guidance_version_id')
      expect(JSON.stringify(record)).not.toContain('private-guidance-v4')
    }
    expect(hydrateClassroomRecord(row).authoring_guidance_version_id).toBe('private-guidance-v4')
  })
})
