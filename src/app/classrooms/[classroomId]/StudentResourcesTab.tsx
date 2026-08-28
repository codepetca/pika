'use client'

import { CourseGuidePanel } from '@/components/CourseGuidePanel'
import type { Classroom } from '@/types'

interface Props {
  classroom: Classroom
}

export function StudentResourcesTab({ classroom }: Props) {
  return <CourseGuidePanel classroom={classroom} role="student" />
}
