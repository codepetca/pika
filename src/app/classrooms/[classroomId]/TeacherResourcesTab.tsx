'use client'

import { CourseGuidePanel } from '@/components/CourseGuidePanel'
import { TeacherClassResourcesSidebar } from './TeacherClassResourcesSidebar'
import type { Classroom } from '@/types'

interface Props {
  classroom: Classroom
  onClassroomUpdated?: (classroom: Classroom) => void
}

export function TeacherResourcesTab({ classroom, onClassroomUpdated }: Props) {
  return (
    <CourseGuidePanel
      classroom={classroom}
      role="teacher"
      onClassroomUpdated={onClassroomUpdated}
      renderResourcesEditor={(onSaved) => (
        <TeacherClassResourcesSidebar classroom={classroom} onSaved={onSaved} />
      )}
    />
  )
}
