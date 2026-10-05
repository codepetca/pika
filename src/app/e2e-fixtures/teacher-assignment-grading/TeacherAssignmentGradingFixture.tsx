'use client'

import { useEffect, useState } from 'react'
import { TeacherClassroomView } from '@/app/classrooms/[classroomId]/TeacherClassroomView'
import { invalidateCachedJSON } from '@/lib/request-cache'
import type { Classroom } from '@/types'

// This client is only mounted by the development-only, gated fixture route.
export function TeacherAssignmentGradingFixture({ classroom }: { classroom: Classroom }) {
  const [isActive, setIsActive] = useState(true)
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(
    "30000000-0000-4000-8000-000000000014",
  )
  useEffect(() => {
    const reactivate = () => {
      invalidateCachedJSON(`teacher-assignments:${classroom.id}`)
      invalidateCachedJSON(`teacher-materials:${classroom.id}`)
      invalidateCachedJSON(`teacher-surveys:${classroom.id}`)
      setIsActive(false)
    }
    const select = (event: Event) => {
      const { assignmentId } = (event as CustomEvent<{ assignmentId: string | null }>).detail
      setSelectedAssignmentId(assignmentId)
    }
    window.addEventListener('pika-fixture-select-classwork', select)
    window.addEventListener('pika-fixture-reactivate-classwork', reactivate)
    return () => {
      window.removeEventListener('pika-fixture-select-classwork', select)
      window.removeEventListener('pika-fixture-reactivate-classwork', reactivate)
    }
  }, [classroom.id])
  useEffect(() => {
    if (isActive) return
    const frame = requestAnimationFrame(() => setIsActive(true))
    return () => cancelAnimationFrame(frame)
  }, [isActive])
  return (
    <TeacherClassroomView
      classroom={classroom}
      selectedAssignmentId={selectedAssignmentId}
      isActive={isActive}
    />
  )
}
