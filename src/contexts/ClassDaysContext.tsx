'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ClassDay } from '@/types'
import { CLASS_DAYS_UPDATED_EVENT } from '@/lib/events'

interface ClassDaysContextValue {
  classDays: ClassDay[]
  isLoading: boolean
  refresh: () => Promise<void>
}

const ClassDaysContext = createContext<ClassDaysContextValue | null>(null)

interface ClassDaysProviderProps {
  classroomId: string
  children: ReactNode
}

/**
 * Provides class days data to all children components.
 * Centralizes fetching and event listening to avoid multiple listeners.
 */
export function ClassDaysProvider({ classroomId, children }: ClassDaysProviderProps) {
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadClassDays = useCallback(async () => {
    try {
      const res = await fetch(`/api/classrooms/${classroomId}/class-days`)
      const data = await res.json()
      setClassDays(data.class_days || [])
    } catch (err) {
      console.error('Error loading class days:', err)
    } finally {
      setIsLoading(false)
    }
  }, [classroomId])

  // Initial load
  useEffect(() => {
    loadClassDays()
  }, [loadClassDays])

  // Listen for class days updates (single listener for all consumers)
  useEffect(() => {
    const handleClassDaysUpdated = (e: CustomEvent<{ classroomId: string }>) => {
      if (e.detail.classroomId === classroomId) {
        loadClassDays()
      }
    }

    window.addEventListener(CLASS_DAYS_UPDATED_EVENT, handleClassDaysUpdated as EventListener)
    return () => {
      window.removeEventListener(CLASS_DAYS_UPDATED_EVENT, handleClassDaysUpdated as EventListener)
    }
  }, [classroomId, loadClassDays])

  return (
    <ClassDaysContext.Provider value={{ classDays, isLoading, refresh: loadClassDays }}>
      {children}
    </ClassDaysContext.Provider>
  )
}

/**
 * Hook to access class days from the context.
 * Must be used within a ClassDaysProvider.
 */
export function useClassDaysContext(): ClassDaysContextValue {
  const context = useContext(ClassDaysContext)
  if (!context) {
    throw new Error('useClassDaysContext must be used within a ClassDaysProvider')
  }
  return context
}

/**
 * Hook that returns just the class days array (for backward compatibility).
 * Falls back to empty array if used outside provider.
 */
export function useClassDays(classroomId: string): ClassDay[] {
  const context = useContext(ClassDaysContext)

  // If we're inside a provider, use the context
  if (context) {
    return context.classDays
  }

  // Fallback: fetch directly (for components not wrapped in provider)
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

    const handleClassDaysUpdated = (e: CustomEvent<{ classroomId: string }>) => {
      if (e.detail.classroomId === classroomId) {
        loadClassDays()
      }
    }

    window.addEventListener(CLASS_DAYS_UPDATED_EVENT, handleClassDaysUpdated as EventListener)
    return () => {
      window.removeEventListener(CLASS_DAYS_UPDATED_EVENT, handleClassDaysUpdated as EventListener)
    }
  }, [classroomId])

  return classDays
}
