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
  error: string | null
  hasLoadedSnapshot: boolean
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
  return (
    <ClassDaysProviderState key={classroomId} classroomId={classroomId}>
      {children}
    </ClassDaysProviderState>
  )
}

function ClassDaysProviderState({ classroomId, children }: ClassDaysProviderProps) {
  const [classDays, setClassDays] = useState<ClassDay[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hasLoadedSnapshot, setHasLoadedSnapshot] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const loadSequenceRef = useRef(0)
  const hasLoadedDataRef = useRef(false)

  const loadClassDays = useCallback(async (options?: { force?: boolean }) => {
    const loadSequence = loadSequenceRef.current + 1
    loadSequenceRef.current = loadSequence
    setError(null)
    if (!hasLoadedDataRef.current) {
      setIsLoading(true)
    }

    try {
      if (options?.force) {
        invalidateClassDaysForClassroom(classroomId)
      }
      const nextClassDays = await fetchClassDaysForClassroom(classroomId)
      if (loadSequenceRef.current === loadSequence) {
        hasLoadedDataRef.current = true
        setHasLoadedSnapshot(true)
        setClassDays(nextClassDays)
        setError(null)
      }
    } catch (err) {
      if (loadSequenceRef.current === loadSequence) {
        console.error('Error loading class days:', err)
        setError('The class schedule could not be loaded.')
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
    hasLoadedDataRef.current = false
    setClassDays([])
    setError(null)
    setHasLoadedSnapshot(false)
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
    <ClassDaysContext.Provider value={{
      classDays,
      error,
      hasLoadedSnapshot,
      isLoading,
      refresh: () => loadClassDays({ force: true }),
    }}>
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
