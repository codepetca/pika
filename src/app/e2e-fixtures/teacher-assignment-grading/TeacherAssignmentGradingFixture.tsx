'use client'

import { useEffect, useState } from 'react'
import { TeacherClassroomView } from '@/app/classrooms/[classroomId]/TeacherClassroomView'
import { invalidateCachedJSON } from '@/lib/request-cache'
import type { Classroom } from '@/types'

// This client is only mounted by the development-only, gated fixture route.
export function TeacherAssignmentGradingFixture({ classroom }: { classroom: Classroom }) {
  const [isActive, setIsActive] = useState(true)
  useEffect(() => {
    const reactivate = () => {
      invalidateCachedJSON(`teacher-assignments:${classroom.id}`)
      invalidateCachedJSON(`teacher-materials:${classroom.id}`)
      invalidateCachedJSON(`teacher-surveys:${classroom.id}`)
      setIsActive(false)
    }
    window.addEventListener('pika-fixture-reactivate-classwork', reactivate)
    return () => window.removeEventListener('pika-fixture-reactivate-classwork', reactivate)
  }, [classroom.id])
  useEffect(() => {
    if (isActive) return
    const frame = requestAnimationFrame(() => setIsActive(true))
    return () => cancelAnimationFrame(frame)
  }, [isActive])
  return (
    <TeacherClassroomView
      classroom={classroom}
      selectedAssignmentId="30000000-0000-4000-8000-000000000014"
      isActive={isActive}
    />
  )
}
