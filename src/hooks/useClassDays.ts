'use client'

import { useEffect, useState } from 'react'
import type { ClassDay } from '@/types'

export function useClassDays(classroomId: string) {
  const [classDays, setClassDays] = useState<ClassDay[]>([])

  useEffect(() => {
    async function loadClassDays() {
      try {
        const res = await fetch(`/api/classrooms/${classroomId}/class-days`)
        const data = await res.json()
        setClassDays(data.class_days || [])
      } catch (err) {
        console.error('Error loading class days:', err)
      }
    }
    loadClassDays()
  }, [classroomId])

  return classDays
}
