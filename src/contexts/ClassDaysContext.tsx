'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ClassDay } from '@/types'
import { CLASS_DAYS_UPDATED_EVENT } from '@/lib/events'
import {
  fetchClassDaysForClassroom,
  invalidateClassDaysForClassroom,
} from '@/lib/class-days-client'

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
  const loadSequenceRef = useRef(0)

  const loadClassDays = useCallback(async (options?: { force?: boolean }) => {
    const loadSequence = loadSequenceRef.current + 1
    loadSequenceRef.current = loadSequence

    try {
      if (options?.force) {
        invalidateClassDaysForClassroom(classroomId)
      }
      const nextClassDays = await fetchClassDaysForClassroom(classroomId)
      if (loadSequenceRef.current === loadSequence) {
        setClassDays(nextClassDays)
      }
    } catch (err) {
      if (loadSequenceRef.current === loadSequence) {
        console.error('Error loading class days:', err)
      }
    } finally {
      if (loadSequenceRef.current === loadSequence) {
        setIsLoading(false)
      }
    }
  }, [classroomId])

  // Initial load
  useEffect(() => {
    loadSequenceRef.current += 1
    setClassDays([])
    setIsLoading(true)
    loadClassDays()
  }, [loadClassDays])

  // Listen for class days updates (single listener for all consumers)
  useEffect(() => {
    const handleClassDaysUpdated = (e: CustomEvent<{ classroomId: string }>) => {
      if (e.detail.classroomId === classroomId) {
        loadClassDays({ force: true })
      }
    }

    window.addEventListener(CLASS_DAYS_UPDATED_EVENT, handleClassDaysUpdated as EventListener)
    return () => {
      window.removeEventListener(CLASS_DAYS_UPDATED_EVENT, handleClassDaysUpdated as EventListener)
    }
  }, [classroomId, loadClassDays])

  return (
    <ClassDaysContext.Provider value={{ classDays, isLoading, refresh: () => loadClassDays({ force: true }) }}>
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
  const hasContext = context !== null

  // Fallback state for when not wrapped in provider
  const [fallbackClassDays, setFallbackClassDays] = useState<ClassDay[]>([])

  useEffect(() => {
    // Skip fetching if we have context - provider handles it
    if (hasContext) return

    let isActive = true
    let loadSequence = 0

    async function loadClassDays(options?: { force?: boolean }) {
      loadSequence += 1
      const currentLoadSequence = loadSequence

      try {
        if (options?.force) {
          invalidateClassDaysForClassroom(classroomId)
        }
        const nextClassDays = await fetchClassDaysForClassroom(classroomId)
        if (isActive && currentLoadSequence === loadSequence) {
          setFallbackClassDays(nextClassDays)
        }
      } catch (err) {
        if (isActive && currentLoadSequence === loadSequence) {
          console.error('Error loading class days:', err)
        }
      }
    }
    loadClassDays()

    const handleClassDaysUpdated = (e: CustomEvent<{ classroomId: string }>) => {
      if (e.detail.classroomId === classroomId) {
        loadClassDays({ force: true })
      }
    }

    window.addEventListener(CLASS_DAYS_UPDATED_EVENT, handleClassDaysUpdated as EventListener)
    return () => {
      isActive = false
      window.removeEventListener(CLASS_DAYS_UPDATED_EVENT, handleClassDaysUpdated as EventListener)
    }
  }, [classroomId, hasContext])

  // Return context data if available, otherwise fallback
  return hasContext ? context.classDays : fallbackClassDays
}
