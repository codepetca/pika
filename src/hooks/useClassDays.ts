'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ClassDay } from '@/types'

export function useClassDays(classroomId: string) {
  const [classDays, setClassDays] = useState<ClassDay[]>([])

  const loadClassDays = useCallback(async () => {
    try {
      const res = await fetch(`/api/classrooms/${classroomId}/class-days`)
      const data = await res.json()
      setClassDays(data.class_days || [])
    } catch (err) {
      console.error('Error loading class days:', err)
    }
  }, [classroomId])

  useEffect(() => {
    loadClassDays()
  }, [loadClassDays])

  // Listen for class days updates from other components
  useEffect(() => {
    const handleClassDaysUpdated = (e: CustomEvent<{ classroomId: string }>) => {
      if (e.detail.classroomId === classroomId) {
        loadClassDays()
      }
    }

    window.addEventListener('pika:classDaysUpdated', handleClassDaysUpdated as EventListener)
    return () => {
      window.removeEventListener('pika:classDaysUpdated', handleClassDaysUpdated as EventListener)
    }
  }, [classroomId, loadClassDays])

  return classDays
}
