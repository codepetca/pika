import { describe, expect, it } from 'vitest'
import { hydrateClassroomRecords } from '@/lib/server/classrooms'
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
