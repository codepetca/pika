'use client'

import { useState } from 'react'
import type { TeacherWorkSurfaceActionItem } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'

/** Display-only state shared by student table and its More actions menu. */
export function useStudentTableGridlines() {
  const [showGridlines, setShowGridlines] = useState(false)
  const gridlinesAction: TeacherWorkSurfaceActionItem = {
    id: 'show-gridlines',
    label: 'Show gridlines',
    checked: showGridlines,
    onSelect: () => setShowGridlines((visible) => !visible),
  }
  return { showGridlines, gridlinesAction }
}
