import { describe, expect, it } from 'vitest'
import { hydrateClassroomRecords } from '@/lib/server/classrooms'

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
})
